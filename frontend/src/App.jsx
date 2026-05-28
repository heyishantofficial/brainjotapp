import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
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
import WordpadModal from './components/WordpadModal';
import CollabModal from './components/CollabModal';
import SpaceCollabModal from './components/SpaceCollabModal';
import NotificationModal from './components/NotificationModal';
import FeedbackPanel from './components/FeedbackPanel';
import InviteLandingView from './views/InviteLandingView';
import AdminView from './views/AdminView';
import ProfileView from './views/ProfileView';
import { requestNotificationPermission, scheduleDeadlineReminders, stopDeadlineReminders } from './utils/notifications';


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

  const loadNotifications = useCallback(async () => {
    try {
      const r = await api('get_notifications', null, 'GET');
      if (r?.notifications) setNotifications(r.notifications);
    } catch { /* ignore */ }
  }, []);

  // Poll notifications every 20 s while logged in
  useEffect(() => {
    if (!loggedIn) return;
    const id = setInterval(loadNotifications, 20000);
    return () => clearInterval(id);
  }, [loggedIn, loadNotifications]);

  const appDataRef = useRef({ projects: [] });

  const loadData = useCallback(async () => {
    try {
      const data = await api('get', null, 'GET');
      if (data?.spaces && data?.projects) {
        appDataRef.current = data;
        setAppData(data);
        if (Array.isArray(data.sharedProjects)) setSharedProjects(data.sharedProjects);
        if (Array.isArray(data.sharedSpaces)) setSharedSpaces(data.sharedSpaces);
        scheduleDeadlineReminders(() => appDataRef.current.projects || []);
      }
    } catch {
      // keep existing appData on failure
    } finally {
      setLoading(false);
    }
  }, []);

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
    // Theme setup from localStorage
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('theme-light');
    }
    
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInviteToken(token);
    }
    
    checkAuth();
  }, [checkAuth]);

  const handleAcceptInvite = () => {
    // In a real app, send api('accept_invite', { token: inviteToken }) here
    setInviteToken(null);
    // Remove query param without reloading
    window.history.replaceState({}, document.title, window.location.pathname);
    // Simulate accepting the invite by selecting the shared project
    setCurrentSharedProjectId('shared-demo-1');
  };


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

  if (loading) return null;

  if (inviteToken) {
    return <InviteLandingView inviteToken={inviteToken} onAccept={handleAcceptInvite} />;
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

  // Admin route gate — navigating to /admin shows the panel only for superadmins
  if (window.location.pathname === '/admin') {
    if (currentUser?.role === 'superadmin') {
      return <AdminView currentUser={currentUser} onLogout={handleLogout} />;
    }
    // Not an admin — silently redirect to home
    window.history.replaceState({}, '', '/');
  }

  const currentProject = (appData.projects || []).find(p => p.id === currentProjectId);
  const currentSharedProject = sharedProjects.find(p => p.id === currentSharedProjectId);
  const currentSharedSpace = sharedSpaces.find(s => s.id === currentSharedSpaceId);
  const currentSpace = appData.spaces?.find(s => s.id === currentSpaceId);
  const activeView = currentSharedProject ? 'shared' : currentSharedSpace ? 'shared-space' : currentProjectId ? 'project' : currentSpaceId && currentSpace ? 'space' : 'dashboard';

  return (
    <div id="app" style={{ display: 'block' }}>
      <button className={`hamburger ${sidebarOpen ? 'hidden' : ''}`} onClick={() => setSidebarOpen(!sidebarOpen)}>
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
            projects={[]}
            onOpenProject={() => {}}
            onReorder={() => {}}
            onAddProject={() => {}}
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
                onBack={() => setCurrentProjectId(null)}
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
                isSharedView={true}
                sharedBy={currentSharedProject.sharedBy}
                currentUserRole={currentSharedProject.myRole || 'viewer'}
                onBack={() => setCurrentSharedProjectId(null)}
                onUpdate={loadData}
                onToast={toast}
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
          onSuccess={(id) => { loadData(); setCurrentProjectId(id); setShowAddProject(false); toast('Project created!'); }}
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
        <WordpadModal
          project={currentProject}
          taskId={showWordpad.taskId}
          type={showWordpad.type}
          initialContent={showWordpad.initialContent}
          onClose={() => setShowWordpad({ open: false, type: '', taskId: '', initialContent: '' })}
          onSave={loadData}
          onToast={toast}
        />
      )}

      {showCollab.open && (
        <CollabModal
          projectId={showCollab.projectId}
          project={(appData.projects || []).find(p => p.id === showCollab.projectId) || sharedProjects.find(p => p.id === showCollab.projectId)}
          onClose={() => setShowCollab({ open: false, projectId: '' })}
          onUpdate={loadData}
          onUpdateRole={updateProjectCollabRole}
          onToast={toast}
        />
      )}

      {showSpaceCollab.open && (
        <SpaceCollabModal
          spaceId={showSpaceCollab.spaceId}
          space={(appData.spaces || []).find(s => s.id === showSpaceCollab.spaceId)}
          onClose={() => setShowSpaceCollab({ open: false, spaceId: '' })}
          onUpdate={loadData}
          onUpdateRole={updateSpaceCollabRole}
          onToast={toast}
        />
      )}

      <NotificationModal
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
        notifications={notifications}
        onRefresh={() => { loadNotifications(); loadData(); }}
        onNavigate={handleNotifNavigate}
      />

      <FeedbackPanel
        isOpen={showFeedback}
        onClose={() => setShowFeedback(false)}
      />

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
