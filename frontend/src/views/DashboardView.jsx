import React, { useState } from 'react';
import { Bell, Search, MessageSquarePlus, X } from 'lucide-react';
import { api } from '../api';
import ProjectCard, { CountUp } from '../components/ProjectCard';
import { getContrastColor } from '../utils/colors';

function SpaceCard({ space, projects, onOpenSpace, sharedBy }) {
  const spaceProjects = projects.filter(p => p.spaceId === space.id && !p.archived);
  const totalTasks = spaceProjects.reduce((s, p) => s + (p.tasks || []).length, 0);
  const doneTasks  = spaceProjects.reduce((s, p) => s + (p.tasks || []).filter(t => t.done).length, 0);
  const pct = totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0;
  const contrast = getContrastColor(space.color);

  return (
    <div
      className="proj-card"
      onClick={() => onOpenSpace(space.id)}
      style={{
        background: space.color,
        color: contrast,
        border: 'none',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: '100%',
        cursor: 'pointer',
      }}
    >
      <div className="liquid-wave-container">
        <div className="liquid-wave" style={{ height: `${pct}%` }}></div>
      </div>

      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div className="proj-card-top" style={{ padding: '24px 24px 16px' }}>
          <div className="proj-info">
            {sharedBy && (
              <div style={{ fontSize: '10px', fontWeight: '800', color: `${contrast}99`, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                Shared by {sharedBy}
              </div>
            )}
            <div className="proj-name" style={{ fontSize: 'max(22px, min(2.5vw, 30px))', fontWeight: '800', lineHeight: '1.1', letterSpacing: '-1px', color: contrast }}>{space.title}</div>
            {space.description && (
              <div className="proj-sub" style={{ color: `${contrast}a6`, marginTop: '6px', fontSize: '14px', fontWeight: '600' }}>{space.description}</div>
            )}
            <div className="proj-tag" style={{ borderColor: `${contrast}26`, color: `${contrast}cc`, backgroundColor: `${contrast}26`, fontSize: '11px', padding: '3px 8px', marginTop: '10px', fontWeight: '700', display: 'inline-block', borderRadius: '8px', border: `1px solid ${contrast}26` }}>
              {spaceProjects.length} {spaceProjects.length === 1 ? 'Project' : 'Projects'}
            </div>
          </div>
        </div>

        <div className="proj-card-foot" style={{ padding: '16px 24px 24px', display: 'flex', alignItems: 'flex-end', gap: '16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', color: `${contrast}80`, fontWeight: '700', fontSize: '12px', letterSpacing: '0.02em', marginBottom: '8px' }}>
              {doneTasks} / {totalTasks} tasks
            </span>
            <div style={{ background: `${contrast}26`, height: '5px', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: contrast, width: `${pct}%`, height: '100%', borderRadius: '8px', transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            <span style={{ color: contrast, fontWeight: '900', fontSize: '32px', letterSpacing: '-2px', lineHeight: 1 }}>
              <CountUp value={pct} />%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Skeleton placeholders — same shapes as the real cards so the layout doesn't
// jump when data arrives.
function DashboardSkeleton() {
  return (
    <>
      <div className="stats-row" style={{ marginBottom: '40px' }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="stat-card">
            <div className="sk sk-line" style={{ width: '56%', height: '12px', marginBottom: '12px' }} />
            <div className="sk sk-line" style={{ width: '32%', height: '24px' }} />
          </div>
        ))}
      </div>
      <div className="view active" style={{ paddingTop: 0 }}>
        <div className="sk sk-line" style={{ width: '110px', height: '22px', marginBottom: '24px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="sk sk-card" />
          ))}
        </div>
      </div>
    </>
  );
}

// ISO week key, e.g. "2026-W28" — used so the recap dismissal resets each week
function isoWeekKey(date) {
  const t = new Date(date);
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  const week = 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}-W${week}`;
}

export default function DashboardView({
  spaces = [],
  projects = [],
  sharedProjects = [],
  sharedSpaces = [],
  currentUser,
  isLoading = false,
  onToggleTask,
  onOpenProject,
  onOpenSharedProject,
  onOpenSpace,
  onOpenSharedSpace,
  onReorder,
  onOpenSearch,
  onOpenNotifications,
  onOpenFeedback,
  unreadNotifications = 0,
}) {
  // Tasks checked off moments ago stay on their focus card briefly so the
  // checkbox animation can play before the card leaves the rail.
  const [recentlyDone, setRecentlyDone] = useState(() => new Set());

  let doneCount  = 0;
  let totalCount = 0;
  let focusTasks = [];

  const now = new Date();
  const priorityWeight = { urgent: 1000, important: 500, later: 100 };
  const activeProjects = projects.filter(p => !p.archived);

  // Every task counted on this dashboard (own + shared-assigned-to-me),
  // gathered once so the greeting/streak/recap all agree with the stats.
  const countedDoneTasks = [];

  activeProjects.forEach(p => {
    (p.tasks || []).forEach(t => {
      totalCount++;
      if (t.done) { doneCount++; countedDoneTasks.push(t); if (!recentlyDone.has(t.id)) return; }
      let score = priorityWeight[t.priority] || 0;
      let isOverdue = false;
      let isDueToday = false;
      if (t.deadline) {
        const d = new Date(t.deadline);
        if (d < now) { score += 2000; isOverdue = true; }
        else { const diff = (d - now) / (1000 * 60 * 60 * 24); if (diff < 3) score += (3 - diff) * 200; if (diff < 1) isDueToday = true; }
      }
      focusTasks.push({ ...t, projectId: p.id, projectTitle: p.title, projectColor: p.color, score, isOverdue, isDueToday });
    });
  });

  sharedProjects.forEach(p => {
    (p.tasks || []).forEach(t => {
      const tAssignees = t.assignees || (t.assignee ? [t.assignee] : []);
      if (!tAssignees.includes('me')) return;
      totalCount++;
      if (t.done) { doneCount++; countedDoneTasks.push(t); if (!recentlyDone.has(t.id)) return; }
      let score = priorityWeight[t.priority] || 0;
      let isOverdue = false;
      let isDueToday = false;
      if (t.deadline) {
        const d = new Date(t.deadline);
        if (d < now) { score += 2000; isOverdue = true; }
        else { const diff = (d - now) / (1000 * 60 * 60 * 24); if (diff < 3) score += (3 - diff) * 200; if (diff < 1) isDueToday = true; }
      }
      focusTasks.push({ ...t, projectId: p.id, projectTitle: `${p.title} (Shared)`, projectColor: p.color, score, isOverdue, isDueToday, isShared: true });
    });
  });

  const topFocusTasks = focusTasks.sort((a, b) => b.score - a.score).slice(0, 8);
  const overallPct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  // ── Daily ritual: greeting, needs-attention count, evening wrap, streak ──
  const hour = now.getHours();
  const firstName = (currentUser?.name || '').trim().split(' ')[0] || '';
  const greeting = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const doneToday = countedDoneTasks.filter(t => t.finishedAt && new Date(t.finishedAt).toDateString() === now.toDateString()).length;
  const needsAttention = focusTasks.filter(t => t.isOverdue || t.isDueToday || t.priority === 'urgent').length;

  let greetingSub;
  if (hour >= 17 && doneToday > 0) {
    greetingSub = `You closed ${doneToday} task${doneToday === 1 ? '' : 's'} today — nice work.`;
  } else if (needsAttention > 0) {
    greetingSub = `${needsAttention} task${needsAttention === 1 ? ' needs' : 's need'} your attention today.`;
  } else if (focusTasks.length > 0) {
    greetingSub = 'Nothing urgent today — pick your own pace.';
  } else {
    greetingSub = 'All your deadlines, neatly categorized.';
  }

  // Streak: consecutive days with at least one completed task. Today doesn't
  // break the streak if nothing is done yet — yesterday's streak still shows.
  const completionDays = new Set();
  countedDoneTasks.forEach(t => { if (t.finishedAt) completionDays.add(new Date(t.finishedAt).toDateString()); });
  let streak = 0;
  {
    const cursor = new Date(now);
    if (!completionDays.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
    while (completionDays.has(cursor.toDateString())) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  // ── Weekly recap (Mondays, dismissible per week) ──
  const weekKey = isoWeekKey(now);
  const [recapDismissed, setRecapDismissed] = useState(() => {
    try { return localStorage.getItem(`bj_recap_${weekKey}`) === '1'; } catch { return true; }
  });
  const isMonday = now.getDay() === 1;

  let recap = null;
  if (isMonday && !recapDismissed) {
    const thisMonday = new Date(now); thisMonday.setHours(0, 0, 0, 0);
    const lastMonday = new Date(thisMonday); lastMonday.setDate(lastMonday.getDate() - 7);
    const spaceCounts = new Map();
    const dayCounts = new Map();
    let weekTotal = 0;
    const spaceTitle = (sid) => spaces.find(s => s.id === sid)?.title || 'Unsorted';
    activeProjects.forEach(p => {
      (p.tasks || []).forEach(t => {
        if (!t.done || !t.finishedAt) return;
        const f = new Date(t.finishedAt);
        if (f < lastMonday || f >= thisMonday) return;
        weekTotal++;
        const sName = spaceTitle(p.spaceId);
        spaceCounts.set(sName, (spaceCounts.get(sName) || 0) + 1);
        const dName = f.toLocaleDateString(undefined, { weekday: 'long' });
        dayCounts.set(dName, (dayCounts.get(dName) || 0) + 1);
      });
    });
    if (weekTotal > 0) {
      const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      recap = { total: weekTotal, busiestSpace: top(spaceCounts), bestDay: top(dayCounts) };
    }
  }

  const dismissRecap = () => {
    setRecapDismissed(true);
    try { localStorage.setItem(`bj_recap_${weekKey}`, '1'); } catch { /* storage unavailable */ }
  };

  const focusBadgeLabel = (() => {
    const overdueCount = topFocusTasks.filter(t => t.isOverdue).length;
    if (overdueCount > 0) return { text: `${overdueCount} OVERDUE`, color: '#ff4c4c' };
    const urgentCount = topFocusTasks.filter(t => t.priority === 'urgent').length;
    if (urgentCount > 0) return { text: `${urgentCount} URGENT`, color: 'var(--accent)' };
    const dueSoonCount = topFocusTasks.filter(t => t.deadline).length;
    if (dueSoonCount > 0) return { text: `${dueSoonCount} DUE SOON`, color: '#f59e0b' };
    return { text: `${topFocusTasks.length} TASKS`, color: 'var(--accent)' };
  })();

  const projectProgress = (p) => {
    if (!p.tasks || p.tasks.length === 0) return 0;
    return Math.round(p.tasks.filter(t => t.done).length / p.tasks.length * 100);
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

  const handleToggleFocusTask = (e, pId, tId) => {
    e.stopPropagation();
    setRecentlyDone(prev => new Set([...prev, tId]));
    setTimeout(() => setRecentlyDone(prev => {
      if (!prev.has(tId)) return prev;
      const next = new Set(prev); next.delete(tId); return next;
    }), 900);
    onToggleTask(pId, tId);
  };

  const toggleTheme = () => {
    const isLight = document.body.classList.contains('theme-light');
    if (isLight) { document.body.classList.remove('theme-light'); localStorage.setItem('theme', 'dark'); }
    else { document.body.classList.add('theme-light'); localStorage.setItem('theme', 'light'); }
  };

  return (
    <div style={{ paddingBottom: '100px' }}>
      <div className="topbar" style={{ position: 'relative', paddingTop: '60px' }}>
        <div style={{ width: '100%' }}>
          <div className="page-title brain-view" id="page-title" style={{ fontSize: 'max(28px, min(3.5vw, 42px))', lineHeight: '1.1', fontWeight: '800', letterSpacing: '-1.5px', maxWidth: '90%' }}>
            {greeting}{firstName ? `, ${firstName}` : ''}.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--muted)' }}>
              {isLoading ? 'Loading your day…' : greetingSub}
            </span>
            {!isLoading && streak >= 2 && (
              <span className="streak-chip" title={`You've completed at least one task every day for ${streak} days`}>
                🔥 {streak}-day streak
              </span>
            )}
          </div>
        </div>
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
          <button className="theme-toggle" style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: '20px', padding: '8px', opacity: 0.7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onOpenSearch} title="Search (Cmd+F)">
            <Search size={20} strokeWidth={2.5} />
          </button>
          <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">◐</button>
        </div>
      </div>

      {isLoading ? <DashboardSkeleton /> : (
      <>

      {/* Weekly recap — Mondays only, dismissed per week */}
      {recap && (
        <div style={{ padding: '24px 36px 0' }}>
          <div className="recap-card">
            <button className="recap-dismiss" onClick={dismissRecap} title="Dismiss" aria-label="Dismiss weekly recap">
              <X size={16} strokeWidth={2.5} />
            </button>
            <div className="recap-title">Your week in review</div>
            <div className="recap-stats">
              <div className="recap-stat">
                <div className="recap-stat-value"><CountUp value={recap.total} /></div>
                <div className="recap-stat-label">Tasks completed last week</div>
              </div>
              {recap.busiestSpace && (
                <div className="recap-stat">
                  <div className="recap-stat-value recap-stat-text">{recap.busiestSpace}</div>
                  <div className="recap-stat-label">Busiest space</div>
                </div>
              )}
              {recap.bestDay && (
                <div className="recap-stat">
                  <div className="recap-stat-value recap-stat-text">{recap.bestDay}</div>
                  <div className="recap-stat-label">Most productive day</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="stats-row" id="stats-row" style={{ marginBottom: '40px' }}>
        <div className="stat-card">
          <div className="stat-label">SPACES</div>
          <div className="stat-value">{spaces.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TASKS DONE</div>
          <div className="stat-value">{doneCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TOTAL TASKS</div>
          <div className="stat-value">{totalCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">OVERALL</div>
          <div className="stat-value"><CountUp value={overallPct} />%</div>
        </div>
      </div>

      {/* Today's Focus */}
      {topFocusTasks.length > 0 && (
        <div className="focus-section" style={{ padding: '0 36px', marginBottom: '56px' }}>
          <div className="focus-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2 style={{ fontSize: 'min(24px, 6vw)', fontWeight: '800', letterSpacing: '-0.8px', margin: 0 }}>Today's Focus</h2>
              <div style={{ background: focusBadgeLabel.color, color: focusBadgeLabel.color === 'var(--accent)' ? '#000' : '#fff', fontSize: '10px', fontWeight: '900', padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{focusBadgeLabel.text}</div>
            </div>
            {topFocusTasks.length > 1 && (
              <span className="scroll-hint" style={{ fontSize: '12px', fontWeight: '700', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Scroll for more ›</span>
            )}
          </div>
          <div className="focus-scroll-container" style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'calc(33.333% - 16px)', gap: '24px', overflowX: 'auto', paddingBottom: '16px', scrollSnapType: 'x mandatory', msOverflowStyle: 'none', scrollbarWidth: 'none' }}>
            {topFocusTasks.map(t => (
              <div
                key={t.id}
                className="focus-task-card"
                onClick={() => t.isShared ? onOpenSharedProject(t.projectId) : onOpenProject(t.projectId)}
                style={{ background: t.projectColor, color: '#000', padding: '20px', borderRadius: '24px', border: 'none', display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', scrollSnapAlign: 'start', minWidth: 0 }}
              >
                <button role="checkbox" aria-checked={!!t.done} aria-label="Toggle task done" tabIndex={0} className={`task-check ${t.done ? 'done' : ''}`} onClick={e => handleToggleFocusTask(e, t.projectId, t.id)} style={{ width: '24px', height: '24px', borderRadius: '8px', border: t.done ? undefined : '2px solid rgba(0,0,0,0.15)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.done ? undefined : 'none', padding: 0, cursor: 'pointer' }}></button>
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

      {/* Spaces Grid */}
      <div className="view active" id="view-dashboard" style={{ paddingTop: 0 }}>
        <h2 style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '-0.8px', marginBottom: '24px' }}>Spaces</h2>
        {spaces.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 0', color: 'var(--faint)' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px', opacity: 0.4 }}>🗂</div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--muted)', marginBottom: '8px' }}>No spaces yet</div>
            <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
              Spaces help you group related projects.<br />
              Click <strong style={{ color: 'var(--text)' }}>+ Spaces</strong> in the sidebar to create your first one.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginBottom: '56px' }}>
            {spaces.map(s => (
              <SpaceCard key={s.id} space={s} projects={activeProjects} onOpenSpace={onOpenSpace} />
            ))}
          </div>
        )}

        {(sharedSpaces.length > 0 || sharedProjects.length > 0) && (
          <div style={{ marginTop: '40px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: '800', letterSpacing: '0.05em', color: 'var(--faint)', textTransform: 'uppercase', marginBottom: '28px' }}>Shared with you</h2>

            {sharedSpaces.length > 0 && (
              <div style={{ marginBottom: '40px' }}>
                <div style={{ fontSize: '11px', fontWeight: '800', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '16px' }}>Spaces</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
                  {sharedSpaces.map(s => (
                    <SpaceCard key={s.id} space={s} projects={s.projects || []} onOpenSpace={() => onOpenSharedSpace(s.id)} sharedBy={s.ownerInfo?.name} />
                  ))}
                </div>
              </div>
            )}

            {sharedProjects.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: '800', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '16px' }}>Projects</div>
                <div className="projects-grid">
                  {sharedProjects.map(p => (
                    <div key={p.id} onDrop={e => handleDropGlobal(e, p.id)} onDragOver={e => e.preventDefault()}>
                      <ProjectCard p={p} onOpenProject={onOpenSharedProject} onReorder={onReorder} projectProgress={projectProgress} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      </>
      )}

    </div>
  );
}
