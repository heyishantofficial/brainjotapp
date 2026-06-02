import React, { useState, useRef, useEffect } from 'react';
import { Bell, Search, MessageSquarePlus } from 'lucide-react';
import CallButton from '../components/CallButton';
import CallBanner from '../components/CallBanner';
import { api, apiForm, apiUpload } from '../api';
import { getContrastColor } from '../utils/colors';
import TaskItem from '../components/TaskItem';
import ActivityFeed from '../components/ActivityFeed';
import { motion, AnimatePresence } from 'framer-motion';
import { CountUp } from '../components/ProjectCard';
import ConfettiCelebration from '../components/ConfettiCelebration';
import ProjectModal from '../components/ProjectModal';
import DOMPurify from 'dompurify';



export default function ProjectDetailView({ project, onBack, onUpdate, onToast, onOpenWordpad, onOpenCollab, onOpenLightbox, highlightedTaskId, isSharedView = false, sharedBy = '', currentUserRole = 'owner', onOpenSearch, onOpenNotifications, onOpenFeedback, unreadNotifications = 0, currentUser, spaceCollaborators = [], livekitEnabled = false, onStartCall, incomingCall, onRequestJoinCall, onJoinInvitedCall, callRequestSent = false, isInCall = false, onDismissCallBanner }) {
  const [newTaskText, setNewTaskText] = useState('');
  const [notesStatus, setNotesStatus] = useState('Saved');
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [showEditProject, setShowEditProject] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // null | { done: number, total: number }
  const [notesSaveError, setNotesSaveError] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('default');
  const [labelFilter, setLabelFilter] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  // localTasks shadows project.tasks for shared-view optimistic updates
  // (avoids direct prop mutation which violates React immutability)
  const [localTasks, setLocalTasks] = useState(project.tasks || []);

  // Keep localTasks in sync when project.tasks changes from parent (real-time refresh)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalTasks(project.tasks || []);
  }, [project.tasks]);

  const notesTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const richNotesRef = useRef(null);
  const lastServerRichNotes = useRef(null);
  const addTaskInputRef = useRef(null);

  const priorityWeight = { urgent: 3, important: 2, later: 1 };

  const activeTasks = isSharedView ? localTasks : (project.tasks || []);

  // Merge direct project collaborators with space-level collaborators (dedup by userId)
  const directCollabs = project.collaborators || [];
  const directUserIds = new Set(directCollabs.map(c => c.userId).filter(Boolean));
  const extraSpaceCollabs = spaceCollaborators.filter(c => c.userId && !directUserIds.has(c.userId));
  const allCollaborators = [...directCollabs, ...extraSpaceCollabs];

  // For shared views include the owner so collaborators can @mention them
  const mentionUsers = isSharedView && project.ownerInfo
    ? [project.ownerInfo, ...allCollaborators]
    : allCollaborators;

  const processedTasks = [...activeTasks]
    .filter(t => {
      if (hideCompleted && t.done) return false;
      const tAssignees = t.assignees || (t.assignee ? [t.assignee] : []);
      if (assigneeFilter !== 'all' && !tAssignees.includes(assigneeFilter)) return false;
      if (labelFilter && t.badge !== labelFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'default') {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.done && b.done) {
          const aTime = a.finishedAt ? new Date(a.finishedAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const bTime = b.finishedAt ? new Date(b.finishedAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return bTime - aTime;
        }
        const wA = priorityWeight[a.priority] || 0;
        const wB = priorityWeight[b.priority] || 0;
        if (wA !== wB) return wB - wA;
        if (a.createdAt && b.createdAt) return new Date(b.createdAt) - new Date(a.createdAt);
        return 0;
      }
      
      if (sortBy === 'priority') {
        const wA = priorityWeight[a.priority] || 0;
        const wB = priorityWeight[b.priority] || 0;
        if (wA !== wB) return wB - wA;
      }
      
      if (sortBy === 'deadline') {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline) - new Date(b.deadline);
      }
      
      if (sortBy === 'newest') {
        if (a.createdAt && b.createdAt) return new Date(b.createdAt) - new Date(a.createdAt);
      }

      return 0;
    });

  const pct = activeTasks.length === 0 ? 0 : Math.round(activeTasks.filter(t => t.done).length / activeTasks.length * 100);

  useEffect(() => {
    const currentRich = project.richNotes || project.notes || '';
    if (richNotesRef.current && currentRich !== lastServerRichNotes.current) {
      lastServerRichNotes.current = currentRich;
      richNotesRef.current.innerHTML = DOMPurify.sanitize(currentRich);
    }
  }, [project.richNotes, project.notes]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Shortcut 'n' or 'N' to focus add task input
      if ((e.key === 'n' || e.key === 'N') && 
          !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) &&
          !document.activeElement.isContentEditable) {
        e.preventDefault();
        addTaskInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || 'C';

  const formatSize = (b) => {
    if (b < 1024) return b + 'B';
    if (b < 1048576) return Math.round(b / 1024) + 'KB';
    return (b / 1048576).toFixed(1) + 'MB';
  };

  const fileIcon = (ext) => {
    const m = { pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', ppt: '📑', pptx: '📑', mp4: '🎬', mov: '🎬', zip: '🗜️', txt: '📃', csv: '📊' };
    return m[ext] || '📁';
  };

  const addTask = async () => {
    if (!newTaskText.trim()) return;

    if (isSharedView && currentUserRole !== 'editor') {
      const newTask = { id: 'new-' + Date.now(), text: newTaskText, done: false, priority: 'later', createdAt: new Date().toISOString() };
      setLocalTasks(prev => [newTask, ...prev]);
      setNewTaskText('');
      onUpdate();
      return;
    }

    await api('add_task', { projectId: project.id, text: newTaskText });
    setNewTaskText('');
    onUpdate();
  };



  const handleInlineRichNotes = (e) => {
    setNotesStatus('Saving...');
    setNotesSaveError(false);
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    const html = e.target.innerHTML;
    notesTimerRef.current = setTimeout(async () => {
      const r = await api('save_project_rich_notes', { projectId: project.id, notes: html });
      if (r?.ok === false || r?.error) {
        setNotesSaveError(true);
        setNotesStatus('Failed to save');
      } else {
        setNotesSaveError(false);
        setNotesStatus('Saved');
      }
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

  const linkifyOnBlur = (e) => {
    const el = e.currentTarget;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    const nodesToReplace = [];
    let node;
    while ((node = walk.nextNode())) {
      if (node.parentNode && node.parentNode.tagName === 'A') continue;
      const text = node.nodeValue;
      if (/(https?:\/\/[^\s]+)/.test(text)) {
        nodesToReplace.push(node);
      }
    }
    
    let changed = false;
    nodesToReplace.forEach(n => {
      const parent = n.parentNode;
      const text = n.nodeValue;
      const fragment = document.createDocumentFragment();
      
      let lastIndex = 0;
      text.replace(/(https?:\/\/[^\s]+)/g, (match, p1, offset) => {
        if (offset > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
        }
        const a = document.createElement('a');
        a.href = match;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = match;
        a.style.textDecoration = 'underline';
        a.style.color = 'var(--accent, #0066cc)';
        a.style.cursor = 'pointer';
        fragment.appendChild(a);
        lastIndex = offset + match.length;
        return match;
      });
      
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      parent.replaceChild(fragment, n);
      changed = true;
    });
    
    if (changed) {
      handleInlineRichNotes({ target: el });
    }
  };

  const toggleTask = async (taskId) => {
    const task = activeTasks.find(t => t.id === taskId);
    if (!task) return;

    // A task is considered "done" if its value is true, 1, "1", or "true"
    const isCurrentlyDone = task.done === true || task.done === 1 || task.done === '1' || task.done === 'true';
    
    // Strict celebration check: Only trigger if we are marking the LAST incomplete task as done
    const isMarkingDone = !isCurrentlyDone;
    
    const otherIncompleteCount = activeTasks.filter(t => {
      if (t.id === taskId) return false;
      const tIsDone = t.done === true || t.done === 1 || t.done === '1' || t.done === 'true';
      return !tIsDone;
    }).length;

    const isCompletingLast = isMarkingDone && otherIncompleteCount === 0;

    if (isSharedView && currentUserRole !== 'editor') {
      setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, done: !isCurrentlyDone } : t));
      onUpdate();
      if (isCompletingLast) {
        setCelebrationKey(prev => prev + 1);
        setShowCelebration(true);
      }
      return;
    }

    await api('task_toggle', { projectId: project.id, taskId });
    onUpdate();

    if (isCompletingLast) {
      setCelebrationKey(prev => prev + 1);
      setShowCelebration(true);
    }
  };

  const deleteTask = async (taskId) => {
    const taskToDelete = activeTasks.find(t => t.id === taskId);
    if (!taskToDelete) return;

    onToast({
      message: 'Task deleted',
      action: {
        label: 'Undo',
        onClick: async () => {
          if (isSharedView && currentUserRole !== 'editor') {
            setLocalTasks(prev => [...prev, taskToDelete]);
            onUpdate();
            return;
          }
          await api('restore_task', { projectId: project.id, task: taskToDelete });
          onUpdate();
        }
      }
    });

    if (isSharedView && currentUserRole !== 'editor') {
      setLocalTasks(prev => prev.filter(t => t.id !== taskId));
      onUpdate();
      return;
    }

    await api('delete_task', { projectId: project.id, taskId });
    onUpdate();
  };

  const updateTaskText = async (taskId, text) => {
    if (isSharedView && currentUserRole !== 'editor') {
      setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, text } : t));
      onUpdate();
      return;
    }
    await api('rename_task', { projectId: project.id, taskId, text });
    onUpdate();
  };

  const updateTaskMeta = async (taskId, field, value) => {
    if (isSharedView && currentUserRole !== 'editor') {
      setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t));
      onUpdate();
      return;
    }
    await api('update_task_meta', { projectId: project.id, taskId, [field]: value });
    onUpdate();
  };

  const saveTaskNotes = async (taskId, text) => {
    if (isSharedView && currentUserRole !== 'editor') {
      setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, notes: text } : t));
      return;
    }
    await api('save_task_notes', { projectId: project.id, taskId, notes: text });
  };

  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    setUploadProgress({ done: 0, total: files.length });
    for (let i = 0; i < files.length; i++) {
      const r = await apiUpload(files[i], { type: 'project', projectId: project.id });
      if (r?.error) { onToast(r.error); }
      setUploadProgress({ done: i + 1, total: files.length });
    }
    fileInputRef.current.value = '';
    setUploadProgress(null);
    onUpdate();
  };

  const deleteFile = async (fileId) => {
    await api('delete_file', { projectId: project.id, fileId });
    onUpdate();
  };



  const images = (project.files || []).filter(f => ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(f.type));
  const others = (project.files || []).filter(f => !['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(f.type));

  return (
    <div className="view active" id="view-detail" style={{ paddingTop: '50px' }}>
      <button className="back-btn" onClick={onBack}>
        {isSharedView ? '← Shared projects' : '← Back to Brainview'}
      </button>

      <div style={{ position: 'absolute', top: '20px', right: '30px', display: 'flex', gap: '12px', alignItems: 'center', zIndex: 100 }}>
        <button className="theme-toggle" style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: '20px', padding: '8px', opacity: 0.7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onOpenFeedback} title="Beta Feedback">
          <MessageSquarePlus size={20} strokeWidth={2.5} />
        </button>
        <button className="theme-toggle" style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: '20px', padding: '8px', opacity: 0.7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onOpenNotifications} title="Notifications">
          <span style={{ position: 'relative' }}>
            <Bell size={20} strokeWidth={2.5} />
            {unreadNotifications > 0 && (
              <span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#ff4c4c', color: 'white', fontSize: '9px', fontWeight: '900', padding: '2px 5px', borderRadius: '10px' }}>
                {unreadNotifications}
              </span>
            )}
          </span>
        </button>
        <button className="theme-toggle" style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: '20px', padding: '8px', opacity: 0.7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onOpenSearch} title="Search (Cmd+F)">
          <Search size={20} strokeWidth={2.5} />
        </button>
      </div>

      {/* Shared view banner */}
      {isSharedView && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 18px',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: '14px',
          marginBottom: '20px',
          fontSize: '13px',
          color: 'var(--muted)',
          fontWeight: '600'
        }}>
          <span style={{ fontSize: '18px' }}>👥</span>
          <span>Shared with you by <strong style={{ color: 'var(--text)' }}>{sharedBy}</strong></span>
          <span style={{
            marginLeft: 'auto',
            background: 'var(--surface3)',
            color: 'var(--faint)',
            fontSize: '10px',
            fontWeight: '800',
            padding: '3px 10px',
            borderRadius: '20px',
            letterSpacing: '0.5px'
          }}>{currentUserRole === 'editor' ? 'EDITOR' : 'READ ONLY'}</span>
        </div>
      )}

      {/* Call banner — slides in when someone else starts a call in this project */}
      <AnimatePresence>
        {livekitEnabled && incomingCall && !isInCall && (
          <CallBanner
            callInfo={incomingCall}
            requestSent={callRequestSent}
            onRequestJoin={onRequestJoinCall}
            onJoinNow={onJoinInvitedCall}
            onDismiss={onDismissCallBanner}
          />
        )}
      </AnimatePresence>

      <div
        className="detail-header"
        style={{
          position: 'relative',
          background: project.color,
          padding: '40px',
          borderRadius: '32px',
          color: getContrastColor(project.color),
          marginBottom: '32px',
          overflow: 'hidden'
        }}
      >
        <div className="liquid-wave-container">
          <div className="liquid-wave" style={{ height: `${pct}%` }}></div>
        </div>

        <div className="detail-header-content" style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', width: '100%' }}>
          <div style={{ flex: 1 }}>
            <div className="detail-title" style={{ fontSize: 'max(36px, min(3.5vw, 56px))', fontWeight: '800', lineHeight: '1.1', letterSpacing: '-1px' }}>{project.title}</div>
            <div className="detail-sub" style={{ color: `${getContrastColor(project.color)}a6`, marginTop: '12px', fontSize: '16px', fontWeight: '600' }}>{project.subtitle}</div>
          </div>

          <div className="detail-actions">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {/* Call button — only shown when LiveKit is configured */}
              {livekitEnabled && (
                <CallButton
                  project={project}
                  onStartCall={onStartCall}
                  hasActiveCall={!!incomingCall}
                  isInCall={isInCall}
                  contrastColor={getContrastColor(project.color)}
                />
              )}
              <div
                className="collab-pill has-tooltip" 
                style={{ background: `${getContrastColor(project.color)}26`, padding: '8px 8px 8px 16px', borderRadius: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}
              >
                <div className="tooltip-content">
                  {(project.collaborators || []).length > 0
                    ? (project.collaborators || []).map(c => c.name).join('\n')
                    : 'No collaborators yet — invite someone!'}
                </div>
                <div className="project-collab-summary" style={{ margin: 0 }}>
                  <div className="collab-stack" style={{ display: 'flex' }}>
                    {(project.collaborators || []).slice(0, 4).map(c => (
                      <div key={c.id} className="collab-chip" title={c.name} style={{ border: 'none', background: getContrastColor(project.color), color: project.color }}>{initials(c.name)}</div>
                    ))}
                    {(!project.collaborators || project.collaborators.length === 0) && (
                      <div className="collab-chip" style={{ border: 'none', background: getContrastColor(project.color), color: project.color }}>+</div>
                    )}
                  </div>
                  <span className="collab-count" style={{ color: `${getContrastColor(project.color)}cc`, fontWeight: '600' }}>
                    {(project.collaborators || []).length ? `${project.collaborators.length} collaborator${project.collaborators.length > 1 ? 's' : ''}` : 'No collaborators yet'}
                  </span>
                </div>
                {!isSharedView && (
                  <button className="ghost-action-btn" onClick={onOpenCollab} style={{ background: getContrastColor(project.color), color: project.color, borderRadius: '16px', padding: '8px 16px', fontWeight: '600', border: 'none' }}>Invite collaborators</button>
                )}
              </div>

              {!isSharedView && (
                <button 
                  className="icon-action-btn" 
                  onClick={() => setShowEditProject(true)} 
                  title="Project Settings"
                  style={{ 
                    background: `${getContrastColor(project.color)}26`, 
                    border: 'none', 
                    borderRadius: '50%', 
                    width: '54px', 
                    height: '54px', 
                    minWidth: '54px',
                    minHeight: '54px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: getContrastColor(project.color), 
                    fontSize: '24px' 
                  }}
                >
                  ⚙
                </button>
              )}
            </div>
          </div>

          <div className="desktop-pct" style={{ textAlign: 'right', minWidth: '68px', marginLeft: '32px' }}>
            <div className="detail-pct" style={{ color: getContrastColor(project.color), fontSize: '36px', letterSpacing: '-1px', fontWeight: '800' }}><CountUp value={pct} />%</div>
            <div className="detail-pct-label" style={{ color: `${getContrastColor(project.color)}99`, fontWeight: '600', fontSize: '13px' }}>complete</div>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div id="detail-left">
          <div className="section-card">
            <div className="section-head">
              <span className="section-head-title">Tasks</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--faint)' }}>{project.tasks?.length || 0} total</span>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  style={{
                    background: (showFilters || labelFilter || assigneeFilter !== 'all' || hideCompleted) ? 'var(--surface3)' : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    color: (showFilters || labelFilter || assigneeFilter !== 'all' || hideCompleted) ? 'var(--text)' : 'var(--faint)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.2s'
                  }}
                >
                  <span style={{ fontSize: '14px' }}>{showFilters ? '✕' : '⌥'}</span>
                  {showFilters ? 'Close' : 'Filter'}
                  {!showFilters && (labelFilter || assigneeFilter !== 'all' || hideCompleted) && (
                    <span style={{ background: 'var(--accent)', borderRadius: '50%', width: '6px', height: '6px', display: 'inline-block', marginLeft: '2px' }} />
                  )}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {showFilters && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="task-filter-bar">
                    <div className="filter-group">
                      <span className="filter-label">Sort by</span>
                      <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                        <option value="default">Default</option>
                        <option value="priority">Priority</option>
                        <option value="deadline">Deadline</option>
                        <option value="newest">Newest</option>
                      </select>
                    </div>

                    <div className="filter-group">
                      <span className="filter-label">Assignee</span>
                      <select className="filter-select" value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}>
                        <option value="all">All</option>
                        {allCollaborators.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>

                      <label className="filter-toggle" style={{ marginLeft: '12px' }}>
                        <input type="checkbox" checked={hideCompleted} onChange={e => setHideCompleted(e.target.checked)} />
                        <span style={{ fontWeight: '600' }}>Hide completed</span>
                      </label>
                    </div>

                    {(project.labels || []).length > 0 && (
                      <div className="filter-group" style={{ flexWrap: 'wrap', gap: '6px' }}>
                        <span className="filter-label">Label</span>
                        <button
                          onClick={() => setLabelFilter(null)}
                          style={{
                            padding: '3px 10px',
                            borderRadius: '20px',
                            border: '1.5px solid var(--border)',
                            background: labelFilter === null ? 'var(--surface3)' : 'transparent',
                            color: labelFilter === null ? 'var(--text)' : 'var(--muted)',
                            fontSize: '11px',
                            fontWeight: '700',
                            cursor: 'pointer',
                          }}
                        >
                          All
                        </button>
                        {(project.labels || []).map(lbl => (
                          <button
                            key={lbl.id}
                            onClick={() => setLabelFilter(labelFilter === lbl.id ? null : lbl.id)}
                            style={{
                              padding: '3px 10px',
                              borderRadius: '20px',
                              border: `1.5px solid ${lbl.color}`,
                              background: labelFilter === lbl.id ? lbl.color : 'transparent',
                              color: labelFilter === lbl.id ? '#fff' : lbl.color,
                              fontSize: '11px',
                              fontWeight: '700',
                              cursor: 'pointer',
                            }}
                          >
                            {lbl.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div id="tasks-list">
              {processedTasks.filter(t => !t.done).length === 0 && (processedTasks.length === 0 || hideCompleted) ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '36px 20px',
                  gap: '10px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '48px', lineHeight: '1' }}>💭</div>
                  <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text)', marginTop: '4px' }}>No tasks yet</div>
                  <div style={{ fontSize: '14px', color: 'var(--muted)' }}>What's on your mind? Add your first task below.</div>
                </div>
              ) : (
              <AnimatePresence initial={false}>
                {processedTasks.filter(t => !t.done).map(t => (
                  <motion.div
                    key={t.id}
                    layout
                    exit={{ opacity: 0, y: 12, scale: 0.97 }}
                    transition={{ type: 'tween', ease: 'easeInOut', duration: 0.25 }}
                  >
                    <TaskItem
                      task={t}
                      project={project}
                      onToggle={() => toggleTask(t.id)}
                      onDelete={() => deleteTask(t.id)}
                      onUpdateText={(txt) => updateTaskText(t.id, txt)}
                      onUpdateMeta={(field, val) => updateTaskMeta(t.id, field, val)}
                      onSaveNotes={(txt) => saveTaskNotes(t.id, txt)}
                      onOpenWordpad={(content) => onOpenWordpad('task', t.id, content)}
                      onUploadComplete={onUpdate}
                      onDeleteFile={(fid) => { api('delete_task_file', { projectId: project.id, taskId: t.id, fileId: fid }).then(onUpdate) }}
                      onOpenLightbox={onOpenLightbox}
                      highlighted={highlightedTaskId === t.id}
                      readOnly={isSharedView && currentUserRole === 'viewer'}
                      currentUser={currentUser}
                      collaborators={mentionUsers}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              )}
            </div>

            {(!isSharedView || currentUserRole === 'editor') && (
              <div className="add-row">
                <input
                  ref={addTaskInputRef}
                  className="add-input"
                  placeholder="Add a task... (Press 'N' to focus)"
                  value={newTaskText}
                  onChange={e => setNewTaskText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTask()}
                />
                <button className="btn-add" onClick={addTask}>Add</button>
              </div>
            )}

            {processedTasks.some(t => t.done) && (
              <>
                <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--faint)', letterSpacing: '.08em', textTransform: 'uppercase', padding: '12px 12px 4px' }}>Completed</div>
                <div id="tasks-list-done">
                  <AnimatePresence initial={false}>
                    {processedTasks.filter(t => t.done).map(t => (
                      <motion.div
                        key={t.id}
                        layout
                        exit={{ opacity: 0, y: 12, scale: 0.97 }}
                        transition={{ type: 'tween', ease: 'easeInOut', duration: 0.25 }}
                      >
                        <TaskItem
                          task={t}
                          project={project}
                          onToggle={() => toggleTask(t.id)}
                          onDelete={() => deleteTask(t.id)}
                          onUpdateText={(txt) => updateTaskText(t.id, txt)}
                          onUpdateMeta={(field, val) => updateTaskMeta(t.id, field, val)}
                          onSaveNotes={(txt) => saveTaskNotes(t.id, txt)}
                          onOpenWordpad={(content) => onOpenWordpad('task', t.id, content)}
                          onUploadComplete={onUpdate}
                          onDeleteFile={(fid) => { api('delete_task_file', { projectId: project.id, taskId: t.id, fileId: fid }).then(onUpdate) }}
                          onOpenLightbox={onOpenLightbox}
                          highlighted={highlightedTaskId === t.id}
                          readOnly={isSharedView && currentUserRole === 'viewer'}
                          currentUser={currentUser}
                          collaborators={mentionUsers}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </>
            )}
          </div>

          <div className="section-card">
            <div className="section-head">
              <span className="section-head-title">Project notes</span>
              <span style={{ fontSize: '11px', color: notesSaveError ? '#ef4444' : 'var(--faint)' }}>{notesStatus}</span>
            </div>
            <div className="section-body">
              <div className="notes-wrap" style={{ position: 'relative' }}>
                  <div
                    ref={richNotesRef}
                    className="task-rich-preview"
                    contentEditable="true"
                    placeholder="Strategy, ideas, links, references..."
                    suppressContentEditableWarning={true}
                    style={{ minHeight: '120px', padding: '12px 46px 42px 12px', background: 'transparent', border: 'none', margin: 0, wordBreak: 'break-word', fontSize: '16px', outline: 'none' }}
                    onInput={handleInlineRichNotes}
                    onClick={handleLinkClick}
                    onPaste={handleNotesPaste}
                    onBlur={linkifyOnBlur}
                  ></div>
                <button className="btn-wordpad-icon" title="Expand to rich editor" onClick={() => {
                  const content = richNotesRef.current ? richNotesRef.current.innerHTML : (project.richNotes || project.notes);
                  onOpenWordpad('project', null, content);
                }}>⤢</button>
              </div>
            </div>
          </div>
        </div>

        <div id="detail-right">
          <div className="section-card">
            <div className="section-head"><span className="section-head-title">Project files</span></div>
            <div className="section-body">
              <div
                className="file-drop"
                onClick={() => fileInputRef.current.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag'); }}
                onDragLeave={e => e.currentTarget.classList.remove('drag')}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('drag');
                  if (e.dataTransfer.files) handleFileUpload(e.dataTransfer.files);
                }}
              >
                <div className="file-drop-icon">↑</div>
                <div className="file-drop-text">Drop files or click to upload</div>
                <div className="file-drop-sub">Images, PDFs, Docs, Videos — 50MB max</div>
              </div>
              <input
                type="file"
                className="file-input-hidden"
                multiple
                ref={fileInputRef}
                onChange={(e) => handleFileUpload(e.target.files)}
              />

              {uploadProgress && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                    <span>Uploading…</span>
                    <span>{uploadProgress.done}/{uploadProgress.total}</span>
                  </div>
                  <div className="upload-progress" style={{ display: 'block' }}>
                    <div className="upload-progress-fill" style={{ width: `${Math.round(uploadProgress.done / uploadProgress.total * 100)}%` }} />
                  </div>
                </div>
              )}

              {images.length > 0 && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '8px' }}>Images ({images.length})</div>
                  <div className="img-grid">
                    {images.map(f => (
                      <div className="img-thumb" key={f.id}>
                        <img src={f.url.startsWith('http') ? f.url : `/${f.url}`} alt={f.name} loading="lazy" />
                        <div className="img-thumb-overlay">
                          <button className="btn-file" onClick={(e) => { e.stopPropagation(); onOpenLightbox(f.url.startsWith('http') ? f.url : `/${f.url}`); }}>View</button>
                          <a className="btn-file" href={`/api/download?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}`} onClick={e => e.stopPropagation()} target="_blank" rel="noreferrer" title="Download">↓</a>
                          <button className="btn-file del" onClick={(e) => { e.stopPropagation(); deleteFile(f.id); }}>Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {others.length > 0 && (
                <div className="files-list" style={{ marginTop: '12px' }}>
                  {others.map(f => (
                    <div className="file-item" key={f.id}>
                      <span className="file-icon">{fileIcon(f.type)}</span>
                      <div className="file-info">
                        <div className="file-name">{f.name}</div>
                        <div className="file-meta">{f.type.toUpperCase()} · {formatSize(f.size)} · {f.uploaded}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <a className="btn-file" href={`/api/download?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}`} target="_blank" rel="noreferrer">↓</a>
                        <button className="btn-file del" onClick={() => deleteFile(f.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {project.files?.length === 0 && (
                <div style={{ fontSize: '12px', color: 'var(--faint)', marginTop: '10px', textAlign: 'center' }}>No files uploaded yet</div>
              )}
            </div>
          </div>

          {/* ── Activity Feed ── */}
          <div className="section-card">
            <div className="section-head">
              <span className="section-head-title">Activity</span>
              <span style={{ fontSize: '11px', color: 'var(--faint)' }}>Recent changes</span>
            </div>
            <div className="section-body">
              <ActivityFeed project={project} collaborators={project.collaborators || []} />
            </div>
          </div>
        </div>
      </div>

      {showCelebration && (
        <ConfettiCelebration 
          key={celebrationKey}
          onDone={() => setShowCelebration(false)} 
        />
      )}

      {showEditProject && (
        <ProjectModal 
          project={project}
          onClose={() => setShowEditProject(false)}
          onSuccess={() => { setShowEditProject(false); onUpdate(); }}
        />
      )}
    </div>
  );
}
