import React, { useState, useRef, useEffect } from 'react';
import { apiForm } from '../api';
import DOMPurify from 'dompurify';

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
  isCommenter
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [notesStatus, setNotesStatus] = useState('Auto-saves');
  const [chatInput, setChatInput] = useState('');
  
  const notesTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const dateInputRef = useRef(null);
  const taskRichNotesRef = useRef(null);
  const lastServerRichNotes = useRef(null);
  const assigneeDropdownRef = useRef(null);

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

  const priorityMeta = PRIORITIES[task.priority] || null;
  const assignees = task.assignees || (task.assignee ? [task.assignee] : []);
  
  const getInitials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
  const getAvatarColor = (name = '') => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
  };

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

  const handleSendComment = () => {
    if (!chatInput.trim()) return;
    const newComments = [...(task.comments || []), {
      id: 'msg' + Date.now(),
      author: 'Me',
      text: chatInput.trim(),
      time: 'Just now'
    }];
    setChatInput('');
    onUpdateMeta('comments', newComments);
  };

  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const fd = new FormData();
      fd.append('projectId', project.id);
      fd.append('taskId', task.id);
      fd.append('file', files[i]);
      await apiForm('upload_task_file', fd);
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
          <span className={`task-text-el ${task.done ? 'done' : ''}`} onDoubleClick={(e) => { e.stopPropagation(); if(!readOnly) { setIsEditing(true); setEditText(task.text); } }}>
            {task.createdAt && <span style={{fontSize: '11px', color: 'var(--muted)', marginRight: '8px', fontWeight: '500'}}>{new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
            {task.text}
          </span>
        )}

        {!isEditing && task.badge && <span className="task-badge-el">{task.badge}</span>}
        
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
              const name = aid === 'me' ? 'Me' : (project.collaborators || []).find(c => c.id === aid)?.name || 'Guest';
              return (
                <div 
                  key={aid}
                  className="task-assignee-avatar has-tooltip" 
                  style={{ 
                    background: getAvatarColor(name), 
                    marginLeft: idx === 0 ? '0' : '-8px',
                    border: '2px solid var(--surface)',
                    position: 'relative',
                    zIndex: assignees.length - idx
                  }}
                >
                  <div className="tooltip-content" style={{ bottom: '130%', minWidth: '80px' }}>
                    {name}
                  </div>
                  {getInitials(name)}
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
                const name = aid === 'me' ? 'Me' : (project.collaborators || []).find(c => c.id === aid)?.name || 'Guest';
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
                {(project.collaborators || []).map(c => (
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
                        <button className="btn-tf" onClick={() => onOpenLightbox(f.url.startsWith('http') ? f.url : `http://localhost:3001/${f.url}`)}>View</button>
                      )}
                      <a className="btn-tf" href={`http://localhost:3001/api/download?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}`} target="_blank" rel="noreferrer" title="Download">↓</a>
                      {!readOnly && <button className="btn-tf del" onClick={() => onDeleteFile(f.id)}>✕</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* --- Task Level Chat Section --- */}
        <div className="task-chat-section">
          <div className="task-panel-label" style={{ marginBottom: '8px' }}>Task Discussion</div>
          
          <div className="chat-thread" style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '250px', overflowY: 'auto', paddingBottom: '8px' }}>
            {(!task.comments || task.comments.length === 0) ? (
              <div style={{ fontSize: '13px', color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>No comments yet. Start the discussion!</div>
            ) : (
              task.comments.map(msg => (
                <div key={msg.id} className={`chat-bubble ${msg.author === 'Me' ? 'mine' : 'theirs'}`}>
                  {msg.author !== 'Me' && <div style={{ fontSize: '11px', fontWeight: '800', marginBottom: '2px', opacity: 0.7 }}>{msg.author}</div>}
                  <div>{msg.text}</div>
                  <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.5, textAlign: msg.author === 'Me' ? 'right' : 'left' }}>{msg.time}</div>
                </div>
              ))
            )}
          </div>

          {(!readOnly || isCommenter) && (
            <div className="chat-input-wrapper">
              <input 
                type="text" 
                className="chat-input" 
                placeholder="Ask a question or share an update..." 
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendComment()}
              />
              <button className="chat-send-btn" onClick={handleSendComment} title="Send message">↑</button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
