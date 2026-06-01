import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const DATA_FILE = path.join(__dirname, '../src/data/articles.json');

// Cap how many *new* articles we summarize per source per run. A per-source
// cap (rather than one shared cap) guarantees research outputs get pulled even
// when there's a large backlog of news items.
const MAX_NEW_PER_SOURCE = 15;

// When a fetch returns a paywall/login/error page (HTTP 200 but not the
// article), Gemini "summarizes" the error text. Detect those summaries so we
// drop the item instead of storing a useless card.
const FAILURE_SUMMARY_RE = /permission denied|error message|could not be (read|summarized|accessed)|not (provided|accessible|available)|access the content|unable to (provide|summarize|access)/i;

// Source pages on the Takshashila site. `kind` distinguishes external op-eds
// (links point to third-party publishers) from internal research outputs
// (links are relative paths to content/publications/*.html).
const SOURCES = [
  {
    name: 'news',
    type: 'opinion',
    url: 'https://takshashila.org.in/pages/news/',
    source: 'Takshashila Opinion',
  },
  {
    name: 'publications',
    type: 'research',
    url: 'https://takshashila.org.in/pages/publications/',
    source: 'Takshashila Research',
  },
];

// The site occasionally renders hrefs wrapped in parentheses, e.g.
// "https://(https://real-url)" or "https://(www.real-url)". Unwrap those and
// resolve relative links against the page they came from. Returns a clean
// absolute http(s) URL, or null if it can't be salvaged.
function sanitizeHref(href, pageUrl) {
  if (!href) return null;
  let h = href.trim();

  // Unwrap a parenthesised inner URL: "https://(https://x)" / "https://(www.x)"
  const wrapped = h.match(/\((https?:\/\/[^)]+|www\.[^)]+)\)/i);
  if (wrapped) h = wrapped[1];

  // Strip any stray leading/trailing parentheses left behind.
  h = h.replace(/^[("']+/, '').replace(/[)"']+$/, '');

  // Bare "www." -> add scheme.
  if (/^www\./i.test(h)) h = `https://${h}`;

  try {
    const resolved = new URL(h, pageUrl).href;
    return resolved.startsWith('http') ? resolved : null;
  } catch {
    return null;
  }
}

// Pull an ISO date out of a metadata string like "May 20, 2026 Author Publication".
function parsePublishedDate(metadataStr) {
  if (!metadataStr) return null;
  const m = metadataStr.match(/([A-Z][a-z]{2,}\.?\s+\d{1,2},\s+\d{4})/);
  if (!m) return null;
  const d = new Date(m[1]);
  if (isNaN(d.getTime())) return null;
  // A published date can't be in the future at scrape time. The site sometimes
  // surfaces a stray future date (e.g. from sidebar/"upcoming" text); trusting it
  // would pin a stale article to the top forever and dominate the email window.
  // Drop it so downstream code falls back to dateAdded.
  if (d.getTime() > Date.now()) {
    console.log(`Ignoring future publishedDate "${m[1]}" from: ${metadataStr.slice(0, 60)}`);
    return null;
  }
  return d.toISOString();
}

async function extractArticleText(url) {
  try {
    console.log(`Fetching article: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Skipping ${url}: HTTP ${response.status} ${response.statusText}`);
      return '';
    }
    const html = await response.text();
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();
    return article ? article.textContent : '';
  } catch (err) {
    console.error(`Error fetching article content: ${url}`, err.message);
    return '';
  }
}

async function summarizeWithGemini(text, title, url) {
  try {
    const prompt = `
      You are an executive assistant for a busy C-suite executive. I will provide you with an article text.
      I want you to analyze it and return a JSON object with the following structure:
      {
        "summary": "A 3-4 sentence summary of the article.",
        "topics": ["Array of 2-3 broad topic tags, e.g., 'Geopolitics', 'Economics'"],
        "issues": ["Array of 1-2 specific issues addressed, e.g., 'US-China Relations'"],
        "mainIdeas": ["Array of 2-3 key takeaways or main arguments made by the author"]
      }

      CRITICAL INSTRUCTIONS FOR TONE AND LANGUAGE:
      - Write in plain, clear English suitable for a well-informed adult.
      - DO NOT use academic International Relations (IR) jargon or convoluted phrasing (e.g., avoid terms like "constructive strategic stability", "middle powers", "strategic autonomy", "reciprocal concessions").
      - Break down complex policy ideas into their practical, real-world meaning.
      - Be direct and get straight to the point.

      Article Title: ${title}
      Article Text:
      ${text.substring(0, 15000)} // Limiting text to avoid token limits

      Return ONLY valid JSON.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const responseText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(responseText);
  } catch (err) {
    console.error('Error with Gemini API:', err);
    return null;
  }
}

// Scrape one source page into a list of { url, title, metadataStr, type, source }.
async function collectFromSource(src) {
  console.log(`\nScraping ${src.name}: ${src.url}`);
  const res = await fetch(src.url);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Group links by their cleaned href, gathering the distinct text fragments
  // (title + metadata) that point at the same article.
  const linksMap = new Map();
  $('a').each((i, el) => {
    const rawHref = $(el).attr('href');
    const href = sanitizeHref(rawHref, src.url);
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || text.length <= 5) return;

    if (!linksMap.has(href)) linksMap.set(href, { href, parts: [] });
    if (!linksMap.get(href).parts.includes(text)) {
      linksMap.get(href).parts.push(text);
    }
  });

  return Array.from(linksMap.values())
    .map(item => ({
      url: item.href,
      title: item.parts[0] || 'Unknown Title',
      metadataStr: item.parts[1] || '',
      type: src.type,
      source: src.source,
    }))
    .filter(a => a.title.length > 15 && a.metadataStr.length > 5);
}

async function run() {
  console.log('Starting scraper...');

  let existingData = { articles: [], lastUpdated: '' };
  if (fs.existsSync(DATA_FILE)) {
    existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  const seen = new Set(existingData.articles.map(a => a.url));

  // Gather new candidate articles from every source, capped per source so
  // each source (news, research) gets a fair share of the run.
  let newArticles = [];
  for (const src of SOURCES) {
    try {
      const found = await collectFromSource(src);
      const fresh = found.filter(a => !seen.has(a.url)).slice(0, MAX_NEW_PER_SOURCE);
      console.log(`Found ${found.length} candidates in ${src.name}, ${fresh.length} new (capped at ${MAX_NEW_PER_SOURCE}).`);
      newArticles = newArticles.concat(fresh);
    } catch (err) {
      console.error(`Failed to scrape ${src.name}:`, err.message);
    }
  }

  console.log(`\nProcessing ${newArticles.length} new articles...`);

  for (const article of newArticles) {
    try {
      const textContent = await extractArticleText(article.url);
      if (!textContent || textContent.length < 200) {
        console.log(`Could not extract enough text for ${article.url}`);
        continue;
      }

      const aiData = await summarizeWithGemini(textContent, article.title, article.url);
      if (!aiData) continue;

      // Guard against the model summarizing an error/paywall page.
      if (!aiData.summary || FAILURE_SUMMARY_RE.test(aiData.summary)) {
        console.log(`Skipping ${article.url}: summary indicates failed extraction.`);
        continue;
      }

      existingData.articles.unshift({
        id: new Date().getTime().toString() + Math.random().toString(36).substring(7),
        url: article.url,
        title: article.title,
        metadataRaw: article.metadataStr,
        publishedDate: parsePublishedDate(article.metadataStr),
        type: article.type,
        source: article.source,
        dateAdded: new Date().toISOString(),
        ...aiData,
      });
      seen.add(article.url);
      console.log(`Processed [${article.type}]: ${article.title}`);
    } catch (err) {
      console.error(`Error processing ${article.url}:`, err.message);
    }
  }

  // Persist newest-first so both the site and the email render in order.
  existingData.articles.sort((a, b) => {
    const dateOf = x => new Date(x.publishedDate || x.dateAdded || 0).getTime() || 0;
    return dateOf(b) - dateOf(a);
  });

  existingData.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(existingData, null, 2));
  console.log('Done!');
}

run();
