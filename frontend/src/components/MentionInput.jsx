import React, { useState, useRef, useEffect } from 'react';
import Avatar from './Avatar';

/**
 * MentionInput — textarea that shows a @mention picker when user types @.
 * collaborators: [{ userId, username, name }]
 * value / onChange / onSubmit / placeholder — standard textarea props
 */
export default function MentionInput({ value, onChange, onSubmit, placeholder, collaborators = [] }) {
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [atPos, setAtPos] = useState(-1);
  const textareaRef = useRef(null);

  const filtered = collaborators.filter(c =>
    c.username && (!query || c.username.startsWith(query.toLowerCase()))
  );

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !showPicker) {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    if (e.key === 'Escape') { setShowPicker(false); return; }
  };

  const handleChange = (e) => {
    const text = e.target.value;
    onChange(text);

    const cursor = e.target.selectionStart;
    const before = text.slice(0, cursor);
    const match = before.match(/@([a-z0-9_]*)$/);
    if (match) {
      setAtPos(before.lastIndexOf('@'));
      setQuery(match[1]);
      setShowPicker(true);
    } else {
      setShowPicker(false);
      setAtPos(-1);
    }
  };

  const insertMention = (username) => {
    const cursor = textareaRef.current?.selectionStart || 0;
    const before = value.slice(0, atPos);
    const after = value.slice(cursor);
    const newText = before + '@' + username + ' ' + after;
    onChange(newText);
    setShowPicker(false);
    setQuery('');
    setTimeout(() => {
      const pos = (before + '@' + username + ' ').length;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    }, 0);
  };

  // Render comment text with @mentions highlighted
  const renderText = (text) =>
    text.split(/(@[a-z0-9_]+)/gi).map((part, i) =>
      /^@[a-z0-9_]+$/i.test(part)
        ? <span key={i} style={{ color: 'var(--accent)', fontWeight: '700' }}>{part}</span>
        : part
    );

  MentionInput.renderText = renderText;

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Write a comment… (@ to mention)'}
        rows={2}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: '12px',
          border: '1px solid var(--border)', background: 'var(--surface2)',
          color: 'var(--text)', fontSize: '13px', fontFamily: 'inherit',
          resize: 'none', outline: 'none', boxSizing: 'border-box', lineHeight: '1.5',
        }}
      />
      {showPicker && filtered.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, minWidth: '200px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '12px', overflow: 'hidden', marginBottom: '4px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)', zIndex: 200,
        }}>
          {filtered.slice(0, 6).map(c => (
            <button
              key={c.userId || c.username}
              onMouseDown={e => { e.preventDefault(); insertMention(c.username); }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Avatar name={c.name} src={c.avatarUrl} size={28} />
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text)' }}>{c.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--accent)' }}>@{c.username}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
