import React, { useState, useMemo } from 'react';
import { ExternalLink, Tag, Hash, BookOpen, ChevronDown } from 'lucide-react';
import data from './data/articles.json';
import './index.css';

// The date we trust for ordering/grouping. A publishedDate later than when we
// scraped the article (dateAdded) is impossible — it comes from a bad scrape, so
// fall back to dateAdded rather than letting that article jump to the top.
function effectiveDate(a) {
  const added = a.dateAdded ? new Date(a.dateAdded) : null;
  let pub = a.publishedDate ? new Date(a.publishedDate) : null;
  if (pub && isNaN(pub.getTime())) pub = null;
  if (pub && added && pub.getTime() > added.getTime()) pub = null;
  const d = pub || added;
  return d && !isNaN(d.getTime()) ? d : null;
}

function ArticleCard({ article }) {
  return (
    <article className="article-card glass">
      <div className="article-header">
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="article-title">
          {article.title}
        </a>
        <a href={article.url} target="_blank" rel="noopener noreferrer" style={{color: 'var(--text-secondary)'}}>
          <ExternalLink size={18} />
        </a>
      </div>
      
      <div className="article-meta">
        <BookOpen size={14} />
        <span>{article.metadataRaw || 'Takshashila Opinion'}</span>
      </div>

      <div className="tags-container" style={{marginTop: '1rem'}}>
        {article.topics?.map((topic, i) => (
          <span key={i} className="tag">
            <Tag size={12} style={{marginRight: '4px', display: 'inline'}}/>
            {topic}
          </span>
        ))}
        {article.issues?.map((issue, i) => (
          <span key={i} className="tag issue">
            <Hash size={12} style={{marginRight: '4px', display: 'inline'}}/>
            {issue}
          </span>
        ))}
      </div>

      <p className="article-summary">{article.summary}</p>

      {article.mainIdeas && article.mainIdeas.length > 0 && (
        <div className="takeaways">
          <h4>Key Takeaways</h4>
          <ul>
            {article.mainIdeas.map((idea, i) => (
              <li key={i}>{idea}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function App() {
  const [activeFilter, setActiveFilter] = useState('All');
  
  const articles = data.articles || [];

  // Extract all unique topics for the filter bar
  const allTopics = useMemo(() => {
    const topics = new Set();
    articles.forEach(a => {
      a.topics?.forEach(t => topics.add(t));
    });
    return ['All', ...Array.from(topics)].slice(0, 7); // Limit to top 7 for UI
  }, [articles]);

  // Newest first, by published date (falling back to when we scraped it).
  const sortedArticles = useMemo(() => {
    const dateOf = a => { const d = effectiveDate(a); return d ? d.getTime() : 0; };
    return [...articles].sort((a, b) => dateOf(b) - dateOf(a));
  }, [articles]);

  const filteredArticles = useMemo(() => {
    if (activeFilter === 'All') return sortedArticles;
    return sortedArticles.filter(a => a.topics?.includes(activeFilter));
  }, [sortedArticles, activeFilter]);

  // Group into [monthLabel, articles][], newest month first. Since
  // filteredArticles is already date-sorted desc, insertion order is correct.
  const months = useMemo(() => {
    const map = new Map();
    filteredArticles.forEach(a => {
      const d = effectiveDate(a);
      const label = !d
        ? 'Undated'
        : d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(a);
    });
    return Array.from(map.entries());
  }, [filteredArticles]);

  // Track which archive months the user has expanded. The newest month is the
  // "current digest" (always open); a filter expands everything so matches show.
  const [openMonths, setOpenMonths] = useState({});
  const filtering = activeFilter !== 'All';
  const isOpen = (label, idx) =>
    filtering || idx === 0 || openMonths[label] === true;
  const toggleMonth = label =>
    setOpenMonths(prev => ({ ...prev, [label]: !prev[label] }));

  return (
    <div className="app-container">
      <header>
        <h1>Takshashila Insights Digest</h1>
        {data.lastUpdated && (
          <p style={{fontSize: '0.8rem', marginTop: '0.5rem', opacity: 0.7}}>
            Last updated: {new Date(data.lastUpdated).toLocaleDateString()}
          </p>
        )}
      </header>

      <div className="filter-bar">
        {allTopics.map(topic => (
          <button 
            key={topic}
            className={`filter-btn ${activeFilter === topic ? 'active' : ''}`}
            onClick={() => setActiveFilter(topic)}
          >
            {topic}
          </button>
        ))}
      </div>

      <main>
        {months.length === 0 ? (
          <div className="glass" style={{padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)'}}>
            No articles found for this filter.
          </div>
        ) : (
          months.map(([label, monthArticles], idx) => {
            const open = isOpen(label, idx);
            // The newest month (idx 0, unfiltered) is the headline digest and
            // isn't collapsible; everything after it sits under "Archive".
            const isDigest = idx === 0 && !filtering;
            return (
              <section key={label} className="month-section">
                {idx === 1 && !filtering && <h2 className="archive-heading">Archive</h2>}
                {isDigest ? (
                  <h2 className="month-heading">{label}</h2>
                ) : (
                  <button
                    className="month-toggle"
                    aria-expanded={open}
                    onClick={() => toggleMonth(label)}
                  >
                    <span>{label}</span>
                    <span className="month-count">
                      {monthArticles.length}
                      <ChevronDown
                        size={18}
                        style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                      />
                    </span>
                  </button>
                )}
                {open && (
                  <div className="articles-list">
                    {monthArticles.map(article => (
                      <ArticleCard key={article.id || article.url} article={article} />
                    ))}
                  </div>
                )}
              </section>
            );
          })
        )}
      </main>

      <footer>
        <p>Powered by AI Summaries &bull; Takshashila Institution</p>
      </footer>
    </div>
  );
}

export default App;
