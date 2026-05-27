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
import InviteLandingView from './views/InviteLandingView';
import { requestNotificationPermission, scheduleDeadlineReminders, stopDeadlineReminders } from './utils/notifications';

// TODO: Replace with real API → GET /api/shared-projects (returns projects shared with the logged-in user)
const MOCK_SHARED_SPACES = [
  {
    id: 'shared-space-1',
    title: 'Product Team',
    color: '#f59e0b',
    description: 'Q3 product roadmap and execution',
    sharedBy: 'Arjun Kapoor',
    myRole: 'editor',
    collaborators: [
      { id: 'sc1', name: 'Arjun Kapoor', role: 'editor' },
      { id: 'sc2', name: 'Neha Singh', role: 'viewer' },
    ],
    projects: [
      { id: 'msp1', spaceId: 'shared-space-1', title: 'Mobile App v2', archived: false, tasks: [{ done: true }, { done: true }, { done: false }, { done: false }, { done: false }] },
      { id: 'msp2', spaceId: 'shared-space-1', title: 'Backend API', archived: false, tasks: [{ done: true }, { done: true }, { done: true }, { done: false }] },
    ],
  },
];

const MOCK_SHARED_PROJECTS = [
  {
    id: 'shared-demo-1',
    title: 'Design Sprint Q3',
    subtitle: 'UI overhaul planning',
    color: '#6366f1',
    sharedBy: 'Priya Sharma',
    myRole: 'editor',
    tasks: [
      { id: 't1', text: 'Review Figma prototype', done: true, priority: 'urgent', createdAt: new Date().toISOString() },
      { id: 't2', text: 'Finalise component library', done: false, priority: 'important', assignee: 'me', createdAt: new Date().toISOString() },
      { id: 't3', text: 'User testing round 2', done: false, priority: 'later', createdAt: new Date().toISOString() },
    ],
    collaborators: [
      { id: 'c1', name: 'Priya Sharma', role: 'editor' },
    ],
    files: [], tag: 'Design', notes: '', richNotes: '',
  },
];

export default function App() {
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [appData, setAppData] = useState({ spaces: [], projects: [] });
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [currentSpaceId, setCurrentSpaceId] = useState(null);
  const [sharedProjects, setSharedProjects] = useState(MOCK_SHARED_PROJECTS);
  const [sharedSpaces] = useState(MOCK_SHARED_SPACES);
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
  const [inviteToken, setInviteToken] = useState(null);
  
  // Mock notifications for demonstration
  const [notifications, setNotifications] = useState([
    { id: 'n1', actor: 'Priya Sharma', action: 'assigned you to', target: 'Finalise component library', time: '10m ago', icon: '👤', read: false },
    { id: 'n2', actor: 'Rahul Mehta', action: 'completed', target: 'Review Figma prototype', time: '1h ago', icon: '✅', read: false },
    { id: 'n3', actor: 'Priya Sharma', action: 'invited you to', target: 'Design Sprint Q3', time: '2h ago', icon: '📩', read: true }
  ]);
  const unreadCount = notifications.filter(n => !n.read).length;

  const appDataRef = useRef({ projects: [] });

  const loadData = useCallback(async () => {
    const data = await api('get', null, 'GET');
    appDataRef.current = data;
    setAppData(data);
    setLoading(false);
    // Schedule deadline reminders using live data ref
    scheduleDeadlineReminders(() => appDataRef.current.projects || []);
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const r = await api('check', null, 'GET');
      if (r.loggedIn) {
        setLoggedIn(true);
        setCurrentUser(r.user);
        loadData();
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, [loadData]);

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
      requestNotificationPermission();
    }} />;
  }

  const currentProject = appData.projects.find(p => p.id === currentProjectId);
  const currentSharedProject = MOCK_SHARED_PROJECTS.find(p => p.id === currentSharedProjectId);
  const currentSharedSpace = MOCK_SHARED_SPACES.find(s => s.id === currentSharedSpaceId);
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
        onSelect={(pid) => { setCurrentProjectId(pid); setCurrentSharedProjectId(null); setCurrentSharedSpaceId(null); setSidebarOpen(false); }}
        onSelectSpace={(sid) => { setCurrentSpaceId(sid); setCurrentProjectId(null); setCurrentSharedProjectId(null); setCurrentSharedSpaceId(null); setSidebarOpen(false); }}
        onSelectShared={(pid) => { setCurrentSharedProjectId(pid); setCurrentProjectId(null); setCurrentSpaceId(null); setCurrentSharedSpaceId(null); setSidebarOpen(false); }}
        onSelectSharedSpace={(sid) => { setCurrentSharedSpaceId(sid); setCurrentProjectId(null); setCurrentSpaceId(null); setCurrentSharedProjectId(null); setSidebarOpen(false); }}
        onAddSpace={() => setShowAddSpace(true)}
        onAddProjectToSpace={(spaceId) => { setAddProjectSpaceId(spaceId); setShowAddProject(true); }}
        onShareSpace={(spaceId) => setShowSpaceCollab({ open: true, spaceId })}
        onLogout={handleLogout}
        onReorder={loadData}
        onOpenSearch={() => setIsCommandPaletteOpen(true)}
        onOpenNotifications={() => setShowNotifications(true)}
        unreadNotifications={unreadCount}
        collapsed={sidebarCollapsed}
      />

      <main className={`main ${sidebarCollapsed ? 'expanded' : ''}`}>
        {activeView === 'dashboard' && (
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
            unreadNotifications={unreadCount}
          />
        )}
        {activeView === 'space' && currentSpace && (
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
            unreadNotifications={unreadCount}
          />
        )}
        {activeView === 'shared-space' && currentSharedSpace && (
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
            unreadNotifications={unreadCount}
          />
        )}
        {activeView === 'project' && currentProject && (
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
                unreadNotifications={unreadCount}
              />
            </motion.div>
          </AnimatePresence>
        )}
        {activeView === 'shared' && currentSharedProject && (
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
                onUpdate={() => setAppData(prev => ({...prev}))} // Force re-render for mock local updates
                onToast={toast}
                onOpenWordpad={() => {}}
                onOpenCollab={() => {}}
                onOpenLightbox={(url) => setLightboxUrl(url)}
                onOpenSearch={() => setIsCommandPaletteOpen(true)}
                onOpenNotifications={() => setShowNotifications(true)}
                unreadNotifications={unreadCount}
              />
            </motion.div>
          </AnimatePresence>
        )}
        {(activeView === 'dashboard' || activeView === 'space' || activeView === 'shared-space') && <QuoteBar />}
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
          project={appData.projects.find(p => p.id === showCollab.projectId) || sharedProjects.find(p => p.id === showCollab.projectId)}
          onClose={() => setShowCollab({ open: false, projectId: '' })}
          onUpdate={loadData}
          onUpdateRole={updateProjectCollabRole}
          onToast={toast}
        />
      )}

      {showSpaceCollab.open && (
        <SpaceCollabModal
          spaceId={showSpaceCollab.spaceId}
          space={appData.spaces.find(s => s.id === showSpaceCollab.spaceId)}
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
        onMarkAsRead={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}
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
