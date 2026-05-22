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

async function extractArticleText(url) {
  try {
    console.log(`Fetching article: ${url}`);
    const response = await fetch(url);
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
      You are a public policy research assistant. I will provide you with an article text. 
      I want you to analyze it and return a JSON object with the following structure:
      {
        "summary": "A 3-4 sentence simplified summary of the article.",
        "topics": ["Array of 2-3 broad topic tags, e.g., 'Geopolitics', 'Economics', 'Tech Policy'"],
        "issues": ["Array of 1-2 specific issues addressed, e.g., 'US-China Tech War'"],
        "mainIdeas": ["Array of 2-3 key takeaways or main arguments made by the author"]
      }
      
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

async function run() {
  console.log('Starting scraper...');
  
  // 1. Fetch News/Op-eds
  const newsUrl = 'https://takshashila.org.in/pages/news/';
  const res = await fetch(newsUrl);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Group by href to get both title and metadata
  const linksMap = new Map();
  $('a').each((i, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    
    if (href && href.startsWith('http') && text.length > 5) {
      if (!linksMap.has(href)) {
        linksMap.set(href, { href, parts: [] });
      }
      if (!linksMap.get(href).parts.includes(text)) {
        linksMap.get(href).parts.push(text);
      }
    }
  });

  const rawArticles = Array.from(linksMap.values()).map(item => {
    // Assuming part 0 is title, part 1 is metadata (Date Author Publication)
    return {
      url: item.href,
      title: item.parts[0] || 'Unknown Title',
      metadataStr: item.parts[1] || ''
    };
  }).filter(a => a.title.length > 15 && a.metadataStr.length > 5).slice(0, 3); // Take top 3 for initial run

  console.log(`Found ${rawArticles.length} articles to process.`);

  let existingData = { articles: [], lastUpdated: '' };
  if (fs.existsSync(DATA_FILE)) {
    existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }

  for (const article of rawArticles) {
    // Skip if already processed
    if (existingData.articles.some(a => a.url === article.url)) {
      console.log(`Skipping already processed: ${article.url}`);
      continue;
    }

    const textContent = await extractArticleText(article.url);
    if (!textContent || textContent.length < 200) {
      console.log(`Could not extract enough text for ${article.url}`);
      continue;
    }

    const aiData = await summarizeWithGemini(textContent, article.title, article.url);
    
    if (aiData) {
      existingData.articles.unshift({
        id: new Date().getTime().toString() + Math.random().toString(36).substring(7),
        url: article.url,
        title: article.title,
        metadataRaw: article.metadataStr,
        source: 'Takshashila Opinion',
        dateAdded: new Date().toISOString(),
        ...aiData
      });
      console.log(`Processed: ${article.title}`);
    }
  }

  existingData.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(existingData, null, 2));
  console.log('Done!');
}

run();
