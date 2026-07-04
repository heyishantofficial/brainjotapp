import React, { useState } from 'react';
import Avatar from './Avatar';
import { formatDeadline, deadlineStatus } from '../utils/deadlines';

const COLUMNS = [
  { key: 'urgent', label: 'Urgent', icon: '🔥' },
  { key: 'important', label: 'Important', icon: '⚡' },
  { key: 'later', label: 'Later', icon: '💤' },
  { key: 'none', label: 'No priority', icon: '◯' },
  { key: 'done', label: 'Done', icon: '✅' },
];

const PRIORITY_KEYS = ['urgent', 'important', 'later'];

const columnOf = (task) =>
  task.done ? 'done' : (PRIORITY_KEYS.includes(task.priority) ? task.priority : 'none');

export default function TaskBoard({
  tasks,
  project,
  collaborators = [],
  currentUser,
  onToggle,
  onUpdateMeta,
  onTaskClick,
  readOnly = false,
}) {
  const [dragOverCol, setDragOverCol] = useState(null);

  const grouped = { urgent: [], important: [], later: [], none: [], done: [] };
  tasks.forEach(t => grouped[columnOf(t)].push(t));

  const handleDrop = async (e, colKey) => {
    e.preventDefault();
    setDragOverCol(null);
    if (readOnly) return;
    const taskId = e.dataTransfer.getData('taskId');
    const task = tasks.find(t => t.id === taskId);
    if (!task || columnOf(task) === colKey) return;
    if (colKey === 'done') { await onToggle(taskId); return; }
    // Dragging a card out of Done reopens it before applying the new priority
    if (task.done) await onToggle(taskId);
    const newPriority = colKey === 'none' ? '' : colKey;
    if ((task.priority || '') !== newPriority) await onUpdateMeta(taskId, 'priority', newPriority);
  };

  return (
    <div className="board-wrap">
      {COLUMNS.map(col => (
        <div
          key={col.key}
          className={`board-col ${dragOverCol === col.key ? 'drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOverCol(col.key); }}
          onDragLeave={() => setDragOverCol(cur => (cur === col.key ? null : cur))}
          onDrop={e => handleDrop(e, col.key)}
        >
          <div className="board-col-head">
            <span>{col.icon}</span>
            <span>{col.label}</span>
            <span className="board-col-count">{grouped[col.key].length}</span>
          </div>
          <div className="board-col-body">
            {grouped[col.key].length === 0 && (
              <div className="board-empty-hint">{readOnly ? 'No tasks' : 'Drag tasks here'}</div>
            )}
            {grouped[col.key].map(t => {
              const status = deadlineStatus(t);
              const label = (project.labels || []).find(l => l.id === t.badge) || null;
              const assignees = t.assignees || (t.assignee ? [t.assignee] : []);
              return (
                <div
                  key={t.id}
                  className={`board-card ${t.done ? 'done' : ''}`}
                  draggable={!readOnly}
                  onDragStart={e => { e.dataTransfer.setData('taskId', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onClick={() => onTaskClick(t.id)}
                  title="Open in list"
                >
                  <div className="board-card-text">{t.text}</div>
                  {(t.deadline || label || assignees.length > 0 || t.comments?.length > 0 || (t.files || []).length > 0) && (
                    <div className="board-card-meta">
                      {t.deadline && (
                        <span
                          className={`meta-pill deadline-pill ${
                            status?.type === 'overdue' ? 'deadline-overdue' :
                            status?.type === 'today' ? 'deadline-today' :
                            status?.type === 'tomorrow' ? 'deadline-tomorrow' : ''
                          }`}
                          title={t.deadline}
                        >
                          {status?.type === 'overdue'
                            ? `🔴 ${status.days}d overdue`
                            : status?.type === 'today'
                            ? '🟠 Today'
                            : status?.type === 'tomorrow'
                            ? '🟡 Tomorrow'
                            : `🗓 ${formatDeadline(t.deadline)}`}
                        </span>
                      )}
                      {label && <span className="meta-pill" style={{ color: label.color, borderColor: label.color }}>{label.name}</span>}
                      {t.comments?.length > 0 && <span className="task-file-count">💬 {t.comments.length}</span>}
                      {(t.files || []).length > 0 && <span className="task-file-count">📎 {t.files.length}</span>}
                      {assignees.length > 0 && (
                        <span style={{ display: 'flex', marginLeft: 'auto' }}>
                          {assignees.slice(0, 3).map((aid, idx) => {
                            const collab = collaborators.find(c => c.id === aid);
                            const name = aid === 'me' ? (currentUser?.name || 'Me') : (collab?.name || 'Guest');
                            const src = aid === 'me' ? (currentUser?.avatarUrl || '') : (collab?.avatarUrl || '');
                            return (
                              <span
                                key={aid}
                                title={name}
                                style={{ marginLeft: idx === 0 ? 0 : '-6px', display: 'inline-flex', position: 'relative', zIndex: 3 - idx, borderRadius: '50%', border: '1.5px solid var(--surface)' }}
                              >
                                <Avatar name={name} src={src} size={18} />
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
