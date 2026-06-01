import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const DATA_FILE = path.join(__dirname, '../src/data/articles.json');
const PORTAL_URL = 'https://ashwinprasadrao.github.io/Takshashila-Insights/';
// Each send shows the most recent insights, regardless of when they were
// published, so a quiet stretch can never produce an empty or one-item email.
// Sent twice weekly (Mon & Thu); consecutive sends may overlap by an item or
// two during a quiet week — that's expected and fine.
const MAX_OPINION = 5;
const MAX_RESEARCH = 3;

// Pick the best date we have for an article, falling back to when we scraped it.
// A publishedDate later than when we scraped it (dateAdded) is impossible and
// signals a bad scrape (e.g. a future date lifted from sidebar text), so we
// ignore it and fall back to dateAdded — otherwise that one article would be the
// only thing inside every send window.
function articleDate(article) {
  const added = article.dateAdded ? new Date(article.dateAdded) : null;
  let pub = article.publishedDate ? new Date(article.publishedDate) : null;
  if (pub && isNaN(pub.getTime())) pub = null;
  if (pub && added && pub.getTime() > added.getTime()) pub = null;
  const d = pub || added;
  return d && !isNaN(d.getTime()) ? d : null;
}

function renderCard(article) {
  return `
    <div style="margin-top: 24px; padding: 20px; border: 1px solid #d0d7de; border-radius: 12px; background-color: #f6f8fa;">
      <h3 style="margin-top: 0;"><a href="${article.url}" style="color: #0969da; text-decoration: none;">${article.title}</a></h3>
      <p style="font-size: 0.9em; color: #656d76; margin: 4px 0;">${article.metadataRaw || article.source || ''}</p>
      <p style="margin: 12px 0;"><strong>Summary:</strong> ${article.summary || ''}</p>
      ${article.mainIdeas && article.mainIdeas.length > 0 ? `
        <div style="background: #ffffff; padding: 15px; border-left: 4px solid #0969da; border-radius: 4px; margin-top: 15px;">
          <h4 style="margin: 0 0 10px 0; color: #656d76; text-transform: uppercase; font-size: 0.8em;">Key Takeaways</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 0.9em;">
            ${article.mainIdeas.map(idea => `<li style="margin-bottom: 5px;">${idea}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;
}

function renderSection(title, articles) {
  if (articles.length === 0) return '';
  return `
    <h2 style="margin-top: 36px; color: #1F2328; border-bottom: 2px solid #eaecef; padding-bottom: 6px;">${title}</h2>
    ${articles.map(renderCard).join('')}
  `;
}

function buildHtml({ opinion, research, dateLabel }) {
  const empty = opinion.length === 0 && research.length === 0;
  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #1F2328; line-height: 1.6;">
      <h1 style="color: #0969da; text-align: center; border-bottom: 2px solid #eaecef; padding-bottom: 10px;">
        Takshashila Insights Digest
      </h1>
      <p style="text-align: center; color: #656d76;">Latest insights &middot; ${dateLabel}</p>
      ${empty
        ? `<p style="text-align: center; color: #656d76; margin-top: 30px;">No insights are available right now.</p>`
        : renderSection('In the News', opinion) + renderSection('Research Outputs', research)}
      <p style="text-align: center; margin-top: 40px; font-size: 0.85em; color: #656d76;">
        Browse the full archive on the <a href="${PORTAL_URL}" style="color: #0969da;">Insights portal</a>.
      </p>
      <p style="text-align: center; font-size: 0.8em; color: #656d76;">
        Powered by AI Summaries &bull; Takshashila Institution
      </p>
    </div>
  `;
}

async function sendNewsletter() {
  console.log('Generating Newsletter...');

  if (!fs.existsSync(DATA_FILE)) {
    console.log('No data found. Skipping newsletter.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const articles = data.articles || [];

  // Newest-first by the date we trust (publishedDate, falling back to dateAdded),
  // then take the most recent few of each kind. No time window — see MAX_* above.
  const sorted = articles
    .filter(a => articleDate(a))
    .sort((a, b) => articleDate(b) - articleDate(a));

  const opinion = sorted.filter(a => a.type !== 'research').slice(0, MAX_OPINION);
  const research = sorted.filter(a => a.type === 'research').slice(0, MAX_RESEARCH);

  const dateLabel = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const html = buildHtml({ opinion, research, dateLabel });

  console.log(`Including latest ${opinion.length} op-eds and ${research.length} research items.`);

  // Generic SMTP config — works with Brevo (smtp-relay.brevo.com:587) and any
  // other SMTP provider without code changes. SENDER_EMAIL must be a sender
  // address verified with the provider.
  const { SMTP_USER, SMTP_PASS, SENDER_EMAIL, RECIPIENT_EMAIL, CC } = process.env;
  // Defaults applied when the env var is unset OR empty (CI passes "" for unset secrets).
  const SMTP_HOST = process.env.SMTP_HOST || 'smtp-relay.brevo.com';
  const SMTP_PORT = process.env.SMTP_PORT || '587';
  const SENDER_NAME = process.env.SENDER_NAME || 'Takshashila Insights';

  // Without credentials (local dev), fall back to writing a preview file.
  if (!SMTP_USER || !SMTP_PASS || !SENDER_EMAIL || !RECIPIENT_EMAIL) {
    const outPath = path.join(__dirname, 'latest_newsletter.html');
    fs.writeFileSync(outPath, html);
    console.log('SMTP credentials not set — wrote preview instead.');
    console.log(`Mock newsletter saved to ${outPath}`);
    return;
  }

  const port = Number(SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  // Verify the SMTP connection/credentials before attempting to send, so auth
  // or host problems surface as a clear failure instead of a silent success.
  await transporter.verify();
  console.log(`SMTP connection OK (${SMTP_HOST}:${port}).`);

  const info = await transporter.sendMail({
    from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
    to: RECIPIENT_EMAIL,
    cc: CC || undefined,
    subject: `Takshashila Insights — ${dateLabel}`,
    html,
  });

  // Log the provider's response so a run can be matched to the Brevo logs.
  // `accepted`/`rejected` show per-recipient handoff; `response` is the raw
  // SMTP reply; `messageId` is the key to search for in the Brevo dashboard.
  console.log(`Newsletter emailed to ${RECIPIENT_EMAIL}.`);
  console.log(`  accepted: ${JSON.stringify(info.accepted)}`);
  console.log(`  rejected: ${JSON.stringify(info.rejected)}`);
  console.log(`  response: ${info.response}`);
  console.log(`  messageId: ${info.messageId}`);
}

sendNewsletter().catch(err => {
  console.error('Failed to send newsletter:', err);
  process.exit(1);
});
