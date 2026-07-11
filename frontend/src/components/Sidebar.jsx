import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Users } from 'lucide-react';
import { Reorder, useDragControls, motion } from 'framer-motion';
import { api } from '../api';
import DialogModal from './DialogModal';
import ProjectModal from './ProjectModal';
import SpaceModal from './SpaceModal';

// Community lives on its own subdomain (separate app/DB) — this is just a link
// out, zero load on this app. Override via VITE_COMMUNITY_URL per environment.
const COMMUNITY_URL = import.meta.env.VITE_COMMUNITY_URL || 'https://community.brainjot.space';

// Motion-enabled <nav> so layoutScroll can keep drag measurements accurate
// while the sidebar auto-scrolls during a reorder drag
const MotionNav = motion.nav;

// One reorderable sidebar row/block (space or project). Render-prop child
// receives the drag controls so only the dot-grid handle starts a drag —
// clicks on the row keep selecting/expanding as normal. Opaque background
// so rows beneath don't show through while the item floats.
function SidebarReorderItem({ value, onDragEnd, style, children }) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      as="div"
      value={value}
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02, zIndex: 5, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
      style={{ position: 'relative', borderRadius: '12px', background: 'var(--surface)', ...style }}
    >
      {children(dragControls)}
    </Reorder.Item>
  );
}

export default function Sidebar({
  spaces = [],
  projects = [],
  sharedProjects = [],
  sharedSpaces = [],
  currentProjectId,
  currentSpaceId,
  currentSharedProjectId,
  currentSharedSpaceId,
  sidebarOpen,
  onSelect,
  onSelectSpace,
  onSelectShared,
  onSelectSharedSpace,
  onAddSpace,
  onAddProjectToSpace,
  onShareSpace,
  onLogout,
  onReorder,
  collapsed,
  currentUser,
  onOpenProfile,
}) {
  const dragModifierRef = useRef(false);
  // Order chosen by an in-flight/finished motion drag; null = server order.
  // Refs mirror state so the dragEnd handlers read the latest without re-binding.
  const [localSpaceOrder, setLocalSpaceOrder] = useState(null);
  const spaceOrderRef = useRef(null);
  // Same for projects, scoped to one space: { spaceId, ids }
  const [localProjOrder, setLocalProjOrder] = useState(null);
  const projOrderRef = useRef(null);
  const [expandedSpaces,  setExpandedSpaces]  = useState(new Set());
  const [contextMenu,     setContextMenu]     = useState({ open: false, x: 0, y: 0, project: null });
  const [spaceCtxMenu,    setSpaceCtxMenu]    = useState({ open: false, x: 0, y: 0, space: null });
  const [showEditProject, setShowEditProject] = useState(false);
  const [showEditSpace,   setShowEditSpace]   = useState(null);
  const [dialogConfig,    setDialogConfig]    = useState({ open: false, type: '', title: '', message: '', onConfirm: null });

  // Community unread count (DMs + community notifications), fetched from the
  // COMMUNITY backend directly — zero load on this app's backend. Same-site
  // cookie carries the community session; silent zero for users who have
  // never opened the community.
  const [communityUnread, setCommunityUnread] = useState(0);
  useEffect(() => {
    const communityApi = (import.meta.env.VITE_COMMUNITY_API_URL || 'https://api.community.brainjot.space').replace(/\/+$/, '');
    let cancelled = false;
    async function fetchBadge() {
      try {
        const r = await fetch(`${communityApi}/api/notifications/badges`, { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setCommunityUnread(data.total || 0);
      } catch { /* community unreachable or not logged in — no badge */ }
    }
    fetchBadge();
    const t = setInterval(fetchBadge, 120000); // every 2 min; it's a remote app
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Auto-expand the space that contains the active project or the active space
  useEffect(() => {
    if (currentSpaceId) {
      setExpandedSpaces(prev => new Set([...prev, currentSpaceId]));
    }
    if (currentProjectId) {
      const proj = projects.find(p => p.id === currentProjectId);
      if (proj?.spaceId) setExpandedSpaces(prev => new Set([...prev, proj.spaceId]));
      // Also expand the shared space if this project lives there
      sharedSpaces.forEach(s => {
        if ((s.projects || []).some(p => p.id === currentProjectId)) {
          setExpandedSpaces(prev => new Set([...prev, s.id]));
        }
      });
    }
  }, [currentProjectId, currentSpaceId, projects, sharedSpaces]);

  useEffect(() => {
    if (currentSharedSpaceId) {
      setExpandedSpaces(prev => new Set([...prev, currentSharedSpaceId]));
    }
  }, [currentSharedSpaceId]);

  useEffect(() => {
    if (!contextMenu.open && !spaceCtxMenu.open) return;
    const close = () => {
      setContextMenu(p => ({ ...p, open: false }));
      setSpaceCtxMenu(p => ({ ...p, open: false }));
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu.open, spaceCtxMenu.open]);

  const toggleSpace = (spaceId) => {
    setExpandedSpaces(prev => {
      const next = new Set(prev);
      next.has(spaceId) ? next.delete(spaceId) : next.add(spaceId);
      return next;
    });
  };

  const handleSpaceNameClick = (space) => {
    const isExpanded = expandedSpaces.has(space.id);
    const isSpaceViewActive = currentSpaceId === space.id && !currentProjectId;
    if (isSpaceViewActive && isExpanded) {
      setExpandedSpaces(prev => { const next = new Set(prev); next.delete(space.id); return next; });
    } else {
      setExpandedSpaces(prev => new Set([...prev, space.id]));
      onSelectSpace(space.id);
      onSelect(null);
    }
  };

  const handleSharedSpaceNameClick = (space) => {
    const isExpanded = expandedSpaces.has(space.id);
    const isActive = currentSharedSpaceId === space.id;
    if (isActive && isExpanded) {
      setExpandedSpaces(prev => { const next = new Set(prev); next.delete(space.id); return next; });
    } else {
      setExpandedSpaces(prev => new Set([...prev, space.id]));
      onSelectSharedSpace(space.id);
    }
  };


  // ── Project context menu actions ──────────────────────────────────
  const duplicateProject = async () => {
    if (!contextMenu.project) return;
    await api('duplicate_project', { projectId: contextMenu.project.id });
    onReorder();
    setContextMenu(p => ({ ...p, open: false }));
  };

  const confirmDeleteProject = () => {
    if (!contextMenu.project) return;
    const proj = contextMenu.project;
    setDialogConfig({
      open: true, type: 'confirm',
      title: 'Delete project',
      message: 'Delete this project forever?',
      onConfirm: async () => {
        await api('delete_project', { projectId: proj.id });
        if (currentProjectId === proj.id) onSelect(null);
        onReorder();
        setDialogConfig(p => ({ ...p, open: false }));
      },
    });
    setContextMenu(p => ({ ...p, open: false }));
  };

  const archiveProject = async () => {
    const proj = contextMenu.project;
    if (!proj) return;
    setContextMenu(p => ({ ...p, open: false }));
    await api('archive_project', { projectId: proj.id });
    onReorder();
  };

  const unarchiveProject = async () => {
    const proj = contextMenu.project;
    if (!proj) return;
    setContextMenu(p => ({ ...p, open: false }));
    await api('unarchive_project', { projectId: proj.id });
    onReorder();
  };

  // ── Space context menu actions ────────────────────────────────────
  const confirmDeleteSpace = () => {
    if (!spaceCtxMenu.space) return;
    const space = spaceCtxMenu.space;
    const projCount = projects.filter(p => p.spaceId === space.id).length;
    setDialogConfig({
      open: true, type: 'confirm',
      title: 'Delete space',
      message: `Delete "${space.title}" and all ${projCount} project(s) inside it? This cannot be undone.`,
      onConfirm: async () => {
        await api('delete_space', { spaceId: space.id });
        if (currentSpaceId === space.id) onSelectSpace(null);
        onReorder();
        setDialogConfig(p => ({ ...p, open: false }));
      },
    });
    setSpaceCtxMenu(p => ({ ...p, open: false }));
  };

  // ── HTML5 drag of a project row: drop onto a space header to copy ──
  // (or Ctrl/⌘ to move). Reordering within a space is motion-based below.
  const handleDragStart = (e, pid, title, color) => {
    e.dataTransfer.setData('projectId', pid);
    e.dataTransfer.effectAllowed = 'copyMove';
    const pill = document.createElement('div');
    pill.style.cssText = 'position:fixed;left:-9999px;top:0;display:flex;align-items:center;gap:8px;background:#1e1e1e;color:#f5f5f5;padding:8px 14px;border-radius:10px;font-size:13px;font-weight:700;border:1px solid rgba(255,255,255,0.15);box-shadow:0 4px 16px rgba(0,0,0,0.5);white-space:nowrap';
    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0`;
    const label = document.createElement('span');
    label.textContent = title;
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:10px;color:#666;margin-left:4px';
    hint.textContent = '⌘ move · drag copy';
    pill.appendChild(dot); pill.appendChild(label); pill.appendChild(hint);
    document.body.appendChild(pill);
    e.dataTransfer.setDragImage(pill, pill.offsetWidth / 2, 20);
    requestAnimationFrame(() => document.body.removeChild(pill));
  };
  // Spaces in locally-dragged order when valid, otherwise server order.
  // Falling back (rather than resetting state) keeps a mid-drag socket
  // refresh from snapping the list while the user is still holding an item.
  const orderedSpaces = useMemo(() => {
    if (!localSpaceOrder) return spaces;
    const byId = new Map(spaces.map(s => [s.id, s]));
    const usable = localSpaceOrder.length === spaces.length && localSpaceOrder.every(id => byId.has(id));
    return usable ? localSpaceOrder.map(id => byId.get(id)) : spaces;
  }, [spaces, localSpaceOrder]);

  // ── Space reorder (framer-motion pointer drag) ────────────────────
  // Reorder.Group's onReorder fires live while dragging, which is what makes
  // the rows slide out of the way. We keep that order locally and only hit
  // the API once, on drop. The local order is ignored (server order wins)
  // whenever the id set differs — e.g. a space was added or deleted.
  const handleSpacesReorder = (ids) => {
    spaceOrderRef.current = ids;
    setLocalSpaceOrder(ids);
  };
  const handleSpaceDragEnd = async () => {
    const order = spaceOrderRef.current;
    if (!order) return;
    const serverOrder = spaces.map(s => s.id);
    if (order.length === serverOrder.length && order.every((id, i) => id === serverOrder[i])) return;
    await api('reorder_spaces', { order });
    onReorder();
  };

  // ── Project reorder within a space (framer-motion pointer drag) ────
  // The API wants one global project order, so on drop we take the global
  // list and rewrite just the slots occupied by this space's projects with
  // their newly dragged sequence — other spaces' ordering is untouched.
  const handleProjectsReorder = (spaceId, ids) => {
    projOrderRef.current = { spaceId, ids };
    setLocalProjOrder({ spaceId, ids });
  };
  const handleProjectDragEnd = async () => {
    const local = projOrderRef.current;
    if (!local) return;
    const globalIds = projects.map(p => p.id);
    const inSpace = new Set(local.ids);
    let k = 0;
    const merged = globalIds.map(id => (inSpace.has(id) ? local.ids[k++] : id));
    if (merged.every((id, i) => id === globalIds[i])) return;
    await api('reorder_projects', { order: merged });
    onReorder();
  };

  // spaceProjects in locally-dragged order when the drag belongs to this
  // space and the id set still matches; otherwise server order (same
  // snap-back guard as orderedSpaces above).
  const orderProjectsFor = (spaceId, baseProjects) => {
    if (localProjOrder?.spaceId !== spaceId) return baseProjects;
    const byId = new Map(baseProjects.map(p => [p.id, p]));
    const usable = localProjOrder.ids.length === baseProjects.length && localProjOrder.ids.every(id => byId.has(id));
    return usable ? localProjOrder.ids.map(id => byId.get(id)) : baseProjects;
  };

  // ── Drop a project onto a space header (copy, or Ctrl/⌘ to move) ──
  const handleSpaceDragOver  = (e) => {
    e.preventDefault();
    dragModifierRef.current = e.ctrlKey || e.metaKey;
    e.dataTransfer.dropEffect = dragModifierRef.current ? 'move' : 'copy';
    e.currentTarget.classList.add('drop-target');
  };
  const handleSpaceDragLeave = (e) => { e.currentTarget.classList.remove('drop-target'); };
  const handleSpaceDrop      = async (e, targetSid) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drop-target');
    const sourcePid = e.dataTransfer.getData('projectId');
    if (!sourcePid) return;
    const sourceProject = projects.find(p => p.id === sourcePid);
    if (!sourceProject || sourceProject.spaceId === targetSid) return;
    const isMove = dragModifierRef.current;
    await api(isMove ? 'move_project' : 'copy_project', { projectId: sourcePid, spaceId: targetSid });
    // Auto-expand the target space so user sees the result
    setExpandedSpaces(prev => new Set([...prev, targetSid]));
    onReorder();
  };

  return (
    <aside
      className={`sidebar ${sidebarOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}
      id="sidebar"
      onClick={() => { setContextMenu(p => ({ ...p, open: false })); setSpaceCtxMenu(p => ({ ...p, open: false })); }}
    >
      {/* Logo */}
      <div className="sb-logo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="logo-text">BrainJot</div>
          <button
            onClick={onOpenProfile}
            title="View your profile"
            aria-label="Open profile"
            style={{
              background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
              color: 'var(--muted)', fontSize: '14px', fontWeight: '500',
              display: 'flex', alignItems: 'center', gap: '6px',
              transition: 'color 0.15s', textAlign: 'left', fontFamily: 'inherit',
              maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.name || ''}</span>
            <span style={{ fontSize: '10px', opacity: 0.5, flexShrink: 0 }}>↗</span>
          </button>
        </div>
        <button
          className="nav-item mobile-only"
          style={{ width: 'auto', padding: '8px', background: 'transparent', flexShrink: 0 }}
          onClick={() => onSelect(currentProjectId)}
          aria-label="Close sidebar"
          title="Close Sidebar"
        >
          <span style={{ fontSize: '18px' }}>✕</span>
        </button>
      </div>

      <MotionNav className="sb-nav" layoutScroll>
        {/* Overview */}
        <div className="nav-label">Overview</div>
        <button
          className={`nav-item ${!currentProjectId && !currentSpaceId ? 'active' : ''}`}
          onClick={() => { onSelect(null); onSelectSpace(null); }}
        >
          <span style={{ fontSize: '14px' }}>⊞</span> Brainview
        </button>

        {/* Spaces */}
        <div className="nav-label" style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Spaces</span>
          <button onClick={onAddSpace} title="New Space" style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 2px', fontWeight: '400', display: 'flex', alignItems: 'center' }}>+</button>
        </div>
        <Reorder.Group as="div" axis="y" id="nav-spaces" values={orderedSpaces.map(s => s.id)} onReorder={handleSpacesReorder}>
          {orderedSpaces.map(space => {
            const spaceProjects = orderProjectsFor(space.id, projects.filter(p => p.spaceId === space.id && !p.archived));
            const isExpanded = expandedSpaces.has(space.id);
            const isSpaceActive = currentSpaceId === space.id && !currentProjectId;
            return (
              <SidebarReorderItem key={space.id} value={space.id} onDragEnd={handleSpaceDragEnd} style={{ marginBottom: '4px' }}>
                {(dragControls) => (<>
                {/* Space header row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', borderRadius: '12px', overflow: 'hidden', marginBottom: '2px' }}
                  onContextMenu={e => { e.preventDefault(); setSpaceCtxMenu({ open: true, x: e.clientX, y: e.clientY, space }); }}
                  onDragOver={handleSpaceDragOver}
                  onDragLeave={handleSpaceDragLeave}
                  onDrop={e => handleSpaceDrop(e, space.id)}
                >
                  <div
                    onPointerDown={e => { e.preventDefault(); dragControls.start(e); }}
                    title="Drag to reorder"
                    aria-label={`Drag to reorder ${space.title}`}
                    style={{ touchAction: 'none', cursor: 'grab', display: 'flex', alignItems: 'center', alignSelf: 'stretch', paddingLeft: '6px', paddingRight: '2px', flexShrink: 0 }}
                  >
                    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style={{ opacity: 0.25, color: 'var(--muted)', pointerEvents: 'none' }}>
                      <circle cx="3" cy="2.5" r="1.5"/><circle cx="7" cy="2.5" r="1.5"/>
                      <circle cx="3" cy="7"   r="1.5"/><circle cx="7" cy="7"   r="1.5"/>
                      <circle cx="3" cy="11.5" r="1.5"/><circle cx="7" cy="11.5" r="1.5"/>
                    </svg>
                  </div>
                  <button
                    className={`nav-item ${isSpaceActive ? 'active' : ''}`}
                    onClick={() => handleSpaceNameClick(space)}
                    aria-expanded={isExpanded}
                    aria-label={`${space.title} space, ${isExpanded ? 'collapse' : 'expand'}`}
                    style={{ flex: 1, justifyContent: 'flex-start', gap: '8px', borderRadius: '12px', paddingRight: '4px' }}
                  >
                    <span style={{ width: '8px', height: '8px', borderRadius: '3px', background: space.color, flexShrink: 0, display: 'inline-block' }}></span>
                    <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: isSpaceActive ? '800' : '700' }}>
                      {space.title}
                    </span>
                    {spaceProjects.length > 0 && (
                      <span style={{ fontSize: '10px', background: `${space.color}33`, color: space.color, padding: '2px 6px', borderRadius: '8px', fontWeight: '800', flexShrink: 0 }}>
                        {spaceProjects.length}
                      </span>
                    )}
                    <span style={{ fontSize: '11px', color: 'var(--muted)', flexShrink: 0 }}>{isExpanded ? '▾' : '▸'}</span>
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setSpaceCtxMenu({ open: true, x: r.right, y: r.bottom, space }); }}
                    aria-label={`More options for ${space.title}`}
                    style={{ background: 'transparent', border: 'none', color: 'var(--faint)', cursor: 'pointer', padding: '6px', borderRadius: '8px', fontSize: '16px', flexShrink: 0, lineHeight: 1, transition: 'color 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--muted)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--faint)'}
                  >⋯</button>
                </div>


                {/* Projects under this space */}
                {isExpanded && spaceProjects.length > 0 && (
                  <Reorder.Group as="div" axis="y" values={spaceProjects.map(p => p.id)} onReorder={ids => handleProjectsReorder(space.id, ids)}>
                    {spaceProjects.map(p => (
                      <SidebarReorderItem key={p.id} value={p.id} onDragEnd={handleProjectDragEnd}>
                        {(projDragControls) => (
                          <div className="proj-row" style={{ display: 'flex', alignItems: 'center' }}>
                            <div
                              className="proj-drag-handle"
                              onPointerDown={e => { e.preventDefault(); projDragControls.start(e); }}
                              title="Drag to reorder"
                              aria-label={`Drag to reorder ${p.title}`}
                            >
                              <svg width="8" height="12" viewBox="0 0 10 14" fill="currentColor" style={{ pointerEvents: 'none' }}>
                                <circle cx="3" cy="2.5" r="1.5"/><circle cx="7" cy="2.5" r="1.5"/>
                                <circle cx="3" cy="7"   r="1.5"/><circle cx="7" cy="7"   r="1.5"/>
                                <circle cx="3" cy="11.5" r="1.5"/><circle cx="7" cy="11.5" r="1.5"/>
                              </svg>
                            </div>
                            <button
                              className={`nav-item ${currentProjectId === p.id ? 'active' : ''}`}
                              onClick={() => onSelect(p.id)}
                              onContextMenu={e => { e.preventDefault(); setContextMenu({ open: true, x: e.clientX, y: e.clientY, project: p }); }}
                              draggable="true"
                              onDragStart={e => handleDragStart(e, p.id, p.title, p.color)}
                              style={{ paddingLeft: '10px', fontSize: '13px', opacity: 0.9, flex: 1 }}
                            >
                              <span className="nav-dot" style={{ background: p.color }}></span>
                              <span className="nav-proj-title" style={{ flex: 1, textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                {p.title}
                              </span>
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setContextMenu({ open: true, x: r.right, y: r.bottom, project: p }); }}
                              aria-label={`More options for ${p.title}`}
                              style={{ background: 'transparent', border: 'none', color: 'var(--faint)', cursor: 'pointer', padding: '4px 6px', borderRadius: '6px', fontSize: '14px', flexShrink: 0, lineHeight: 1, transition: 'color 0.15s' }}
                              onMouseEnter={e => e.currentTarget.style.color = 'var(--muted)'}
                              onMouseLeave={e => e.currentTarget.style.color = 'var(--faint)'}
                            >⋯</button>
                          </div>
                        )}
                      </SidebarReorderItem>
                    ))}
                  </Reorder.Group>
                )}
                {isExpanded && spaceProjects.length === 0 && (
                  <div style={{ paddingLeft: '28px', fontSize: '12px', color: 'var(--faint)', padding: '4px 8px 4px 32px', fontStyle: 'italic' }}>No projects</div>
                )}
                {isExpanded && (
                  <button
                    onClick={e => { e.stopPropagation(); onAddProjectToSpace?.(space.id); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '5px 8px 5px 28px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '700', color: space.color, borderRadius: '8px', opacity: 0.8, transition: 'opacity 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0.8'}
                  >
                    <span style={{ fontSize: '14px', lineHeight: 1 }}>+</span> New Project
                  </button>
                )}
                </>)}
              </SidebarReorderItem>
            );
          })}
        </Reorder.Group>


        {/* Shared with me */}
        {(sharedSpaces.length > 0 || sharedProjects.length > 0) && (
          <>
            <div className="nav-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>Shared with me</span>
              <span style={{ background: 'var(--accent)', color: '#000', fontSize: '9px', fontWeight: '900', padding: '1px 6px', borderRadius: '20px', letterSpacing: '0.5px' }}>{sharedSpaces.length + sharedProjects.length}</span>
            </div>
            <div id="nav-shared">
              {sharedSpaces.map(s => {
                const spaceProjects = (s.projects || []).filter(p => !p.archived);
                const isExpanded = expandedSpaces.has(s.id);
                const isSpaceActive = currentSharedSpaceId === s.id && !currentProjectId;
                return (
                  <div key={s.id} style={{ marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', borderRadius: '12px', overflow: 'hidden', marginBottom: '2px' }}>
                      <button
                        className={`nav-item ${isSpaceActive ? 'active' : ''}`}
                        onClick={() => handleSharedSpaceNameClick(s)}
                        title={`Space shared by ${s.sharedBy}`}
                        style={{ flex: 1, justifyContent: 'flex-start', gap: '8px', borderRadius: '12px', paddingRight: '4px' }}
                      >
                        <span style={{ width: '8px', height: '8px', borderRadius: '3px', background: s.color, flexShrink: 0, display: 'inline-block' }}></span>
                        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: isSpaceActive ? '800' : '700' }}>
                          {s.title}
                        </span>
                        {spaceProjects.length > 0 && (
                          <span style={{ fontSize: '10px', background: `${s.color}33`, color: s.color, padding: '2px 6px', borderRadius: '8px', fontWeight: '800', flexShrink: 0 }}>
                            {spaceProjects.length}
                          </span>
                        )}
                        <span style={{ fontSize: '11px', color: 'var(--muted)', flexShrink: 0 }}>{isExpanded ? '▾' : '▸'}</span>
                      </button>
                      <span style={{ fontSize: '10px', background: 'var(--surface3)', color: 'var(--muted)', padding: '2px 6px', borderRadius: '8px', fontWeight: '700', flexShrink: 0, marginRight: '2px' }}>🗂</span>
                    </div>
                    {isExpanded && spaceProjects.map(p => {
                      const isOwned = projects.some(op => op.id === p.id);
                      return (
                        <button
                          key={p.id}
                          className={`nav-item ${currentProjectId === p.id ? 'active' : ''}`}
                          onClick={() => isOwned ? onSelect(p.id) : onSelectSharedSpace(s.id)}
                          style={{ paddingLeft: '28px', fontSize: '13px', opacity: 0.9, width: '100%' }}
                        >
                          <span className="nav-dot" style={{ background: p.color }}></span>
                          <span className="nav-proj-title" style={{ flex: 1, textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                            {p.title}
                          </span>
                        </button>
                      );
                    })}
                    {isExpanded && spaceProjects.length === 0 && (
                      <div style={{ fontSize: '12px', color: 'var(--faint)', padding: '4px 8px 4px 32px', fontStyle: 'italic' }}>No projects</div>
                    )}
                  </div>
                );
              })}
              {sharedProjects.map(p => (
                <button
                  key={p.id}
                  className={`nav-item ${currentSharedProjectId === p.id ? 'active' : ''}`}
                  onClick={() => onSelectShared(p.id)}
                  title={`Shared by ${p.sharedBy}`}
                >
                  <span className="nav-dot" style={{ background: p.color }}></span>
                  <span className="nav-proj-title" style={{ flex: 1, textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.title}</span>
                  <span style={{ fontSize: '10px', background: 'var(--surface3)', color: 'var(--muted)', padding: '2px 6px', borderRadius: '8px', fontWeight: '700', flexShrink: 0 }}>👥</span>
                </button>
              ))}
            </div>
          </>
        )}
      </MotionNav>

      <div className="sb-bottom">
        <a className="sb-community-btn" href={COMMUNITY_URL} title="brainjot Community">
          <Users size={17} strokeWidth={2.5} />
          BJ Community
          {communityUnread > 0 && (
            <span className="sb-community-badge">{communityUnread > 9 ? '9+' : communityUnread}</span>
          )}
        </a>
      </div>

      {/* Project context menu */}
      {contextMenu.open && (
        <div className="context-menu open" style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }} onClick={e => e.stopPropagation()}>
          <button className="context-menu-btn" onClick={() => { setShowEditProject(true); setContextMenu(p => ({ ...p, open: false })); }}>✎ Edit project</button>
          <button className="context-menu-btn" onClick={() => duplicateProject()}>⧉ Duplicate project</button>
          {contextMenu.project?.archived ? (
            <button className="context-menu-btn" onClick={() => unarchiveProject()}>📥 Unarchive project</button>
          ) : (
            <button className="context-menu-btn" onClick={() => archiveProject()}>📦 Archive project</button>
          )}
          <button className="context-menu-btn danger" onClick={() => confirmDeleteProject()}>🗑 Delete project</button>
        </div>
      )}

      {/* Space context menu */}
      {spaceCtxMenu.open && (
        <div className="context-menu open" style={{ position: 'fixed', left: spaceCtxMenu.x, top: spaceCtxMenu.y, zIndex: 9999 }} onClick={e => e.stopPropagation()}>
          <button className="context-menu-btn" onClick={() => { setShowEditSpace(spaceCtxMenu.space); setSpaceCtxMenu(p => ({ ...p, open: false })); }}>✎ Edit space</button>
          <button className="context-menu-btn" onClick={() => { onShareSpace?.(spaceCtxMenu.space.id); setSpaceCtxMenu(p => ({ ...p, open: false })); }}>👥 Share space</button>
          <button className="context-menu-btn danger" onClick={() => confirmDeleteSpace()}>🗑 Delete space</button>
        </div>
      )}

      <DialogModal
        isOpen={dialogConfig.open}
        type={dialogConfig.type}
        title={dialogConfig.title}
        message={dialogConfig.message}
        onConfirm={dialogConfig.onConfirm}
        onCancel={() => setDialogConfig(p => ({ ...p, open: false }))}
      />

      {showEditProject && contextMenu.project && (
        <ProjectModal
          project={contextMenu.project}
          onClose={() => setShowEditProject(false)}
          onSuccess={() => { setShowEditProject(false); onReorder(); }}
        />
      )}

      {showEditSpace && (
        <SpaceModal
          space={showEditSpace}
          onClose={() => setShowEditSpace(null)}
          onSuccess={() => { setShowEditSpace(null); onReorder(); }}
        />
      )}
    </aside>
  );
}
