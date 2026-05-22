import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, '../src/data/articles.json');

async function sendNewsletter() {
  console.log('Generating Newsletter...');
  
  if (!fs.existsSync(DATA_FILE)) {
    console.log('No data found. Skipping newsletter.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const articles = data.articles || [];

  // In a real app, we'd filter for articles from the last 7 days.
  // For now, we take the top 3 most recent articles.
  const recentArticles = articles.slice(0, 3);

  if (recentArticles.length === 0) {
    console.log('No recent articles to send.');
    return;
  }

  let htmlContent = `
    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; color: #1F2328; line-height: 1.6;">
      <h1 style="color: #0969da; text-align: center; border-bottom: 2px solid #eaecef; padding-bottom: 10px;">
        Takshashila Insights Digest
      </h1>
      <p style="text-align: center; color: #656d76;">Here are the latest policy insights and summaries.</p>
  `;

  recentArticles.forEach(article => {
    htmlContent += `
      <div style="margin-top: 30px; padding: 20px; border: 1px solid #d0d7de; border-radius: 12px; background-color: #f6f8fa;">
        <h2 style="margin-top: 0;"><a href="${article.url}" style="color: #0969da; text-decoration: none;">${article.title}</a></h2>
        <p style="font-size: 0.9em; color: #656d76;">${article.metadataRaw}</p>
        <p><strong>Summary:</strong> ${article.summary}</p>
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
  });

  htmlContent += `
      <p style="text-align: center; margin-top: 40px; font-size: 0.8em; color: #656d76;">
        Powered by AI Summaries &bull; Takshashila Institution
      </p>
    </div>
  `;

  // Write to a local HTML file as a mock dispatch
  const outPath = path.join(__dirname, 'latest_newsletter.html');
  fs.writeFileSync(outPath, htmlContent);

  console.log(`Newsletter generated! In production, this would be dispatched via Resend API to subscribers.`);
  console.log(`Mock newsletter saved to ${outPath}`);
}

sendNewsletter();
