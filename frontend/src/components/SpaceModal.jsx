import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const SPACE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#06b6d4', '#6366f1'];
const SPACE_ICONS  = ['📁', '💼', '🏠', '📚', '🎨', '🔬', '💡', '🚀', '🎯', '🌱', '⚡', '🛠️', '🎵', '🏋️', '✈️', '💰'];

export default function SpaceModal({ onClose, onSuccess, space = null }) {
  const [title,       setTitle]       = useState(space?.title       ?? '');
  const [icon,        setIcon]        = useState(space?.icon        ?? '📁');
  const [color,       setColor]       = useState(space?.color       ?? SPACE_COLORS[0]);
  const [description, setDescription] = useState(space?.description ?? '');
  const titleRef = useRef(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = async () => {
    if (!title.trim()) { titleRef.current?.focus(); return; }
    if (space) {
      const r = await api('rename_space', { spaceId: space.id, title: title.trim(), icon, color, description });
      if (r.ok) onSuccess();
    } else {
      const r = await api('add_space', { title: title.trim(), icon, color, description });
      if (r.ok) onSuccess(r.id);
    }
  };

  return (
    <div className="modal-bg open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">{space ? 'Edit Space' : 'New Space'}</div>

        <div className="modal-field">
          <label>Space name *</label>
          <input
            type="text"
            placeholder="e.g. Work, Personal, Study"
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>

        <div className="modal-field">
          <label>Icon</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {SPACE_ICONS.map(em => (
              <button
                key={em}
                onClick={() => setIcon(em)}
                style={{
                  fontSize: '20px',
                  padding: '6px 9px',
                  borderRadius: '10px',
                  border: `2px solid ${icon === em ? color : 'var(--border)'}`,
                  background: icon === em ? `${color}22` : 'var(--surface2)',
                  cursor: 'pointer',
                  lineHeight: 1,
                }}
              >{em}</button>
            ))}
          </div>
        </div>

        <div className="modal-field">
          <label>Color</label>
          <div className="color-row">
            {SPACE_COLORS.map(c => (
              <div
                key={c}
                className={`color-swatch ${c === color ? 'selected' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="modal-field">
          <label>Description <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
          <input
            type="text"
            placeholder="What is this space for?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={submit}>{space ? 'Save changes' : 'Create space'}</button>
        </div>
      </div>
    </div>
  );
}
