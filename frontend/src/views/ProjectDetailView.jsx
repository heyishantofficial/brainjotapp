import React, { useState, useRef, useEffect } from 'react';
import { Bell, Search, MessageSquarePlus, ChevronDown, LayoutList, SquareKanban, Calendar } from 'lucide-react';
import CallButton from '../components/CallButton';
import CallBanner from '../components/CallBanner';
import { api, apiForm, apiUpload, apiUrl } from '../api';
import { track } from '../analytics';
import { getContrastColor } from '../utils/colors';
import TaskItem from '../components/TaskItem';
import TaskBoard from '../components/TaskBoard';
import TaskCalendar from '../components/TaskCalendar';
import ActivityFeed from '../components/ActivityFeed';
import { motion, AnimatePresence } from 'framer-motion';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { CountUp } from '../components/ProjectCard';
import ConfettiCelebration from '../components/ConfettiCelebration';
import ProjectModal from '../components/ProjectModal';
import FadeOut from '../components/FadeOut';
import DOMPurify from 'dompurify';

const VIEW_OPTIONS = [
  { key: 'list', label: 'List', Icon: LayoutList },
  { key: 'board', label: 'Board', Icon: SquareKanban },
  { key: 'calendar', label: 'Calendar', Icon: Calendar },
];

export default function ProjectDetailView({ project, onBack, onUpdate, onToast, onOpenWordpad, onOpenCollab, onOpenLightbox, highlightedTaskId, isSharedView = false, sharedBy = '', currentUserRole = 'owner', onOpenSearch, onOpenNotifications, onOpenFeedback, unreadNotifications = 0, currentUser, spaceCollaborators = [], livekitEnabled = false, onStartCall, incomingCall, onRequestJoinCall, onJoinInvitedCall, callRequestSent = false, isInCall = false, onDismissCallBanner, onPatchTasks, onScheduleTaskDelete }) {
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
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(`bj_view_${project.id}`) || 'list');
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(() => localStorage.getItem('bj_activity_collapsed') === '1');
  // Internal highlight target for "jump to list" from Board/Calendar
  const [focusTaskId, setFocusTaskId] = useState(null);
  // Tasks checked off in the last moment: they hold their spot in the active
  // list briefly so the checkbox animation can play before the row relocates
  // to the Completed section.
  const [justCompleted, setJustCompleted] = useState(() => new Set());
  // localTasks shadows project.tasks for read-only shared views, where changes
  // are local-only (viewers have no write access on the server)
  const [localTasks, setLocalTasks] = useState(project.tasks || []);

  // Keep localTasks in sync when project.tasks changes from parent (real-time refresh)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalTasks(project.tasks || []);
  }, [project.tasks]);

  // Each project remembers its own view mode; reload it when switching projects
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewMode(localStorage.getItem(`bj_view_${project.id}`) || 'list');
  }, [project.id]);

  const notesTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  // Smooth add/remove animation for file lists (framer-motion covers the task lists)
  const [imgGridRef] = useAutoAnimate();
  const [filesListRef] = useAutoAnimate();
  const richNotesRef = useRef(null);
  const lastServerRichNotes = useRef(null);
  const addTaskInputRef = useRef(null);
  const viewMenuRef = useRef(null);
  const focusTimerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(event.target)) setShowViewMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const changeViewMode = (mode) => {
    if (mode !== viewMode) track('view_switched', { view: mode });
    setViewMode(mode);
    setShowViewMenu(false);
    try { localStorage.setItem(`bj_view_${project.id}`, mode); } catch { /* storage unavailable */ }
  };

  // Board cards and calendar chips open their task in the list view
  const jumpToTask = (taskId) => {
    changeViewMode('list');
    setFocusTaskId(taskId);
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => setFocusTaskId(null), 2000);
  };

  const priorityWeight = { urgent: 3, important: 2, later: 1 };

  // Viewers on a shared project have no write access — their edits live only
  // in localTasks. Everyone else mutates optimistically through onPatchTasks.
  const isViewerLocal = isSharedView && currentUserRole !== 'editor';
  const activeTasks = isViewerLocal ? localTasks : (project.tasks || []);

  // "Effectively done" — done, except during the brief just-completed window
  // where the row still renders (and sorts) as if active.
  const effDone = (t) => t.done && !justCompleted.has(t.id);

  // Merge direct project collaborators with space-level collaborators (dedup by userId)
  const directCollabs = project.collaborators || [];
  const directUserIds = new Set(directCollabs.map(c => c.userId).filter(Boolean));
  const extraSpaceCollabs = spaceCollaborators
    .filter(c => c.userId && !directUserIds.has(c.userId))
    .map(c => ({ ...c, viaSpace: true }));
  const allCollaborators = [...directCollabs, ...extraSpaceCollabs];

  // For shared views include the owner so collaborators can @mention them
  const mentionUsers = isSharedView && project.ownerInfo
    ? [project.ownerInfo, ...allCollaborators]
    : allCollaborators;

  const processedTasks = [...activeTasks]
    .filter(t => {
      if (hideCompleted && effDone(t)) return false;
      const tAssignees = t.assignees || (t.assignee ? [t.assignee] : []);
      if (assigneeFilter !== 'all' && !tAssignees.includes(assigneeFilter)) return false;
      if (labelFilter && t.badge !== labelFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'default') {
        if (effDone(a) !== effDone(b)) return effDone(a) ? 1 : -1;
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
    const el = richNotesRef.current;
    const currentRich = project.richNotes || project.notes || '';
    if (!el || currentRich === lastServerRichNotes.current) return;
    lastServerRichNotes.current = currentRich;
    // Never replace the editor DOM while the user is typing in it: setting
    // innerHTML destroys the selection (the caret jumps to the start) and
    // drops unsaved keystrokes. The debounced save pushes the local version.
    if (el.contains(document.activeElement)) return;
    const sanitized = DOMPurify.sanitize(currentRich);
    if (el.innerHTML !== sanitized) el.innerHTML = sanitized;
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

  // Optimistic add: the task appears the instant Enter is pressed with a temp
  // id, which is swapped for the server-assigned id when the response lands —
  // same key by the time the refetch arrives, so no flicker.
  const optimisticAdd = async (text, priority, source) => {
    const tempId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const tempTask = {
      id: tempId, text, done: false, badge: 'Custom', notes: '', richNotes: '',
      files: [], deadline: '', assignee: '', assignees: [], comments: [],
      priority: priority || '', createdAt: new Date().toISOString(),
    };
    onPatchTasks(project.id, ts => [...ts, tempTask]);
    track('task_created', { source });
    try {
      const r = await api('add_task', { projectId: project.id, text, priority });
      if (r?.id) {
        onPatchTasks(project.id, ts => ts.map(t => t.id === tempId ? { ...t, id: r.id } : t));
      } else {
        onPatchTasks(project.id, ts => ts.filter(t => t.id !== tempId));
        if (r?.error) onToast(r.error);
      }
    } catch {
      onPatchTasks(project.id, ts => ts.filter(t => t.id !== tempId));
      onToast('Could not add task — check your connection');
    }
    onUpdate();
  };

  const addTask = () => {
    const text = newTaskText.trim();
    if (!text) return;
    setNewTaskText('');

    if (isViewerLocal) {
      const newTask = { id: 'new-' + Date.now(), text, done: false, priority: 'later', createdAt: new Date().toISOString() };
      setLocalTasks(prev => [newTask, ...prev]);
      return;
    }
    optimisticAdd(text, undefined, 'list_view');
  };

  // Quick-add from a Board column: the new task lands with that column's priority
  const addTaskFromBoard = (text, priority) => {
    if (isViewerLocal) {
      const newTask = { id: 'new-' + Date.now(), text, done: false, priority, createdAt: new Date().toISOString() };
      setLocalTasks(prev => [newTask, ...prev]);
      return;
    }
    optimisticAdd(text, priority, 'board_view');
  };



  const handleInlineRichNotes = (e) => {
    setNotesStatus('Saving...');
    setNotesSaveError(false);
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    const html = e.target.innerHTML;
    notesTimerRef.current = setTimeout(async () => {
      try {
        const r = await api('save_project_rich_notes', { projectId: project.id, notes: html });
        if (r?.ok === false || r?.error) {
          setNotesSaveError(true);
          setNotesStatus('Failed to save');
        } else {
          // Remember what the server now holds so the next refetch echoing
          // this save back isn't mistaken for a remote change.
          lastServerRichNotes.current = html;
          setNotesSaveError(false);
          setNotesStatus('Saved');
        }
      } catch {
        setNotesSaveError(true);
        setNotesStatus('Failed to save');
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

  const toggleTask = (taskId) => {
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

    // Let the checkbox animation play in place before the row moves down to
    // the Completed section (see justCompleted / effDone).
    if (isMarkingDone) {
      setJustCompleted(prev => new Set([...prev, taskId]));
      setTimeout(() => setJustCompleted(prev => {
        if (!prev.has(taskId)) return prev;
        const next = new Set(prev); next.delete(taskId); return next;
      }), 900);
    }

    if (isViewerLocal) {
      setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, done: !isCurrentlyDone } : t));
    } else {
      onPatchTasks(project.id, ts => ts.map(t =>
        t.id === taskId
          ? { ...t, done: !isCurrentlyDone, finishedAt: !isCurrentlyDone ? new Date().toISOString() : null }
          : t
      ));
      api('task_toggle', { projectId: project.id, taskId }).catch(() => {}).finally(onUpdate);
    }

    if (isCompletingLast) {
      setCelebrationKey(prev => prev + 1);
      setShowCelebration(true);
    }
  };

  const deleteTask = (taskId) => {
    const taskToDelete = activeTasks.find(t => t.id === taskId);
    if (!taskToDelete) return;

    if (isViewerLocal) {
      setLocalTasks(prev => prev.filter(t => t.id !== taskId));
      onToast({
        message: 'Task deleted',
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => setLocalTasks(prev => [...prev, taskToDelete]),
        }
      });
      return;
    }

    // Deferred delete: the server isn't called until the 10s undo window
    // closes, so Undo restores the task with all its comments/files intact.
    onScheduleTaskDelete(taskToDelete);
  };

  const updateTaskText = (taskId, text) => {
    if (isViewerLocal) {
      setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, text } : t));
      return;
    }
    onPatchTasks(project.id, ts => ts.map(t => t.id === taskId ? { ...t, text } : t));
    api('rename_task', { projectId: project.id, taskId, text }).catch(() => {}).finally(onUpdate);
  };

  const updateTaskMeta = (taskId, field, value) => {
    if (isViewerLocal) {
      setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t));
      return;
    }
    onPatchTasks(project.id, ts => ts.map(t => t.id === taskId ? { ...t, [field]: value } : t));
    api('update_task_meta', { projectId: project.id, taskId, [field]: value }).catch(() => {}).finally(onUpdate);
  };

  // The inline editor produces rich HTML — it must persist to richNotes (the
  // field the editor displays with priority over plain notes), otherwise the
  // next refetch reverts the task to its stale richNotes copy.
  const saveTaskNotes = async (taskId, html) => {
    if (isViewerLocal) {
      setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, richNotes: html } : t));
      return;
    }
    onPatchTasks(project.id, ts => ts.map(t => t.id === taskId ? { ...t, richNotes: html } : t));
    try {
      await api('save_task_rich_notes', { projectId: project.id, taskId, notes: html });
    } catch {
      onToast('Could not save task notes — check your connection');
    }
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
              {/* Call button — rendered unconditionally so it is visible to users.
                  Space-level collaborators count as project members for call gating. */}
              <CallButton
                project={{ ...project, collaborators: allCollaborators }}
                onStartCall={onStartCall}
                hasActiveCall={!!incomingCall}
                isInCall={isInCall}
                contrastColor={getContrastColor(project.color)}
                livekitEnabled={livekitEnabled}
                onToast={onToast}
              />
              <div
                className="collab-pill has-tooltip" 
                style={{ background: `${getContrastColor(project.color)}26`, padding: '8px 8px 8px 16px', borderRadius: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}
              >
                <div className="tooltip-content">
                  {allCollaborators.length > 0
                    ? allCollaborators.map(c => c.viaSpace ? `${c.name} (via space)` : c.name).join('\n')
                    : 'No collaborators yet — invite someone!'}
                </div>
                <div className="project-collab-summary" style={{ margin: 0 }}>
                  <div className="collab-stack" style={{ display: 'flex' }}>
                    {allCollaborators.slice(0, 4).map(c => (
                      <div key={c.id || c.userId} className="collab-chip" title={c.viaSpace ? `${c.name} (via space)` : c.name} style={{ border: 'none', background: getContrastColor(project.color), color: project.color }}>{initials(c.name)}</div>
                    ))}
                    {allCollaborators.length === 0 && (
                      <div className="collab-chip" style={{ border: 'none', background: getContrastColor(project.color), color: project.color }}>+</div>
                    )}
                  </div>
                  <span className="collab-count" style={{ color: `${getContrastColor(project.color)}cc`, fontWeight: '600' }}>
                    {allCollaborators.length ? `${allCollaborators.length} collaborator${allCollaborators.length > 1 ? 's' : ''}` : 'No collaborators yet'}
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
                <div style={{ position: 'relative' }} ref={viewMenuRef}>
                  <button className="view-switch-btn" onClick={() => setShowViewMenu(v => !v)} title="Change view">
                    {(() => {
                      const active = VIEW_OPTIONS.find(o => o.key === viewMode) || VIEW_OPTIONS[0];
                      const ActiveIcon = active.Icon;
                      return (<><ActiveIcon size={13} strokeWidth={2.5} />{active.label}</>);
                    })()}
                    <ChevronDown size={12} strokeWidth={2.5} style={{ opacity: 0.6 }} />
                  </button>
                  {showViewMenu && (
                    <div className="view-switch-menu">
                      {VIEW_OPTIONS.map(opt => {
                        const OptIcon = opt.Icon;
                        return (
                          <button
                            key={opt.key}
                            className={`view-switch-item ${viewMode === opt.key ? 'active' : ''}`}
                            onClick={() => changeViewMode(opt.key)}
                          >
                            <OptIcon size={14} strokeWidth={2.5} />
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
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

            {viewMode === 'board' && (
              <TaskBoard
                tasks={processedTasks}
                project={project}
                collaborators={mentionUsers}
                currentUser={currentUser}
                onToggle={toggleTask}
                onUpdateMeta={(taskId, field, val) => updateTaskMeta(taskId, field, val)}
                onAddTask={addTaskFromBoard}
                onDelete={deleteTask}
                onTaskClick={jumpToTask}
                readOnly={isSharedView && currentUserRole === 'viewer'}
              />
            )}

            {viewMode === 'calendar' && (
              <TaskCalendar
                tasks={processedTasks}
                onUpdateMeta={(taskId, field, val) => updateTaskMeta(taskId, field, val)}
                onTaskClick={jumpToTask}
                readOnly={isSharedView && currentUserRole === 'viewer'}
              />
            )}

            {viewMode === 'list' && (
            <div id="tasks-list">
              {processedTasks.filter(t => !effDone(t)).length === 0 && (processedTasks.length === 0 || hideCompleted) ? (
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
                {processedTasks.filter(t => !effDone(t)).map(t => (
                  <motion.div
                    key={t.id}
                    layout
                    initial={{ opacity: 0, y: -10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
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
                      highlighted={highlightedTaskId === t.id || focusTaskId === t.id}
                      readOnly={isSharedView && currentUserRole === 'viewer'}
                      currentUser={currentUser}
                      collaborators={mentionUsers}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              )}
            </div>
            )}

            {(!isSharedView || currentUserRole === 'editor') && (
              <div className="add-row">
                <input
                  ref={addTaskInputRef}
                  className="add-input"
                  placeholder="Add a task... (Press 'N' to focus)"
                  value={newTaskText}
                  onChange={e => setNewTaskText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTask()}
                  maxLength={200}
                />
                <button className="btn-add" onClick={addTask}>Add</button>
              </div>
            )}

            {viewMode === 'list' && processedTasks.some(t => effDone(t)) && (
              <>
                <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--faint)', letterSpacing: '.08em', textTransform: 'uppercase', padding: '12px 12px 4px' }}>Completed</div>
                <div id="tasks-list-done">
                  <AnimatePresence initial={false}>
                    {processedTasks.filter(t => effDone(t)).map(t => (
                      <motion.div
                        key={t.id}
                        layout
                        initial={{ opacity: 0, y: -10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
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
                          highlighted={highlightedTaskId === t.id || focusTaskId === t.id}
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
                  <div className="img-grid" ref={imgGridRef}>
                    {images.map(f => (
                      <div className="img-thumb" key={f.id}>
                        <img src={f.url.startsWith('http') ? f.url : `/${f.url}`} alt={f.name} loading="lazy" />
                        <div className="img-thumb-overlay">
                          <button className="btn-file" onClick={(e) => { e.stopPropagation(); onOpenLightbox(f.url.startsWith('http') ? f.url : `/${f.url}`); }}>View</button>
                          <a className="btn-file" href={apiUrl(`/api/download?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}`)} onClick={e => e.stopPropagation()} target="_blank" rel="noreferrer" title="Download">↓</a>
                          <button className="btn-file del" onClick={(e) => { e.stopPropagation(); deleteFile(f.id); }}>Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {others.length > 0 && (
                <div className="files-list" ref={filesListRef} style={{ marginTop: '12px' }}>
                  {others.map(f => (
                    <div className="file-item" key={f.id}>
                      <span className="file-icon">{fileIcon(f.type)}</span>
                      <div className="file-info">
                        <div className="file-name">{f.name}</div>
                        <div className="file-meta">{f.type.toUpperCase()} · {formatSize(f.size)} · {f.uploaded}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <a className="btn-file" href={apiUrl(`/api/download?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}`)} target="_blank" rel="noreferrer">↓</a>
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
            <div
              className="section-head"
              role="button"
              tabIndex={0}
              aria-expanded={!activityCollapsed}
              onClick={() => setActivityCollapsed(c => { localStorage.setItem('bj_activity_collapsed', c ? '0' : '1'); return !c; })}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
              style={{
                cursor: 'pointer', userSelect: 'none',
                borderBottomColor: activityCollapsed ? 'transparent' : undefined,
                transition: 'border-color 0.3s ease',
              }}
            >
              <span className="section-head-title">Activity</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--faint)' }}>Recent changes</span>
                <ChevronDown
                  size={15}
                  strokeWidth={2.5}
                  style={{
                    color: 'var(--muted)', flexShrink: 0,
                    transform: activityCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
              </span>
            </div>
            <AnimatePresence initial={false}>
              {!activityCollapsed && (
                <motion.div
                  key="activity-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ height: { duration: 0.3, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.2 } }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="section-body">
                    <ActivityFeed project={project} currentUser={currentUser} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {showCelebration && (
        <ConfettiCelebration 
          key={celebrationKey}
          onDone={() => setShowCelebration(false)} 
        />
      )}

      <AnimatePresence>
      {showEditProject && (
        <FadeOut key="edit-project">
        <ProjectModal
          project={project}
          onClose={() => setShowEditProject(false)}
          onSuccess={() => { setShowEditProject(false); onUpdate(); }}
        />
        </FadeOut>
      )}
      </AnimatePresence>
    </div>
  );
}
