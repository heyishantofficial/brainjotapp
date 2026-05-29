import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io as socketIO } from 'socket.io-client';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from './api';
import LoginScreen from './components/LoginScreen';
import Sidebar from './components/Sidebar';
import DashboardView from './views/DashboardView';
import ProjectDetailView from './views/ProjectDetailView';
import Toast from './components/Toast';
import Lightbox from './components/Lightbox';
import QuoteBar from './components/QuoteBar';
import CommandPalette from './components/CommandPalette';
import { getContrastColor } from './utils/colors';
import ProjectModal from './components/ProjectModal';
import SpaceModal from './components/SpaceModal';
import SpaceView from './views/SpaceView';
import CollabModal from './components/CollabModal';
import SpaceCollabModal from './components/SpaceCollabModal';
import NotificationModal from './components/NotificationModal';
import ProfileView from './views/ProfileView';
import { requestNotificationPermission, scheduleDeadlineReminders, stopDeadlineReminders } from './utils/notifications';

// Lazy-loaded: heavy or rarely-used chunks loaded on demand
const AdminView        = React.lazy(() => import('./views/AdminView'));
const InviteLandingView = React.lazy(() => import('./views/InviteLandingView'));
const WordpadModal     = React.lazy(() => import('./components/WordpadModal'));
const FeedbackPanel    = React.lazy(() => import('./components/FeedbackPanel'));

const Spinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#000' }}>
    <div style={{ width: 32, height: 32, border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#D4FF32', borderRadius: '50%', animation: 'bj-spin 0.7s linear infinite' }} />
  </div>
);


function playNotifChime() {
  if (localStorage.getItem('soundEnabled') === 'false') return;
  try {
    const ctx = new AudioContext();
    [[880, 0, 0.12], [1108, 0.1, 0.28]].forEach(([freq, startOffset, endOffset]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + startOffset);
      gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + endOffset);
      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + endOffset);
    });
    setTimeout(() => ctx.close(), 500);
  } catch { /* AudioContext unavailable */ }
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [appData, setAppData] = useState({ spaces: [], projects: [] });
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [currentSpaceId, setCurrentSpaceId] = useState(null);
  const [sharedProjects, setSharedProjects] = useState([]);
  const [sharedSpaces, setSharedSpaces] = useState([]);
  const [currentSharedProjectId, setCurrentSharedProjectId] = useState(null);
  const [currentSharedSpaceId, setCurrentSharedSpaceId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // UI State
  const [toastData, setToastData] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState('');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState(null);
  
  // Modals
  const [showAddProject, setShowAddProject] = useState(false);
  const [addProjectSpaceId, setAddProjectSpaceId] = useState('');
  const [showAddSpace, setShowAddSpace] = useState(false);
  const [showEditSpace, setShowEditSpace] = useState(null);
  const [showWordpad, setShowWordpad] = useState({ open: false, type: '', taskId: '', initialContent: '' });
  const [showCollab, setShowCollab] = useState({ open: false, projectId: '' });
  const [showSpaceCollab, setShowSpaceCollab] = useState({ open: false, spaceId: '' });
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [inviteToken, setInviteToken] = useState(null);
  
  const [notifications, setNotifications] = useState([]);
  const unreadCount = notifications.filter(n => n.status === 'pending').length;
  const prevUnreadRef = useRef(null);
  useEffect(() => {
    if (prevUnreadRef.current !== null && unreadCount > prevUnreadRef.current) {
      playNotifChime();
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  const loadNotifications = useCallback(async () => {
    try {
      const r = await api('get_notifications', null, 'GET');
      if (r?.notifications) setNotifications(r.notifications);
    } catch { /* ignore */ }
  }, []);

  const appDataRef = useRef({ projects: [] });
  const socketRef = useRef(null);
  const currentRoomRef = useRef(null);
  const pollFailuresRef = useRef(0);

  const loadData = useCallback(async () => {
    try {
      const data = await api('get', null, 'GET');
      pollFailuresRef.current = 0; // reset on success
      if (data?.spaces && data?.projects) {
        appDataRef.current = data;
        setAppData(data);
        if (Array.isArray(data.sharedProjects)) setSharedProjects(data.sharedProjects);
        if (Array.isArray(data.sharedSpaces)) setSharedSpaces(data.sharedSpaces);
        scheduleDeadlineReminders(() => appDataRef.current.projects || []);
      }
    } catch (err) {
      // keep existing appData on transient failure
      pollFailuresRef.current += 1;
      if (pollFailuresRef.current >= 3) {
        console.error('[poll] loadData failed ' + pollFailuresRef.current + ' consecutive times', err?.message);
        // Hook point: Sentry.captureMessage('loadData polling failed', { extra: { consecutive: pollFailuresRef.current } });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll notifications and app data every 20 s — skips hidden tabs to save battery
  useEffect(() => {
    if (!loggedIn) return;
    const tick = () => {
      if (document.visibilityState === 'visible') { loadNotifications(); loadData(); }
    };
    const id = setInterval(tick, 20000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [loggedIn, loadNotifications, loadData]);

  // Real-time socket connection — WebSocket-first (skips polling upgrade round-trip)
  useEffect(() => {
    if (!loggedIn) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }
    const socket = socketIO({ withCredentials: true, transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('connect', () => {
      if (currentRoomRef.current) socket.emit('join_room', currentRoomRef.current);
    });
    let debounce;
    socket.on('project_updated', () => {
      clearTimeout(debounce);
      debounce = setTimeout(loadData, 500);
    });
    return () => { clearTimeout(debounce); socket.disconnect(); socketRef.current = null; };
  }, [loggedIn, loadData]);

  // Join/leave project room when active project changes
  const activeProjectId = currentProjectId || currentSharedProjectId;
  useEffect(() => {
    const newRoom = activeProjectId ? `project:${activeProjectId}` : null;
    const prevRoom = currentRoomRef.current;
    if (prevRoom !== newRoom) {
      if (prevRoom) socketRef.current?.emit('leave_room', prevRoom);
      if (newRoom) socketRef.current?.emit('join_room', newRoom);
      currentRoomRef.current = newRoom;
    }
  }, [activeProjectId]);

  const checkAuth = useCallback(async () => {
    try {
      const r = await api('check', null, 'GET');
      if (r.loggedIn) {
        setLoggedIn(true);
        setCurrentUser(r.user);
        loadData();
        loadNotifications();
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, [loadData, loadNotifications]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('join');
    if (token) setInviteToken(token);
    checkAuth();
  }, [checkAuth]);

  const handleAcceptInvite = useCallback(async (result) => {
    setInviteToken(null);
    window.history.replaceState({}, document.title, window.location.pathname);
    if (result?.ok) {
      await loadData();
      loadNotifications();
      if (result.entityType === 'project' && !result.alreadyOwner) {
        setCurrentSharedProjectId(result.entityId);
        setCurrentProjectId(null);
        setCurrentSpaceId(null);
        setCurrentSharedSpaceId(null);
      } else if (result.entityType === 'space' && !result.alreadyOwner) {
        setCurrentSharedSpaceId(result.entityId);
        setCurrentSpaceId(null);
        setCurrentProjectId(null);
        setCurrentSharedProjectId(null);
      }
    }
  }, [loadData, loadNotifications]);


  const handleNotifNavigate = useCallback(({ entityType, entityId, taskId }) => {
    setShowNotifications(false);
    setShowProfile(false);
    if (entityType === 'project') {
      const isOwned = (appData.projects || []).some(p => p.id === entityId);
      setCurrentSpaceId(null);
      setCurrentSharedSpaceId(null);
      if (isOwned) { setCurrentProjectId(entityId); setCurrentSharedProjectId(null); }
      else          { setCurrentSharedProjectId(entityId); setCurrentProjectId(null); }
      if (taskId) {
        setHighlightedTaskId(taskId);
        setTimeout(() => setHighlightedTaskId(null), 2500);
      }
    } else if (entityType === 'space') {
      const isOwned = (appData.spaces || []).some(s => s.id === entityId);
      setCurrentProjectId(null);
      setCurrentSharedProjectId(null);
      if (isOwned) { setCurrentSpaceId(entityId); setCurrentSharedSpaceId(null); }
      else          { setCurrentSharedSpaceId(entityId); setCurrentSpaceId(null); }
    }
  }, [appData.projects, appData.spaces]);

  const handleLogout = async () => {
    stopDeadlineReminders();
    await api('logout');
    setLoggedIn(false);
    setCurrentUser(null);
  };

  const updateProjectCollabRole = (pid, cid, newRole) => {
    // Update personal projects
    setAppData(prev => ({
      ...prev,
      projects: prev.projects.map(p => {
        if (p.id !== pid) return p;
        return {
          ...p,
          collaborators: (p.collaborators || []).map(c => 
            c.id === cid ? { ...c, role: newRole } : c
          )
        };
      })
    }));
    
    // Update shared projects
    setSharedProjects(prev => prev.map(p => {
      if (p.id !== pid) return p;
      return {
        ...p,
        collaborators: (p.collaborators || []).map(c => 
          c.id === cid ? { ...c, role: newRole } : c
        )
      };
    }));
  };

  const updateSpaceCollabRole = (sid, cid, newRole) => {
    setAppData(prev => ({
      ...prev,
      spaces: prev.spaces.map(s => {
        if (s.id !== sid) return s;
        return {
          ...s,
          collaborators: (s.collaborators || []).map(c =>
            c.id === cid ? { ...c, role: newRole } : c
          )
        };
      })
    }));
  };

  const toast = (data) => {
    if (typeof data === 'string') {
      setToastData({ message: data });
    } else {
      setToastData(data);
    }
  };

  if (loading) return <Spinner />;

  if (inviteToken && !loggedIn) {
    return <LoginScreen onLoginSuccess={(user) => {
      setLoggedIn(true);
      setCurrentUser(user);
      loadData();
      loadNotifications();
      requestNotificationPermission();
    }} />;
  }

  if (inviteToken && loggedIn) {
    return (
      <React.Suspense fallback={<Spinner />}>
        <InviteLandingView inviteToken={inviteToken} onAccept={handleAcceptInvite} />
      </React.Suspense>
    );
  }

  if (!loggedIn) {
    return <LoginScreen onLoginSuccess={(user) => {
      setLoggedIn(true);
      setCurrentUser(user);
      loadData();
      loadNotifications();
      requestNotificationPermission();
    }} />;
  }

  // Admin route gate — navigating to /admin shows the panel only for verified superadmins.
  // currentUser is populated from the server session (not localStorage), so this check is safe.
  if (window.location.pathname.startsWith('/admin')) {
    if (currentUser?.role === 'superadmin') {
      return (
        <React.Suspense fallback={<Spinner />}>
          <AdminView currentUser={currentUser} onLogout={handleLogout} />
        </React.Suspense>
      );
    }
    // Not an admin (or session not yet loaded) — silently redirect to home
    window.history.replaceState({}, '', '/');
  }

  const currentProject = (appData.projects || []).find(p => p.id === currentProjectId);
  const currentSharedProject = sharedProjects.find(p => p.id === currentSharedProjectId);
  const currentSharedSpace = sharedSpaces.find(s => s.id === currentSharedSpaceId);
  const currentSpace = appData.spaces?.find(s => s.id === currentSpaceId);
  const activeView = currentSharedProject ? 'shared' : currentSharedSpace ? 'shared-space' : currentProjectId ? 'project' : currentSpaceId && currentSpace ? 'space' : 'dashboard';

  return (
    <div id="app" style={{ display: 'block' }}>
      <button className={`hamburger ${sidebarOpen ? 'hidden' : ''}`} onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Open navigation menu" aria-expanded={sidebarOpen}>
        <span></span><span></span><span></span>
      </button>

      {/* Sidebar collapse toggle */}
      <button 
        className={`sidebar-toggle-btn ${sidebarCollapsed ? 'collapsed' : ''}`}
        onClick={() => setSidebarCollapsed(v => !v)}
        title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        style={currentProject 
          ? { background: currentProject.color, color: getContrastColor(currentProject.color), borderColor: 'transparent' } 
          : {}
        }
      >
        {sidebarCollapsed ? '›' : '‹'}
      </button>

      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)}></div>

      <Sidebar
        spaces={appData.spaces}
        projects={appData.projects}
        sharedProjects={sharedProjects}
        sharedSpaces={sharedSpaces}
        currentProjectId={currentProjectId}
        currentSpaceId={currentSpaceId}
        currentSharedProjectId={currentSharedProjectId}
        currentSharedSpaceId={currentSharedSpaceId}
        sidebarOpen={sidebarOpen}
        onSelect={(pid) => { setCurrentProjectId(pid); setCurrentSharedProjectId(null); setCurrentSharedSpaceId(null); setSidebarOpen(false); setShowProfile(false); }}
        onSelectSpace={(sid) => { setCurrentSpaceId(sid); setCurrentProjectId(null); setCurrentSharedProjectId(null); setCurrentSharedSpaceId(null); setSidebarOpen(false); setShowProfile(false); }}
        onSelectShared={(pid) => { setCurrentSharedProjectId(pid); setCurrentProjectId(null); setCurrentSpaceId(null); setCurrentSharedSpaceId(null); setSidebarOpen(false); setShowProfile(false); }}
        onSelectSharedSpace={(sid) => { setCurrentSharedSpaceId(sid); setCurrentProjectId(null); setCurrentSpaceId(null); setCurrentSharedProjectId(null); setSidebarOpen(false); setShowProfile(false); }}
        onAddSpace={() => setShowAddSpace(true)}
        onAddProjectToSpace={(spaceId) => { setAddProjectSpaceId(spaceId); setShowAddProject(true); }}
        onShareSpace={(spaceId) => setShowSpaceCollab({ open: true, spaceId })}
        onLogout={handleLogout}
        currentUser={currentUser}
        onOpenProfile={() => setShowProfile(true)}
        onReorder={loadData}
        onOpenSearch={() => setIsCommandPaletteOpen(true)}
        onOpenNotifications={() => setShowNotifications(true)}
        unreadNotifications={unreadCount}
        collapsed={sidebarCollapsed}
      />

      <main className={`main ${sidebarCollapsed ? 'expanded' : ''}`}>
        {showProfile && (
          <ProfileView
            onBack={() => setShowProfile(false)}
            currentUser={currentUser}
            onUserUpdate={(updates) => setCurrentUser(prev => ({ ...prev, ...updates }))}
            onLogout={handleLogout}
            onOpenAdmin={() => { window.history.pushState({}, '', '/admin'); setShowProfile(false); }}
          />
        )}
        {!showProfile && activeView === 'dashboard' && (
          <DashboardView
            spaces={appData.spaces}
            projects={appData.projects}
            sharedProjects={sharedProjects}
            sharedSpaces={sharedSpaces}
            onOpenProject={(pid) => { setCurrentProjectId(pid); setCurrentSharedProjectId(null); }}
            onOpenSharedProject={(pid) => { setCurrentSharedProjectId(pid); setCurrentProjectId(null); }}
            onOpenSpace={(sid) => { setCurrentSpaceId(sid); setCurrentProjectId(null); setCurrentSharedProjectId(null); setCurrentSharedSpaceId(null); }}
            onOpenSharedSpace={(sid) => { setCurrentSharedSpaceId(sid); setCurrentSpaceId(null); setCurrentProjectId(null); setCurrentSharedProjectId(null); }}
            onReorder={loadData}
            onOpenSearch={() => setIsCommandPaletteOpen(true)}
            onOpenNotifications={() => setShowNotifications(true)}
            onOpenFeedback={() => setShowFeedback(true)}
            unreadNotifications={unreadCount}
          />
        )}
        {!showProfile && activeView === 'space' && currentSpace && (
          <SpaceView
            space={currentSpace}
            projects={(appData.projects || []).filter(p => p.spaceId === currentSpaceId)}
            onOpenProject={(pid) => { setCurrentProjectId(pid); setCurrentSharedProjectId(null); }}
            onReorder={loadData}
            onAddProject={() => { setAddProjectSpaceId(currentSpaceId); setShowAddProject(true); }}
            onOpenCollab={() => setShowSpaceCollab({ open: true, spaceId: currentSpaceId })}
            onEditSpace={() => setShowEditSpace(currentSpace)}
            onOpenSearch={() => setIsCommandPaletteOpen(true)}
            onOpenNotifications={() => setShowNotifications(true)}
            onOpenFeedback={() => setShowFeedback(true)}
            unreadNotifications={unreadCount}
          />
        )}
        {!showProfile && activeView === 'shared-space' && currentSharedSpace && (
          <SpaceView
            space={currentSharedSpace}
            projects={(currentSharedSpace.projects || []).filter(p => !p.archived)}
            onOpenProject={(pid) => { setCurrentProjectId(pid); setCurrentSharedProjectId(null); setCurrentSharedSpaceId(null); }}
            onReorder={loadData}
            onAddProject={() => { setAddProjectSpaceId(currentSharedSpace.id); setShowAddProject(true); }}
            canAddProject={currentSharedSpace.myRole === 'editor'}
            onOpenCollab={() => {}}
            onEditSpace={() => {}}
            onOpenSearch={() => setIsCommandPaletteOpen(true)}
            onOpenNotifications={() => setShowNotifications(true)}
            onOpenFeedback={() => setShowFeedback(true)}
            unreadNotifications={unreadCount}
          />
        )}
        {!showProfile && activeView === 'project' && currentProject && (
          <AnimatePresence mode="wait">
            <motion.div
              key={currentProjectId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeInOut' }}
              style={{ height: '100%' }}
            >
              <ProjectDetailView
                project={currentProject}
                spaceCollaborators={currentProject.spaceId ? ((appData.spaces || []).find(s => s.id === currentProject.spaceId)?.collaborators || []) : []}
                onBack={() => {
                  const spaceId = currentProject?.spaceId;
                  setCurrentProjectId(null);
                  if (spaceId) {
                    const parentSharedSpace = sharedSpaces.find(s => s.id === spaceId);
                    if (parentSharedSpace) { setCurrentSharedSpaceId(parentSharedSpace.id); return; }
                  }
                }}
                onUpdate={loadData}
                onToast={toast}
                highlightedTaskId={highlightedTaskId}
                onOpenWordpad={(type, taskId, initialContent) => setShowWordpad({ open: true, type, taskId, initialContent })}
                onOpenCollab={() => setShowCollab({ open: true, projectId: currentProject.id })}
                onOpenLightbox={(url) => setLightboxUrl(url)}
                onOpenSearch={() => setIsCommandPaletteOpen(true)}
                onOpenNotifications={() => setShowNotifications(true)}
                onOpenFeedback={() => setShowFeedback(true)}
                unreadNotifications={unreadCount}
                currentUser={currentUser}
              />
            </motion.div>
          </AnimatePresence>
        )}
        {!showProfile && activeView === 'shared' && currentSharedProject && (
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSharedProjectId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeInOut' }}
              style={{ height: '100%' }}
            >
              <ProjectDetailView
                project={currentSharedProject}
                spaceCollaborators={currentSharedProject.spaceId ? (sharedSpaces.find(s => s.id === currentSharedProject.spaceId)?.collaborators || []) : []}
                isSharedView={true}
                sharedBy={currentSharedProject.sharedBy}
                currentUserRole={currentSharedProject.myRole || 'viewer'}
                onBack={() => setCurrentSharedProjectId(null)}
                onUpdate={loadData}
                onToast={toast}
                highlightedTaskId={highlightedTaskId}
                onOpenWordpad={() => {}}
                onOpenCollab={() => {}}
                onOpenLightbox={(url) => setLightboxUrl(url)}
                onOpenSearch={() => setIsCommandPaletteOpen(true)}
                onOpenNotifications={() => setShowNotifications(true)}
                onOpenFeedback={() => setShowFeedback(true)}
                unreadNotifications={unreadCount}
                currentUser={currentUser}
              />
            </motion.div>
          </AnimatePresence>
        )}
        {!showProfile && (activeView === 'dashboard' || activeView === 'space' || activeView === 'shared-space') && <QuoteBar />}
      </main>

      <Toast toast={toastData} onClear={() => setToastData(null)} />
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl('')} />}

      {showAddProject && (
        <ProjectModal
          spaceId={addProjectSpaceId}
          onClose={() => setShowAddProject(false)}
          onSuccess={(id) => { loadData(); setCurrentProjectId(id); setCurrentSharedSpaceId(null); setCurrentSharedProjectId(null); setShowAddProject(false); toast('Project created!'); }}
        />
      )}
      {showAddSpace && (
        <SpaceModal
          onClose={() => setShowAddSpace(false)}
          onSuccess={(id) => { loadData(); if (id) setCurrentSpaceId(id); setShowAddSpace(false); toast('Space created!'); }}
        />
      )}
      {showEditSpace && (
        <SpaceModal
          space={showEditSpace}
          onClose={() => setShowEditSpace(null)}
          onSuccess={() => { loadData(); setShowEditSpace(null); toast('Space updated!'); }}
        />
      )}

      {showWordpad.open && currentProject && (
        <React.Suspense fallback={null}>
          <WordpadModal
            project={currentProject}
            taskId={showWordpad.taskId}
            type={showWordpad.type}
            initialContent={showWordpad.initialContent}
            onClose={() => setShowWordpad({ open: false, type: '', taskId: '', initialContent: '' })}
            onSave={loadData}
            onToast={toast}
          />
        </React.Suspense>
      )}

      {showCollab.open && (() => {
        const collabProject = (appData.projects || []).find(p => p.id === showCollab.projectId) || sharedProjects.find(p => p.id === showCollab.projectId);
        const collabSpace = collabProject?.spaceId
          ? (appData.spaces || []).find(s => s.id === collabProject.spaceId) || sharedSpaces.find(s => s.id === collabProject.spaceId)
          : null;
        return (
          <CollabModal
            projectId={showCollab.projectId}
            project={collabProject}
            spaceCollaborators={collabSpace?.collaborators || []}
            onClose={() => setShowCollab({ open: false, projectId: '' })}
            onUpdate={loadData}
            onUpdateRole={updateProjectCollabRole}
            onToast={toast}
            currentUser={currentUser}
          />
        );
      })()}

      {showSpaceCollab.open && (
        <SpaceCollabModal
          spaceId={showSpaceCollab.spaceId}
          space={(appData.spaces || []).find(s => s.id === showSpaceCollab.spaceId)}
          onClose={() => setShowSpaceCollab({ open: false, spaceId: '' })}
          onUpdate={loadData}
          onUpdateRole={updateSpaceCollabRole}
          onToast={toast}
          currentUser={currentUser}
        />
      )}

      <NotificationModal
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
        notifications={notifications}
        onRefresh={() => { loadNotifications(); loadData(); }}
        onNavigate={handleNotifNavigate}
      />

      <React.Suspense fallback={null}>
        <FeedbackPanel
          isOpen={showFeedback}
          onClose={() => setShowFeedback(false)}
        />
      </React.Suspense>

      <CommandPalette 
        projects={appData.projects} 
        isOpen={isCommandPaletteOpen}
        setIsOpen={setIsCommandPaletteOpen}
        onSelectProject={(pid, tid) => {
          setCurrentProjectId(pid);
          if (tid) {
            setHighlightedTaskId(tid);
            setTimeout(() => setHighlightedTaskId(null), 2500);
          }
        }} 
      />
    </div>
  );
}
