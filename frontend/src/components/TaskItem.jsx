import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api, apiUpload } from '../api';
import DOMPurify from 'dompurify';
import MentionInput from './MentionInput';
import Avatar from './Avatar';

const PRIORITIES = {
  urgent: { icon: '🔥', label: 'Urgent' },
  important: { icon: '⚡', label: 'Important' },
  later: { icon: '💤', label: 'Later' }
};

export default function TaskItem({
  task,
  project,
  onToggle,
  onDelete,
  onUpdateText,
  onUpdateMeta,
  onSaveNotes,
  onOpenWordpad,
  onUploadComplete,
  onDeleteFile,
  onOpenLightbox,
  highlighted,
  readOnly = false,
  currentUser,
  collaborators = [],
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [notesStatus, setNotesStatus] = useState('Auto-saves');
  const [chatInput, setChatInput] = useState('');
  const [localComments, setLocalComments] = useState(task.comments || []);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [labelPickerPos, setLabelPickerPos] = useState({ top: 0, left: 0 });
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#6366f1');
  const [savingLabel, setSavingLabel] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState(null);
  const [editingLabelName, setEditingLabelName] = useState('');

  const notesTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const dateInputRef = useRef(null);
  const taskRichNotesRef = useRef(null);
  const lastServerRichNotes = useRef(null);
  const assigneeDropdownRef = useRef(null);
  const chatThreadRef = useRef(null);
  const taskRef = useRef(null);
  const labelPickerRef = useRef(null);

  const fileCount = (task.files || []).length;
  const hasNotes = (task.notes || '').trim().length > 0 || (task.richNotes || '').trim().length > 0;
  const hasRichNotes = task.richNotes && task.richNotes.trim().length > 0 && task.richNotes !== '<br>' && task.richNotes !== '<p><br></p>';

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(event.target)) {
        setShowAssigneeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const currentRich = task.richNotes || task.notes || '';
    if (taskRichNotesRef.current && currentRich !== lastServerRichNotes.current) {
      lastServerRichNotes.current = currentRich;
      taskRichNotesRef.current.innerHTML = DOMPurify.sanitize(currentRich);
    }
  }, [task.richNotes, task.notes]);

  // Sync comments from parent when project data refreshes
  useEffect(() => {
    setLocalComments(task.comments || []);
  }, [task.comments]);

  // Fetch comments once when task is opened; real-time updates arrive via Socket.IO project_updated
  useEffect(() => {
    if (!isOpen) return;
    api('get_task_comments', null, 'GET',
      `&projectId=${encodeURIComponent(project.id)}&taskId=${encodeURIComponent(task.id)}`)
      .then(r => { if (r?.comments) setLocalComments(r.comments); });
  }, [isOpen, project.id, task.id]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (isOpen && chatThreadRef.current) {
      chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
    }
  }, [localComments, isOpen]);

  // Auto-open discussion and scroll into view when this task is highlighted via notification
  useEffect(() => {
    if (highlighted) {
      setIsOpen(true);
      setTimeout(() => taskRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }, [highlighted]);

  const closeLabelPicker = () => { setShowLabelPicker(false); setCreatingLabel(false); setNewLabelName(''); setEditingLabelId(null); setEditingLabelName(''); };

  const saveRenameLabel = async (labelId) => {
    if (!editingLabelName.trim()) { setEditingLabelId(null); return; }
    await api('update_project_label', { projectId: project.id, labelId, name: editingLabelName.trim() });
    setEditingLabelId(null);
    setEditingLabelName('');
    onUploadComplete();
  };

  const LABEL_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#6366f1','#94a3b8'];
  const projectLabels = project.labels || [];
  const currentLabel = projectLabels.find(l => l.id === task.badge) || null;

  const selectLabel = (labelId) => {
    onUpdateMeta('badge', labelId);
    setShowLabelPicker(false);
  };

  const saveNewLabel = async () => {
    if (!newLabelName.trim() || savingLabel) return;
    setSavingLabel(true);
    const r = await api('add_project_label', { projectId: project.id, name: newLabelName.trim(), color: newLabelColor });
    setSavingLabel(false);
    if (r?.ok) {
      setCreatingLabel(false);
      setNewLabelName('');
      setNewLabelColor('#6366f1');
      onUpdateMeta('badge', r.id);
      onUploadComplete();
    }
  };

  const deleteLabel = async (e, labelId) => {
    e.stopPropagation();
    await api('delete_project_label', { projectId: project.id, labelId });
    onUploadComplete();
  };

  const priorityMeta = PRIORITIES[task.priority] || null;
  const assignees = task.assignees || (task.assignee ? [task.assignee] : []);
  
  const getInitials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';

  const formatDeadline = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
  };

  const deadlineFormatted = formatDeadline(task.deadline);

  // Overdue/due-today calculation (never shown on completed tasks)
  const deadlineStatus = (() => {
    if (!task.deadline || task.done) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(task.deadline + 'T00:00:00');
    const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { type: 'overdue', days: Math.abs(diffDays) };
    if (diffDays === 0) return { type: 'today' };
    if (diffDays === 1) return { type: 'tomorrow' };
    return null;
  })();

  const fileIcon = (ext) => {
    const m = {pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',ppt:'📑',pptx:'📑',mp4:'🎬',mov:'🎬',zip:'🗜️',txt:'📃',csv:'📊'};
    return m[ext] || '📁';
  };

  const formatSize = (b) => {
    if(b<1024) return b+'B';
    if(b<1048576) return Math.round(b/1024)+'KB';
    return (b/1048576).toFixed(1)+'MB';
  };



  const handleInlineRichNotes = (e) => {
    setNotesStatus('Saving...');
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    const html = e.target.innerHTML;
    notesTimerRef.current = setTimeout(() => {
      onSaveNotes(html);
      setNotesStatus('Saved');
    }, 1000);
  };

  const handleLinkClick = (e) => {
    if (e.target.tagName === 'A') {
      e.preventDefault();
      window.open(e.target.href, '_blank', 'noopener,noreferrer');
    }
  };

  const handleNotesPaste = (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    try {
      const url = new URL(text.trim());
      if (['http:', 'https:'].includes(url.protocol)) {
        e.preventDefault();
        const cleanHtml = DOMPurify.sanitize(`<a href="${url.href}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline;color:var(--accent,#0066cc);cursor:pointer;">${url.href}</a>&nbsp;`);
        document.execCommand('insertHTML', false, cleanHtml);
      }
    } catch { /* ignore invalid URLs */ }
  };

  const linkifyOnBlur = () => {
    const el = taskRichNotesRef.current;
    if (!el) return;
    let html = el.innerHTML;
    const urlRegex = /(?<!href="|href=')\b(https?:\/\/[^\s<]+)(?![^<]*>|[^<>]*<\/a>)/gi;
    html = html.replace(urlRegex, (url) => {
      try {
        const parsed = new URL(url);
        if (['http:', 'https:'].includes(parsed.protocol)) {
          return `<a href="${parsed.href}" target="_blank" rel="noopener noreferrer">${parsed.href}</a>`;
        }
      } catch { /* ignore invalid URLs */ }
      return url;
    });
    
    const cleanHtml = DOMPurify.sanitize(html);
    if (cleanHtml !== el.innerHTML) {
      el.innerHTML = cleanHtml;
      handleInlineRichNotes({ target: el });
    }
  };

  const handleSendComment = async () => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    const mentions = [...text.matchAll(/@([a-z0-9_]+)/gi)].map(m => m[1].toLowerCase());
    setChatInput('');
    const tempId = 'tmp_' + Date.now();
    setLocalComments(prev => [...prev, {
      id: tempId, userId: currentUser?.id, name: currentUser?.name || 'Me',
      username: currentUser?.username || '', text, mentions, createdAt: new Date().toISOString(),
    }]);
    const r = await api('add_task_comment', { projectId: project.id, taskId: task.id, text, mentions });
    if (r?.comment) {
      setLocalComments(prev => prev.map(c => c.id === tempId ? r.comment : c));
    }
    onUploadComplete();
  };

  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      await apiUpload(files[i], { type: 'task', projectId: project.id, taskId: task.id });
    }
    fileInputRef.current.value = '';
    onUploadComplete();
  };

  const submitEdit = () => {
    if (editText.trim() && editText !== task.text) {
      onUpdateText(editText.trim());
    }
    setIsEditing(false);
  };

  return (
    <div
      ref={taskRef}
      className={`task-item ${highlighted ? 'highlighted' : ''}`}
      style={{
        '--hover-glow': project.color ? `${project.color}66` : 'rgba(255, 255, 255, 0.12)',
        '--hover-shadow': project.color ? `${project.color}22` : 'rgba(0,0,0,0.12)'
      }}
    >
      <div className="task-row" onClick={() => !isEditing && setIsOpen(!isOpen)}>
        <div className={`task-check ${task.done ? 'done' : ''} ${readOnly ? 'readonly' : ''}`} onClick={(e) => { e.stopPropagation(); if(!readOnly) onToggle(); }}></div>
        
        {isEditing ? (
          <div className="task-text-edit" onClick={e => e.stopPropagation()}>
            <input 
              autoFocus
              className="task-text-input" 
              value={editText} 
              onChange={e => setEditText(e.target.value)} 
              onBlur={submitEdit}
              onKeyDown={e => e.key === 'Enter' && submitEdit()}
            />
          </div>
        ) : (
          <span
            className={`task-text-el ${task.done ? 'done' : ''}`}
            onDoubleClick={(e) => { e.stopPropagation(); if(!readOnly) { setIsEditing(true); setEditText(task.text); } }}
            title={readOnly ? undefined : 'Double-click to edit'}
          >
            {task.createdAt && <span style={{fontSize: '11px', color: 'var(--muted)', marginRight: '8px', fontWeight: '500'}}>{new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
            {task.text}
          </span>
        )}

        {!isEditing && (
          <div style={{ flexShrink: 0 }} ref={labelPickerRef}>
            {currentLabel ? (
              <button
                onClick={(e) => { e.stopPropagation(); if (!readOnly) { const r = e.currentTarget.getBoundingClientRect(); setLabelPickerPos({ top: r.bottom + 6, left: r.left }); setShowLabelPicker(v => !v); } }}
                style={{ background: `${currentLabel.color}22`, color: currentLabel.color, border: `1px solid ${currentLabel.color}55`, borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '700', cursor: readOnly ? 'default' : 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: currentLabel.color, flexShrink: 0 }} />
                {currentLabel.name}
              </button>
            ) : !readOnly ? (
              <button
                onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setLabelPickerPos({ top: r.bottom + 6, left: r.left }); setShowLabelPicker(v => !v); }}
                style={{ background: 'transparent', border: '1px dashed var(--border)', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', color: 'var(--faint)', cursor: 'pointer', fontWeight: '600' }}
              >
                + label
              </button>
            ) : null}

            {showLabelPicker && createPortal(
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                  onClick={(e) => { e.stopPropagation(); closeLabelPicker(); }}
                />
                <div
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                  style={{ position: 'fixed', top: labelPickerPos.top, left: labelPickerPos.left, zIndex: 9999, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.35)', minWidth: '200px', padding: '6px' }}
                >
                  {currentLabel && (
                    <button onClick={() => selectLabel('')} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '7px 10px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--muted)', fontWeight: '600', textAlign: 'left' }} onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      ✕ No label
                    </button>
                  )}

                  {projectLabels.map(l => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', borderRadius: '8px' }} onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      {editingLabelId === l.id ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 6px' }} onClick={e => e.stopPropagation()}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: l.color, flexShrink: 0, display: 'inline-block', marginLeft: '4px' }} />
                          <input
                            autoFocus
                            value={editingLabelName}
                            onChange={e => setEditingLabelName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveRenameLabel(l.id); if (e.key === 'Escape') { setEditingLabelId(null); setEditingLabelName(''); } }}
                            onBlur={() => saveRenameLabel(l.id)}
                            style={{ flex: 1, padding: '3px 6px', borderRadius: '6px', border: '1px solid var(--accent)', background: 'var(--surface2)', color: 'var(--text)', fontSize: '12px', outline: 'none' }}
                          />
                        </div>
                      ) : (
                        <button onClick={() => selectLabel(l.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '700', color: 'var(--text)', textAlign: 'left' }}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: l.color, flexShrink: 0, display: 'inline-block' }} />
                          {l.name}
                          {l.id === task.badge && <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: '11px' }}>✓</span>}
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setEditingLabelId(l.id); setEditingLabelName(l.name); }} style={{ padding: '4px 6px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: '11px' }} title="Rename label">✎</button>
                      <button onClick={(e) => deleteLabel(e, l.id)} style={{ padding: '4px 8px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: '11px' }} title="Delete label">✕</button>
                    </div>
                  ))}

                  {projectLabels.length === 0 && !creatingLabel && (
                    <div style={{ padding: '8px 10px', fontSize: '12px', color: 'var(--faint)' }}>No labels yet</div>
                  )}

                  {!creatingLabel ? (
                    <button onClick={() => setCreatingLabel(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '7px 10px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--accent)', fontWeight: '700', marginTop: '2px' }} onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      + Create label
                    </button>
                  ) : (
                    <div style={{ padding: '8px', borderTop: projectLabels.length > 0 ? '1px solid var(--border)' : 'none', marginTop: projectLabels.length > 0 ? '4px' : 0 }}>
                      <input
                        autoFocus
                        value={newLabelName}
                        onChange={e => setNewLabelName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveNewLabel(); if (e.key === 'Escape') setCreatingLabel(false); }}
                        placeholder="Label name"
                        style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: '12px', boxSizing: 'border-box', marginBottom: '8px', outline: 'none' }}
                      />
                      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
                        {LABEL_COLORS.map(c => (
                          <button key={c} onClick={() => setNewLabelColor(c)} style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', outline: newLabelColor === c ? '2px solid white' : 'none', outlineOffset: '1px' }} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={saveNewLabel} disabled={savingLabel || !newLabelName.trim()} style={{ flex: 1, padding: '6px', borderRadius: '8px', background: 'var(--accent)', border: 'none', color: '#000', fontSize: '12px', fontWeight: '800', cursor: savingLabel || !newLabelName.trim() ? 'default' : 'pointer', opacity: savingLabel || !newLabelName.trim() ? 0.5 : 1 }}>
                          {savingLabel ? '…' : 'Save'}
                        </button>
                        <button onClick={() => { setCreatingLabel(false); setNewLabelName(''); }} style={{ padding: '6px 10px', borderRadius: '8px', background: 'var(--surface2)', border: 'none', color: 'var(--muted)', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>,
              document.body
            )}
          </div>
        )}

        {!isEditing && (
          <div className="task-meta-row">
            {priorityMeta && <span className={`meta-pill priority-${task.priority}`} title={priorityMeta.label}>{priorityMeta.icon}</span>}
            {deadlineFormatted && (
              <span 
                className={`meta-pill deadline-pill ${
                  deadlineStatus?.type === 'overdue' ? 'deadline-overdue' :
                  deadlineStatus?.type === 'today' ? 'deadline-today' :
                  deadlineStatus?.type === 'tomorrow' ? 'deadline-tomorrow' : ''
                }`} 
                title={task.deadline}
              >
                {deadlineStatus?.type === 'overdue' 
                  ? `🔴 ${deadlineStatus.days}d overdue`
                  : deadlineStatus?.type === 'today'
                  ? `🟠 Due today`
                  : deadlineStatus?.type === 'tomorrow'
                  ? `🟡 Due tomorrow`
                  : `🗓 ${deadlineFormatted}`
                }
              </span>
            )}
            {task.comments?.length > 0 && <span className="task-file-count" title={`${task.comments.length} comments`}>💬 {task.comments.length}</span>}
            {fileCount > 0 && <span className="task-file-count">📎 {fileCount}</span>}
            {hasNotes && <span style={{fontSize: '10px', color: 'var(--muted)'}}>📝</span>}
          </div>
        )}

        {!isEditing && assignees.length > 0 && (
          <div style={{ display: 'flex', marginLeft: 'auto', marginRight: '8px' }}>
            {assignees.map((aid, idx) => {
              const collab = collaborators.find(c => c.id === aid);
              const name = aid === 'me' ? (currentUser?.name || 'Me') : collab?.name || 'Guest';
              const src = aid === 'me' ? (currentUser?.avatarUrl || '') : (collab?.avatarUrl || '');
              return (
                <div
                  key={aid}
                  className="has-tooltip"
                  style={{
                    marginLeft: idx === 0 ? '0' : '-8px',
                    border: '2px solid var(--surface)',
                    borderRadius: '50%',
                    position: 'relative',
                    zIndex: assignees.length - idx,
                  }}
                >
                  <div className="tooltip-content" style={{ bottom: '130%', minWidth: '80px' }}>{name}</div>
                  <Avatar name={name} src={src} size={24} />
                </div>
              );
            })}
          </div>
        )}
        {!isEditing && !readOnly && <button className="task-edit-btn" onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditText(task.text); }} title="Edit task text">✎</button>}
        {!isEditing && !readOnly && <button className="task-del-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete task">×</button>}
        {!isEditing && <span className={`task-expand-arrow ${isOpen ? 'open' : ''}`}>▶</span>}
      </div>

      <div className={`task-panel ${isOpen ? 'open' : ''}`}>
        <div className="task-controls-grid">
          <div>
            <div className="task-panel-label">Priority</div>
            <select className="task-select" value={task.priority || ''} onChange={e => onUpdateMeta('priority', e.target.value)} disabled={readOnly}>
              <option value="">None</option>
              <option value="urgent">🔥 Urgent</option>
              <option value="important">⚡ Important</option>
              <option value="later">💤 Later</option>
            </select>
          </div>
          <div 
            style={{ cursor: readOnly ? 'default' : 'pointer' }} 
            onClick={() => !readOnly && dateInputRef.current && dateInputRef.current.showPicker()}
          >
            <div className="task-panel-label">Deadline</div>
            <input 
              ref={dateInputRef}
              type="date" 
              className="task-date-input" 
              style={{ cursor: readOnly ? 'default' : 'pointer' }}
              value={task.deadline || ''} 
              onChange={e => onUpdateMeta('deadline', e.target.value)} 
              disabled={readOnly} 
            />
          </div>
          <div style={{ position: 'relative' }} ref={assigneeDropdownRef}>
            <div className="task-panel-label">Assignees</div>
            <div 
              className="task-select" 
              style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: '6px', 
                padding: '8px 12px', 
                minHeight: '42px',
                cursor: readOnly ? 'default' : 'pointer',
                opacity: readOnly ? 0.7 : 1
              }}
              onClick={() => !readOnly && setShowAssigneeDropdown(!showAssigneeDropdown)}
            >
              {assignees.length === 0 && <span style={{ color: 'var(--faint)' }}>Unassigned</span>}
              {assignees.map(aid => {
                const name = aid === 'me' ? 'Me' : collaborators.find(c => c.id === aid)?.name || 'Guest';
                return (
                  <span key={aid} className="meta-pill active" style={{ fontSize: '12px', padding: '2px 8px' }}>
                    {name}
                    {!readOnly && (
                      <span 
                        style={{ marginLeft: '6px', opacity: 0.6, cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = assignees.filter(a => a !== aid);
                          onUpdateMeta('assignees', next);
                        }}
                      >✕</span>
                    )}
                  </span>
                );
              })}
              {!readOnly && <span style={{ marginLeft: 'auto', color: 'var(--faint)', fontSize: '10px' }}>▼</span>}
            </div>

            {showAssigneeDropdown && !readOnly && (
              <div className="role-dropdown" style={{ left: 0, top: '100%', width: '100%', marginTop: '4px' }}>
                <button 
                  className={`role-option ${assignees.includes('me') ? 'active' : ''}`}
                  onClick={() => {
                    const next = assignees.includes('me') ? assignees.filter(a => a !== 'me') : [...assignees, 'me'];
                    onUpdateMeta('assignees', next);
                  }}
                >
                  👤 Me {assignees.includes('me') && '✓'}
                </button>
                {collaborators.map(c => (
                  <button
                    key={c.id}
                    className={`role-option ${assignees.includes(c.id) ? 'active' : ''}`}
                    onClick={() => {
                      const next = assignees.includes(c.id) ? assignees.filter(a => a !== c.id) : [...assignees, c.id];
                      onUpdateMeta('assignees', next);
                    }}
                  >
                    {c.name} {assignees.includes(c.id) && '✓'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="task-panel-label">Notes</div>
        <div className="notes-wrap" style={{ position: 'relative' }}>
          <div 
              ref={taskRichNotesRef}
              className="task-rich-preview" 
              contentEditable={!readOnly}
              placeholder="Add notes for this task..."
              suppressContentEditableWarning={true}
              style={{ minHeight: '72px', padding: '9px 46px 42px 11px', background: 'var(--surface3)', border: '0.5px solid var(--border2)', borderRadius: 'var(--radius-sm)', margin: 0, wordBreak: 'break-word', fontSize: '15px', color: 'var(--text)', outline: 'none' }}
              onInput={readOnly ? undefined : handleInlineRichNotes}
              onClick={handleLinkClick}
              onPaste={readOnly ? undefined : handleNotesPaste}
              onBlur={readOnly ? undefined : linkifyOnBlur}
            ></div>
          {!readOnly && (
            <button className="btn-wordpad-icon" style={{bottom: '5px', right: '5px'}} title="Expand to rich editor" onClick={() => {
              const content = taskRichNotesRef.current ? taskRichNotesRef.current.innerHTML : (task.richNotes || task.notes);
              onOpenWordpad(content);
            }}>⤢</button>
          )}
        </div>
        {!hasRichNotes && !readOnly && <div className="task-notes-hint">{notesStatus}</div>}

        <div className="task-file-section">
          <div className="task-panel-label" style={{marginTop: '10px', marginBottom: '6px'}}>Files for this task</div>
          {!readOnly && (
            <>
              <div 
                className="task-file-drop" 
                onClick={() => fileInputRef.current.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = 'var(--surface3)'; }}
                onDragLeave={e => { e.currentTarget.style.background = ''; }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.style.background = '';
                  if (e.dataTransfer.files) handleFileUpload(e.dataTransfer.files);
                }}
              >
                ↑ Drop or click to attach files
              </div>
              <input type="file" className="file-input-hidden" multiple ref={fileInputRef} onChange={e => handleFileUpload(e.target.files)} />
            </>
          )}
          
          {fileCount > 0 && (
            <div className="task-files-list">
              {task.files.map(f => {
                const isImg = ['jpg','jpeg','png','gif','webp'].includes(f.type);
                return (
                  <div className="task-file-item" key={f.id}>
                    <span className="task-file-icon">{fileIcon(f.type)}</span>
                    <div style={{flex: 1, minWidth: 0}}>
                      <div className="task-file-name">{f.name}</div>
                      <div className="task-file-meta">{f.type.toUpperCase()} · {formatSize(f.size)}</div>
                    </div>
                    <div style={{display: 'flex', gap: '4px'}}>
                      {isImg && (
                        <button className="btn-tf" onClick={() => onOpenLightbox(f.url.startsWith('http') ? f.url : `/${f.url}`)}>View</button>
                      )}
                      <a className="btn-tf" href={`/api/download?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}`} target="_blank" rel="noreferrer" title="Download">↓</a>
                      {!readOnly && <button className="btn-tf del" onClick={() => onDeleteFile(f.id)}>✕</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* --- Task Discussion --- */}
        <div style={{ marginTop: '14px' }}>
          <div className="task-panel-label" style={{ marginBottom: '10px' }}>Task Discussion</div>

          {/* Messages thread */}
          <div ref={chatThreadRef} style={{
            display: 'flex', flexDirection: 'column', gap: '8px',
            maxHeight: '300px', overflowY: 'auto', paddingRight: '2px', marginBottom: '10px',
          }}>
            {localComments.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>
                No messages yet. Start the discussion!
              </div>
            ) : (
              localComments.map(msg => {
                const isMine = msg.userId === currentUser?.id || msg.author === 'Me';
                const displayName = msg.name || msg.author || 'User';
                const timeLabel = msg.createdAt
                  ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : (msg.time || '');
                return (
                  <div key={msg.id} style={{
                    display: 'flex', flexDirection: isMine ? 'row-reverse' : 'row',
                    alignItems: 'flex-end', gap: '7px',
                  }}>
                    {!isMine && (
                      <Avatar
                        name={displayName}
                        src={msg.avatarUrl}
                        size={28}
                        style={{ marginBottom: '2px' }}
                      />
                    )}
                    <div style={{
                      maxWidth: '72%',
                      background: isMine ? 'var(--accent)' : 'var(--surface2)',
                      color: isMine ? '#000' : 'var(--text)',
                      borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      padding: '8px 12px',
                    }}>
                      {!isMine && (
                        <div style={{ fontSize: '11px', fontWeight: '800', marginBottom: '3px', opacity: 0.75 }}>
                          {displayName}
                        </div>
                      )}
                      <div style={{ fontSize: '13px', lineHeight: '1.4', wordBreak: 'break-word' }}>
                        {msg.text.split(/(@[a-z0-9_]+)/gi).map((part, i) =>
                          /^@[a-z0-9_]+$/i.test(part)
                            ? <span key={i} style={{ fontWeight: '700', color: isMine ? '#00000088' : 'var(--accent)' }}>{part}</span>
                            : part
                        )}
                      </div>
                      <div style={{ fontSize: '10px', marginTop: '3px', opacity: 0.45, textAlign: 'right' }}>
                        {timeLabel}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Input row */}
          {!readOnly && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <MentionInput
                  value={chatInput}
                  onChange={setChatInput}
                  onSubmit={handleSendComment}
                  placeholder="Message… (@ to mention)"
                  collaborators={collaborators}
                />
              </div>
              <button
                onClick={handleSendComment}
                disabled={!chatInput.trim()}
                style={{
                  height: '40px', borderRadius: '20px', flexShrink: 0, padding: '0 14px',
                  background: chatInput.trim() ? 'var(--accent)' : 'var(--surface2)',
                  color: chatInput.trim() ? '#000' : 'var(--muted)',
                  border: 'none', cursor: chatInput.trim() ? 'pointer' : 'default',
                  fontSize: '13px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s',
                }}
                aria-label="Send message"
              >
                Send
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
