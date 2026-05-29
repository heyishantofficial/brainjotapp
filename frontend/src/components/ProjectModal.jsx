import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const COLORS = ['#D4FF32','#FF5B37','#FF9BE6','#A1E6FF','#B882FF','#00FF9D','#FFD166','#FF6B6B'];
const COLOR_NAMES = { '#D4FF32': 'Lime', '#FF5B37': 'Orange', '#FF9BE6': 'Pink', '#A1E6FF': 'Sky blue', '#B882FF': 'Purple', '#00FF9D': 'Mint', '#FFD166': 'Yellow', '#FF6B6B': 'Coral' };

export default function ProjectModal({ onClose, onSuccess, project = null, spaceId = '' }) {
  const [title, setTitle] = useState(project ? project.title : '');
  const [subtitle, setSubtitle] = useState(project ? project.subtitle : '');
  const [tag, setTag] = useState(project ? project.tag : 'Project');
  const [selectedColor, setSelectedColor] = useState(project ? project.color : COLORS[0]);
  
  const titleRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
    const el = dialogRef.current;
    if (!el) return;
    const prev = document.activeElement;
    const trap = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(el.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    el.addEventListener('keydown', trap);
    return () => { el.removeEventListener('keydown', trap); prev?.focus(); };
  }, [onClose]);

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
    <div className="modal-bg open" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title" ref={dialogRef}>
        <div className="modal-title" id="project-modal-title">{project ? 'Edit project' : 'Add new project'}</div>
        <div className="modal-field">
          <label>Project name *</label>
          <input type="text" placeholder="e.g. My New Brand" ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
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
          <div className="color-row" style={{ marginBottom: '16px' }} role="radiogroup" aria-label="Project color">
            {COLORS.map(c => (
              <button
                key={c}
                className={`color-swatch ${c === selectedColor ? 'selected' : ''}`}
                style={{ background: c, border: 'none', cursor: 'pointer' }}
                onClick={() => setSelectedColor(c)}
                aria-label={`${COLOR_NAMES[c] || c} color`}
                aria-pressed={c === selectedColor}
              />
            ))}
            {/* Native color picker as a swatch */}
            <div
              className={`color-swatch ${!COLORS.includes(selectedColor) ? 'selected' : ''}`}
              style={{ background: !COLORS.includes(selectedColor) ? selectedColor : 'linear-gradient(45deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #8b00ff)', border: 'none', position: 'relative', cursor: 'pointer' }}
              onClick={() => document.getElementById('custom-color-picker').click()}
              aria-label="Custom color"
              role="button"
            >
              <input
                id="custom-color-picker"
                type="color"
                value={selectedColor}
                onChange={e => setSelectedColor(e.target.value)}
                style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                aria-label="Choose custom color"
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
