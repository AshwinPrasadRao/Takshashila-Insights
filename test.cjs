const fs = require('fs');
const cheerio = require('cheerio');
const $ = cheerio.load(fs.readFileSync('news_scratch.html'));

let results = [];
$('a').each((i, el) => {
  const href = $(el).attr('href');
  const text = $(el).text().replace(/\s+/g, ' ').trim();
  if (href && href.length > 5 && text.length > 10) {
    results.push({ href, text: text.substring(0, 80) });
  }
});

fs.writeFileSync('links.json', JSON.stringify(results, null, 2));
console.log('done');
