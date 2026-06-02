import React from 'react';
import { Bell, Search, MessageSquarePlus } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { api } from '../api';
import ProjectCard, { CountUp } from '../components/ProjectCard';
import { getContrastColor } from '../utils/colors';
import CallButton from '../components/CallButton';
import CallBanner from '../components/CallBanner';

const projectProgress = (p) => {
  if (!p.tasks || p.tasks.length === 0) return 0;
  return Math.round(p.tasks.filter(t => t.done).length / p.tasks.length * 100);
};

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

export default function SpaceView({
  space,
  projects,
  onOpenProject,
  onReorder,
  onAddProject,
  canAddProject = true,
  onOpenCollab,
  onEditSpace,
  onOpenSearch,
  onOpenNotifications,
  onOpenFeedback,
  unreadNotifications = 0,
  livekitEnabled = false,
  onStartCall,
  incomingCall,
  onRequestJoinCall,
  onJoinInvitedCall,
  callRequestSent = false,
  isInCall = false,
  onDismissCallBanner,
}) {
  const activeProjects = projects.filter(p => !p.archived);
  const totalTasks = activeProjects.reduce((s, p) => s + (p.tasks || []).length, 0);
  const doneTasks  = activeProjects.reduce((s, p) => s + (p.tasks || []).filter(t => t.done).length, 0);
  const pct = totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0;
  const contrast = getContrastColor(space.color);

  const now = new Date();
  const priorityWeight = { urgent: 1000, important: 500, later: 100 };
  const focusTasks = [];
  activeProjects.forEach(p => {
    (p.tasks || []).forEach(t => {
      if (t.done) return;
      let score = priorityWeight[t.priority] || 0;
      let isOverdue = false;
      if (t.deadline) {
        const d = new Date(t.deadline);
        if (d < now) { score += 2000; isOverdue = true; }
        else { const diff = (d - now) / (1000 * 60 * 60 * 24); if (diff < 3) score += (3 - diff) * 200; }
      }
      focusTasks.push({ ...t, projectId: p.id, projectTitle: p.title, projectColor: p.color, score, isOverdue });
    });
  });
  const topFocusTasks = focusTasks.sort((a, b) => b.score - a.score).slice(0, 8);

  const handleToggleFocusTask = async (e, pId, tId) => {
    e.stopPropagation();
    await api('task_toggle', { projectId: pId, taskId: tId });
    onReorder();
  };

  const handleDropGlobal = async (e, targetPid) => {
    e.preventDefault();
    const sourcePid = e.dataTransfer.getData('projectId');
    if (sourcePid === targetPid || !sourcePid) return;
    const newOrder = projects.map(p => p.id);
    const srcIdx = newOrder.indexOf(sourcePid);
    const tgtIdx = newOrder.indexOf(targetPid);
    newOrder.splice(srcIdx, 1);
    newOrder.splice(tgtIdx, 0, sourcePid);
    await api('reorder_projects', { order: newOrder });
    onReorder();
  };

  return (
    <div style={{ paddingBottom: '100px' }}>

      {/* Icon row — identical pattern to DashboardView topbar */}
      <div className="topbar" style={{ position: 'relative', paddingTop: '60px' }}>
        <div className="topbar-right" style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button className="theme-toggle" style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: '20px', padding: '8px', opacity: 0.7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onOpenFeedback} title="Beta Feedback">
            <MessageSquarePlus size={20} strokeWidth={2.5} />
          </button>
          <button className="theme-toggle" style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: '20px', padding: '8px', opacity: 0.7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onOpenNotifications} title="Notifications">
            <span style={{ position: 'relative' }}>
              <Bell size={20} strokeWidth={2.5} />
              {unreadNotifications > 0 && (
                <span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#ff4c4c', color: 'white', fontSize: '9px', fontWeight: '900', padding: '2px 5px', borderRadius: '10px' }}>{unreadNotifications}</span>
              )}
            </span>
          </button>
          <button className="theme-toggle" style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: '20px', padding: '8px', opacity: 0.7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onOpenSearch} title="Search">
            <Search size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Space Header Banner */}
      <div style={{ padding: '0 36px', marginBottom: '32px' }}>

        {/* Call banner */}
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
          background: space.color,
          padding: '40px',
          borderRadius: '32px',
          color: contrast,
          overflow: 'hidden',
        }}
      >
        <div className="liquid-wave-container">
          <div className="liquid-wave" style={{ height: `${pct}%` }}></div>
        </div>

        {/* Header content row — matches ProjectDetailView exactly */}
        <div className="detail-header-content" style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', width: '100%' }}>
          <div style={{ flex: 1 }}>
            <div className="detail-title" style={{ fontSize: 'max(36px, min(3.5vw, 56px))', fontWeight: '800', lineHeight: '1.1', letterSpacing: '-1px' }}>{space.title}</div>
            {space.description && (
              <div className="detail-sub" style={{ color: `${contrast}a6`, marginTop: '12px', fontSize: '16px', fontWeight: '600' }}>{space.description}</div>
            )}
          </div>

          <div className="detail-actions">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {livekitEnabled && (
                <CallButton
                  project={space}
                  onStartCall={onStartCall}
                  hasActiveCall={!!incomingCall}
                  isInCall={isInCall}
                  contrastColor={contrast}
                />
              )}
              <div
                className="collab-pill has-tooltip"
                style={{ background: `${contrast}26`, padding: '8px 8px 8px 16px', borderRadius: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}
              >
                <div className="tooltip-content">
                  {(space.collaborators || []).map(c => c.name).join('\n')}
                </div>
                <div className="project-collab-summary" style={{ margin: 0 }}>
                  <div className="collab-stack" style={{ display: 'flex' }}>
                    {(space.collaborators || []).slice(0, 4).map(c => (
                      <div key={c.id} className="collab-chip" title={c.name} style={{ border: 'none', background: contrast, color: space.color }}>{initials(c.name)}</div>
                    ))}
                    {(!space.collaborators || space.collaborators.length === 0) && (
                      <div className="collab-chip" style={{ border: 'none', background: contrast, color: space.color }}>+</div>
                    )}
                  </div>
                  <span className="collab-count" style={{ color: `${contrast}cc`, fontWeight: '600' }}>
                    {(space.collaborators || []).length
                      ? `${space.collaborators.length} collaborator${space.collaborators.length > 1 ? 's' : ''}`
                      : 'No collaborators yet'}
                  </span>
                </div>
                <button
                  className="ghost-action-btn"
                  onClick={onOpenCollab}
                  style={{ background: contrast, color: space.color, borderRadius: '16px', padding: '8px 16px', fontWeight: '600', border: 'none' }}
                >
                  Invite collaborators
                </button>
              </div>

              <button
                className="icon-action-btn"
                onClick={onEditSpace}
                title="Space Settings"
                style={{
                  background: `${contrast}26`,
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
                  color: contrast,
                  fontSize: '24px',
                }}
              >
                ⚙
              </button>
            </div>
          </div>

          <div className="desktop-pct" style={{ textAlign: 'right', minWidth: '68px', marginLeft: '32px' }}>
            <div className="detail-pct" style={{ color: contrast, fontSize: '36px', letterSpacing: '-1px', fontWeight: '800' }}>
              <CountUp value={pct} />%
            </div>
            <div className="detail-pct-label" style={{ color: `${contrast}99`, fontWeight: '600', fontSize: '13px' }}>complete</div>
          </div>
        </div>
      </div>
      </div>

      {/* Stats */}
      <div className="stats-row" id="stats-row" style={{ marginBottom: '40px' }}>
        <div className="stat-card">
          <div className="stat-label">PROJECTS</div>
          <div className="stat-value">{activeProjects.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TASKS DONE</div>
          <div className="stat-value">{doneTasks}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TOTAL TASKS</div>
          <div className="stat-value">{totalTasks}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">COMPLETION</div>
          <div className="stat-value">{pct}%</div>
        </div>
      </div>

      {/* Today's Focus */}
      {topFocusTasks.length > 0 && (
        <div className="focus-section" style={{ padding: '0 36px', marginBottom: '48px' }}>
          <div className="focus-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2 style={{ fontSize: 'min(24px, 6vw)', fontWeight: '800', letterSpacing: '-0.8px', margin: 0 }}>Today's Focus</h2>
              <div style={{ background: space.color, color: contrast, fontSize: '10px', fontWeight: '900', padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{topFocusTasks.length} TASK{topFocusTasks.length > 1 ? 'S' : ''}</div>
            </div>
            {topFocusTasks.length > 1 && (
              <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Scroll for more ›</span>
            )}
          </div>
          <div className="focus-scroll-container" style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'calc(33.333% - 16px)', gap: '24px', overflowX: 'auto', paddingBottom: '16px', scrollSnapType: 'x mandatory', msOverflowStyle: 'none', scrollbarWidth: 'none' }}>
            {topFocusTasks.map(t => (
              <div
                key={t.id}
                className="focus-task-card"
                onClick={() => onOpenProject(t.projectId)}
                style={{ background: t.projectColor, color: '#000', padding: '20px', borderRadius: '24px', border: 'none', display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', scrollSnapAlign: 'start', minWidth: 0 }}
              >
                <button
                  role="checkbox"
                  aria-checked={t.done}
                  aria-label="Toggle task done"
                  tabIndex={0}
                  onClick={e => handleToggleFocusTask(e, t.projectId, t.id)}
                  style={{ width: '24px', height: '24px', borderRadius: '8px', border: '2px solid rgba(0,0,0,0.15)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', padding: 0, cursor: 'pointer' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '16px', fontWeight: '800', lineHeight: '1.2', color: '#000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.3px' }}>{t.text}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase' }}>{t.projectTitle}</span>
                    {t.isOverdue && <span style={{ fontSize: '10px', fontWeight: '900', color: '#fff', background: '#ff4c4c', padding: '2px 7px', borderRadius: '6px' }}>OVERDUE</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Projects */}
      <div className="view active" style={{ paddingTop: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '-0.8px', margin: 0 }}>Projects</h2>
          {canAddProject && (
            <button
              onClick={onAddProject}
              style={{ background: space.color, color: '#fff', border: 'none', borderRadius: '12px', padding: '10px 20px', fontSize: '13px', fontWeight: '800', cursor: 'pointer', letterSpacing: '0.3px' }}
            >+ New Project</button>
          )}
        </div>

        {activeProjects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--faint)' }}>
            <div style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>No projects yet</div>
            <div style={{ fontSize: '14px', marginBottom: '24px' }}>
              {canAddProject ? 'Create your first project in this space' : 'No projects in this space yet'}
            </div>
            {canAddProject && (
              <button
                onClick={onAddProject}
                style={{ background: space.color, color: '#fff', border: 'none', borderRadius: '14px', padding: '12px 28px', fontSize: '14px', fontWeight: '800', cursor: 'pointer' }}
              >+ New Project</button>
            )}
          </div>
        ) : (
          <div className="projects-grid" id="proj-grid">
            {activeProjects.map(p => (
              <div
                key={p.id}
                onDrop={e => handleDropGlobal(e, p.id)}
                onDragOver={e => e.preventDefault()}
              >
                <ProjectCard
                  p={p}
                  onOpenProject={onOpenProject}
                  onReorder={onReorder}
                  projectProgress={projectProgress}
                />
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
