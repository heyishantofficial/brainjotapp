import React, { useEffect, useRef } from 'react';
import { api } from '../api';
import DOMPurify from 'dompurify';

export default function WordpadModal({ project, taskId, type, initialContent, onClose, onSave, onToast }) {
  const editorRef = useRef(null);

  useEffect(() => {
    // initialContent already contains the most up-to-date local state
    // from either the textarea or the inline contentEditable div
    
    if (editorRef.current) {
      editorRef.current.innerHTML = DOMPurify.sanitize(initialContent || '');
      setTimeout(() => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        if (typeof window.getSelection !== "undefined" && typeof document.createRange !== "undefined") {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false); // false means collapse to end
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

  return (
    <div className="modal-bg open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-title">Task notes wordpad</div>
        <div className="wordpad-toolbar">
          <button className="wordpad-btn" onClick={() => exec('bold')}><b>B</b></button>
          <button className="wordpad-btn" onClick={() => exec('italic')}><i>I</i></button>
          <button className="wordpad-btn" onClick={() => exec('underline')}><u>U</u></button>
          <button className="wordpad-btn" onClick={() => exec('insertUnorderedList')}>• List</button>
          <button className="wordpad-btn" onClick={() => exec('insertOrderedList')}>1. List</button>
          <button className="wordpad-btn" onClick={() => exec('formatBlock', '<blockquote>')}>❝ Quote</button>
          <button className="wordpad-btn" onClick={() => exec('removeFormat')}>Clear</button>
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
