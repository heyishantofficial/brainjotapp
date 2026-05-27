import React, { useState, useEffect, useRef } from 'react';

export default function CommandPalette({ projects, isOpen, setIsOpen, onSelectProject }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  // Keyboard listener for Cmd+F / Ctrl+F
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const searchResults = [];
  if (query.trim().length > 0) {
    const q = query.toLowerCase();
    (projects || []).forEach(p => {
      // Check project match
      if (p.title.toLowerCase().includes(q) || (p.subtitle && p.subtitle.toLowerCase().includes(q))) {
        searchResults.push({ type: 'project', project: p, id: `p_${p.id}` });
      }
      // Check tasks match
      (p.tasks || []).forEach(t => {
        if (t.text.toLowerCase().includes(q) || (t.notes && t.notes.toLowerCase().includes(q))) {
          searchResults.push({ type: 'task', project: p, task: t, id: `t_${t.id}` });
        }
      });
    });
  }

  // Cap results at 10 to keep it manageable
  const results = searchResults.slice(0, 10);

  const handleNavigate = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length > 0) {
        handleSelect(results[selectedIndex]);
      }
    }
  };

  const handleSelect = (item) => {
    onSelectProject(item.project.id, item.type === 'task' ? item.task.id : null);
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="lightbox-overlay" onClick={() => setIsOpen(false)} style={{ alignItems: 'flex-start', paddingTop: '10vh' }}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <input 
          ref={inputRef}
          className="cmd-input"
          placeholder="Search projects, tasks, notes..."
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
          onKeyDown={handleNavigate}
        />
        
        {query.trim().length > 0 && (
          <div className="cmd-results">
            {results.length === 0 ? (
              <div className="cmd-empty">No results found for "{query}"</div>
            ) : (
              results.map((item, idx) => (
                <div 
                  key={item.id} 
                  className={`cmd-item ${idx === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="cmd-item-icon">
                    {item.type === 'project' ? '📁' : '✓'}
                  </div>
                  <div className="cmd-item-text">
                    <div className="cmd-item-title">
                      {item.type === 'project' ? item.project.title : item.task.text}
                    </div>
                    <div className="cmd-item-sub">
                      {item.type === 'project' ? item.project.subtitle : `In project: ${item.project.title}`}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
