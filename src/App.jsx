import React, { useState, useMemo } from 'react';
import { ExternalLink, Tag, Hash, BookOpen } from 'lucide-react';
import data from './data/articles.json';
import './index.css';

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

  const filteredArticles = useMemo(() => {
    if (activeFilter === 'All') return articles;
    return articles.filter(a => a.topics?.includes(activeFilter));
  }, [articles, activeFilter]);

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

      <main className="articles-list">
        {filteredArticles.length === 0 ? (
          <div className="glass" style={{padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)'}}>
            No articles found for this filter.
          </div>
        ) : (
          filteredArticles.map(article => (
            <ArticleCard key={article.id || article.url} article={article} />
          ))
        )}
      </main>

      <footer>
        <p>Powered by AI Summaries &bull; Takshashila Institution</p>
      </footer>
    </div>
  );
}

export default App;
