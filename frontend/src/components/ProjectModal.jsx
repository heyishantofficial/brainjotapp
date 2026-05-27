import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const COLORS = ['#D4FF32','#FF5B37','#FF9BE6','#A1E6FF','#B882FF','#00FF9D','#FFD166','#FF6B6B'];

export default function ProjectModal({ onClose, onSuccess, project = null, spaceId = '' }) {
  const [title, setTitle] = useState(project ? project.title : '');
  const [subtitle, setSubtitle] = useState(project ? project.subtitle : '');
  const [tag, setTag] = useState(project ? project.tag : 'Project');
  const [selectedColor, setSelectedColor] = useState(project ? project.color : COLORS[0]);
  
  const titleRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!title.trim()) {
      titleRef.current?.focus();
      return;
    }
    
    if (project) {
      // Edit mode
      const r = await api('rename_project', { 
        projectId: project.id, 
        title: title.trim(), 
        subtitle, 
        tag: tag || 'Project', 
        color: selectedColor 
      });
      if (r.ok) onSuccess(project.id);
    } else {
      // Add mode
      const r = await api('add_project', {
        title: title.trim(),
        subtitle,
        tag: tag || 'Project',
        color: selectedColor,
        spaceId,
      });
      if (r.ok) onSuccess(r.id);
    }
  };

  return (
    <div className="modal-bg open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">{project ? 'Edit project' : 'Add new project'}</div>
        <div className="modal-field">
          <label>Project name *</label>
          <input type="text" placeholder="e.g. My New Brand" ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>Subtitle / description</label>
          <input type="text" placeholder="e.g. Building audience on Instagram" value={subtitle} onChange={e => setSubtitle(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>Tag</label>
          <input type="text" placeholder="e.g. Brand, Personal, Agency" value={tag} onChange={e => setTag(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>Color</label>
          <div className="color-row" style={{ marginBottom: '16px' }}>
            {COLORS.map(c => (
              <div 
                key={c}
                className={`color-swatch ${c === selectedColor ? 'selected' : ''}`} 
                style={{background: c}} 
                onClick={() => setSelectedColor(c)}
              ></div>
            ))}
            {/* Native color picker as a swatch */}
            <div 
              className={`color-swatch ${!COLORS.includes(selectedColor) ? 'selected' : ''}`}
              style={{ background: !COLORS.includes(selectedColor) ? selectedColor : 'linear-gradient(45deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #8b00ff)', border: 'none', position: 'relative' }}
              onClick={() => document.getElementById('custom-color-picker').click()}
            >
              <input 
                id="custom-color-picker"
                type="color" 
                value={selectedColor} 
                onChange={e => setSelectedColor(e.target.value)}
                style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
             <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--muted)' }}>Hex</span>
             <input 
               type="text" 
               placeholder="#000000" 
               value={selectedColor} 
               onChange={e => {
                 const val = e.target.value;
                 if (/^#?[0-9A-Fa-f]{0,6}$/.test(val)) {
                   setSelectedColor(val.startsWith('#') ? val : '#' + val);
                 }
               }} 
               style={{ 
                 width: '100px', 
                 background: 'var(--surface2)', 
                 border: '0.5px solid var(--border2)', 
                 borderRadius: '8px', 
                 padding: '6px 10px', 
                 color: 'var(--text)', 
                 fontFamily: 'monospace',
                 fontSize: '14px',
                 outline: 'none'
               }} 
             />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={submit}>{project ? 'Save changes' : 'Create project'}</button>
        </div>
      </div>
    </div>
  );
}
