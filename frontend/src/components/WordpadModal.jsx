import React, { useEffect, useRef } from 'react';
import { api } from '../api';
import DOMPurify from 'dompurify';

export default function WordpadModal({ project, taskId, type, initialContent, onClose, onSave, onToast }) {
  const editorRef = useRef(null);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = DOMPurify.sanitize(initialContent || '');
      setTimeout(() => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        if (typeof window.getSelection !== 'undefined' && typeof document.createRange !== 'undefined') {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }, 100);
    }
  }, [initialContent]);

  const exec = (cmd, val = null) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
  };

  const save = async () => {
    const html = editorRef.current.innerHTML;
    if (type === 'task') {
      await api('save_task_rich_notes', { projectId: project.id, taskId, notes: html });
    } else {
      await api('save_project_rich_notes', { projectId: project.id, notes: html });
    }
    onToast('Wordpad notes saved');
    onSave();
    onClose();
  };

  const sep = (
    <span style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '2px 4px', alignSelf: 'stretch', flexShrink: 0 }} />
  );

  return (
    <div className="modal-bg open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-title">{type === 'task' ? 'Task notes' : 'Project notes'}</div>

        <div className="wordpad-toolbar" style={{ flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>

          {/* Text style */}
          <button className="wordpad-btn" onClick={() => exec('bold')} title="Bold"><b>B</b></button>
          <button className="wordpad-btn" onClick={() => exec('italic')} title="Italic"><i>I</i></button>
          <button className="wordpad-btn" onClick={() => exec('underline')} title="Underline"><u>U</u></button>
          <button className="wordpad-btn" onClick={() => exec('strikeThrough')} title="Strikethrough"><s style={{ textDecorationColor: 'currentColor' }}>S</s></button>

          {sep}

          {/* Headings */}
          <button className="wordpad-btn" onClick={() => exec('formatBlock', 'h1')} title="Heading 1" style={{ fontWeight: '900', fontSize: '13px', letterSpacing: '-0.3px' }}>H1</button>
          <button className="wordpad-btn" onClick={() => exec('formatBlock', 'h2')} title="Heading 2" style={{ fontWeight: '900', fontSize: '12px', letterSpacing: '-0.3px' }}>H2</button>
          <button className="wordpad-btn" onClick={() => exec('formatBlock', 'h3')} title="Heading 3" style={{ fontWeight: '900', fontSize: '11px', letterSpacing: '-0.3px' }}>H3</button>
          <button className="wordpad-btn" onClick={() => exec('formatBlock', 'p')} title="Normal paragraph" style={{ fontSize: '12px', fontWeight: '600' }}>¶</button>

          {sep}

          {/* Lists */}
          <button className="wordpad-btn" onClick={() => exec('insertUnorderedList')} title="Bullet list">• List</button>
          <button className="wordpad-btn" onClick={() => exec('insertOrderedList')} title="Numbered list">1. List</button>

          {sep}

          {/* Alignment */}
          <button className="wordpad-btn" onClick={() => exec('justifyLeft')} title="Align left" style={{ fontSize: '13px' }}>⇤</button>
          <button className="wordpad-btn" onClick={() => exec('justifyCenter')} title="Align center" style={{ fontSize: '13px' }}>⇔</button>
          <button className="wordpad-btn" onClick={() => exec('justifyRight')} title="Align right" style={{ fontSize: '13px' }}>⇥</button>

          {sep}

          {/* Font size */}
          <select
            className="wordpad-btn"
            style={{ padding: '0 6px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: '700', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', minWidth: '72px' }}
            defaultValue=""
            title="Font size"
            onChange={e => {
              if (!e.target.value) return;
              exec('fontSize', e.target.value);
              e.target.value = '';
            }}
          >
            <option value="" disabled>Size</option>
            <option value="1">Small</option>
            <option value="3">Normal</option>
            <option value="5">Large</option>
            <option value="7">Huge</option>
          </select>

          {sep}

          {/* Text color */}
          <label
            className="wordpad-btn"
            title="Text color"
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', paddingRight: '8px' }}
          >
            <span style={{ fontSize: '13px', fontWeight: '900', lineHeight: 1 }}>A</span>
            <input
              type="color"
              defaultValue="#ffffff"
              style={{ width: '18px', height: '14px', padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: '3px' }}
              onChange={e => exec('foreColor', e.target.value)}
            />
          </label>

          {/* Highlight color */}
          <label
            className="wordpad-btn"
            title="Highlight text"
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', paddingRight: '8px' }}
          >
            <span style={{ fontSize: '11px', fontWeight: '900', background: '#D4FF32', color: '#000', padding: '1px 4px', borderRadius: '3px', lineHeight: 1.3 }}>ab</span>
            <input
              type="color"
              defaultValue="#D4FF32"
              style={{ width: '18px', height: '14px', padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: '3px' }}
              onChange={e => exec('hiliteColor', e.target.value)}
            />
          </label>

        </div>

        <div
          className="wordpad-editor"
          ref={editorRef}
          contentEditable="true"
        ></div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={save}>Save notes</button>
        </div>
      </div>
    </div>
  );
}
