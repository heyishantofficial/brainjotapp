import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io as socketIO } from 'socket.io-client';
import { AnimatePresence, motion } from 'framer-motion';
import { API_ORIGIN, api, apiCommit, hasPendingMutations, onMutationsSettled } from './api';
import { identifyUser, resetAnalytics, track } from './analytics';
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
import { scheduleDeadlineReminders, stopDeadlineReminders } from './utils/notifications';
import { enablePush, syncPushIfGranted, disablePushForLogout } from './utils/push';
import CallRoom from './components/CallRoom';
import GlobalCallNotification from './components/GlobalCallNotification';
import CallBanner from './components/CallBanner';
import DialogModal from './components/DialogModal';
import FadeOut from './components/FadeOut';

// Lazy-loaded: heavy or rarely-used chunks loaded on demand
const AdminView        = React.lazy(() => import('./views/AdminView'));
const InviteLandingView = React.lazy(() => import('./views/InviteLandingView'));
const WordpadModal     = React.lazy(() => import('./components/WordpadModal'));
const FeedbackPanel    = React.lazy(() => import('./components/FeedbackPanel'));
const PrivacyPolicyPage = React.lazy(() => import('./components/PrivacyPolicyPage'));
const TermsPage         = React.lazy(() => import('./components/TermsPage'));

const configuredGoogleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim() || null;

const Spinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#000' }}>
    <div style={{ width: 32, height: 32, border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#D4FF32', borderRadius: '50%', animation: 'bj-spin 0.7s linear infinite' }} />
  </div>
);


let activeAudioCtx = null;
let activeOscillators = [];

function playSingleRing() {
  if (localStorage.getItem('soundEnabled') === 'false') return;
  try {
    if (activeAudioCtx && activeAudioCtx.state !== 'closed') {
      try { activeAudioCtx.close(); } catch {}
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    activeAudioCtx = ctx;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.frequency.value = 440;
    osc2.frequency.value = 480;

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 18;
    lfoGain.gain.value = 12;

    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);
    lfoGain.connect(osc2.frequency);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.08);
    gainNode.gain.setValueAtTime(0.12, ctx.currentTime + 1.6);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);

    lfo.start();
    osc1.start();
    osc2.start();

    activeOscillators = [osc1, osc2, lfo];

    lfo.stop(ctx.currentTime + 1.8);
    osc1.stop(ctx.currentTime + 1.8);
    osc2.stop(ctx.currentTime + 1.8);

    setTimeout(() => {
      try {
        if (activeAudioCtx === ctx) {
          ctx.close();
          activeAudioCtx = null;
          activeOscillators = [];
        }
      } catch {}
    }, 2000);
  } catch (e) {
    /* ignore */
  }
}

function forceStopRinging() {
  if (activeAudioCtx) {
    try {
      activeOscillators.forEach(osc => {
        try { osc.stop(); } catch {}
      });
      activeAudioCtx.close();
    } catch {}
    activeAudioCtx = null;
    activeOscillators = [];
  }
}

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

  // ── Login redirect (preserve user intent) ─────────────────────────
  // The community app sends logged-out users here as /login?redirect=<their page>.
  // Once the user is logged in, bounce them straight back instead of dumping
  // them on the dashboard. Strict allowlist: only https brainjot.space
  // destinations (plus localhost in dev) — never an arbitrary URL, so the
  // param can't be abused as an open redirect for phishing.
  useEffect(() => {
    if (!loggedIn || window.location.pathname !== '/login') return;
    const target = new URLSearchParams(window.location.search).get('redirect');
    if (target) {
      try {
        const url = new URL(target);
        const sameSite = url.protocol === 'https:' &&
          (url.hostname === 'brainjot.space' || url.hostname.endsWith('.brainjot.space'));
        const devLocal = url.protocol === 'http:' &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
        if (sameSite || devLocal) {
          window.location.replace(url.href);
          return;
        }
      } catch { /* not a valid URL — fall through */ }
    }
    // No (or unsafe) redirect: clean the /login path off the URL.
    window.history.replaceState({}, '', '/');
  }, [loggedIn]);

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
  // Leave-shared confirm: { kind: 'project'|'space', item } — opened from the
  // right-click context menus on shared items (Sidebar + Dashboard)
  const [leaveConfirm, setLeaveConfirm] = useState({ open: false, kind: '', item: null });
  const [showProfile, setShowProfile] = useState(false);
  const [inviteToken, setInviteToken] = useState(null);
  const [googleClientId, setGoogleClientId] = useState(configuredGoogleClientId);
  const [staticPage, setStaticPage] = useState(() => {
    const p = window.location.pathname;
    if (p === '/privacy') return 'privacy';
    if (p === '/terms') return 'terms';
    return null;
  });
  
  // ── Call feature state ────────────────────────────────────────────
  const [livekitEnabled, setLivekitEnabled] = useState(false);
  const [myActiveCall, setMyActiveCall] = useState(null);
  // activeCalls: calls in progress (started by others) { callId → { hostUserId, hostName, callType, entityType } }
  const [activeCalls, setActiveCalls] = useState(new Map());
  // invitedCalls: callIds where the host personally invited me (skip request-to-join flow)
  const [invitedCalls, setInvitedCalls] = useState(new Set());
  const [pendingJoinRequests, setPendingJoinRequests] = useState([]);
  const [dismissedCalls, setDismissedCalls] = useState(new Set());
  const [callRequestSent, setCallRequestSent] = useState(new Set());

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

  // ── Optimistic UI infrastructure ──────────────────────────────────
  // dataLoaded: false until the first get completes — drives skeleton loaders.
  const [dataLoaded, setDataLoaded] = useState(false);
  // Bumped on every optimistic local patch; a refetch that started before the
  // bump is stale and must be discarded instead of overwriting the patch.
  const patchEpochRef = useRef(0);
  // Deferred deletes ("Undo" window): entityId → { timer, commitAction, commitBody }.
  // The server is NOT called until the window expires, so Undo loses nothing.
  const pendingDeletesRef = useRef(new Map());
  const wantsReloadRef = useRef(false);

  // Strip entities whose deletion is pending (inside the undo window) from
  // freshly fetched server data — the server still has them until commit.
  const filterPendingDeletes = useCallback((data) => {
    const pending = pendingDeletesRef.current;
    if (pending.size === 0) return data;
    const gone = (id) => pending.has(id);
    const stripTasks = (p) => {
      const tasks = (p.tasks || []).filter(t => !gone(t.id));
      return tasks.length === (p.tasks || []).length ? p : { ...p, tasks };
    };
    return {
      ...data,
      spaces: (data.spaces || []).filter(s => !gone(s.id)),
      projects: (data.projects || []).filter(p => !gone(p.id) && !gone(p.spaceId)).map(stripTasks),
      sharedProjects: (data.sharedProjects || []).map(stripTasks),
      sharedSpaces: (data.sharedSpaces || []).map(s =>
        s.projects ? { ...s, projects: s.projects.map(stripTasks) } : s
      ),
    };
  }, []);

  const loadData = useCallback(async () => {
    // Writes in flight → refetching now would clobber optimistic state with
    // stale data. Defer; the onMutationsSettled listener re-runs us.
    if (hasPendingMutations()) { wantsReloadRef.current = true; return; }
    const epoch = patchEpochRef.current;
    try {
      const data = await api('get', null, 'GET');
      pollFailuresRef.current = 0; // reset on success
      // A local patch happened while this fetch was in the air — its result
      // no longer reflects what the user sees. Discard and refetch.
      if (epoch !== patchEpochRef.current) {
        if (hasPendingMutations()) wantsReloadRef.current = true;
        else setTimeout(() => loadDataRef.current(), 0);
        return;
      }
      if (data?.spaces && data?.projects) {
        const filtered = filterPendingDeletes(data);
        appDataRef.current = filtered;
        setAppData({ spaces: filtered.spaces, projects: filtered.projects });
        if (Array.isArray(data.sharedProjects)) setSharedProjects(filtered.sharedProjects);
        if (Array.isArray(data.sharedSpaces)) setSharedSpaces(filtered.sharedSpaces);
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
      setDataLoaded(true);
    }
  }, [filterPendingDeletes]);

  const loadDataRef = useRef(loadData);
  useEffect(() => { loadDataRef.current = loadData; }, [loadData]);

  // When the last in-flight write settles, run any refetch that was deferred.
  useEffect(() => onMutationsSettled(() => {
    if (wantsReloadRef.current) {
      wantsReloadRef.current = false;
      loadDataRef.current();
    }
  }), []);

  // Apply an optimistic change to one project's tasks everywhere that project
  // can appear (own projects, shared projects, projects nested in shared spaces).
  const patchProjectTasks = useCallback((projectId, patcher) => {
    patchEpochRef.current++;
    const apply = (list) => (list || []).map(p =>
      p.id === projectId ? { ...p, tasks: patcher(p.tasks || []) } : p
    );
    setAppData(prev => {
      const next = { ...prev, projects: apply(prev.projects) };
      appDataRef.current = { ...appDataRef.current, projects: next.projects };
      return next;
    });
    setSharedProjects(prev => apply(prev));
    setSharedSpaces(prev => (prev || []).map(s =>
      s.projects ? { ...s, projects: apply(s.projects) } : s
    ));
  }, []);

  // Instant checkbox everywhere: flip locally, sync in the background.
  const toggleTaskOptimistic = useCallback((projectId, taskId) => {
    patchProjectTasks(projectId, tasks => tasks.map(t => {
      if (t.id !== taskId) return t;
      const nowDone = !t.done;
      return { ...t, done: nowDone, finishedAt: nowDone ? new Date().toISOString() : null };
    }));
    api('task_toggle', { projectId, taskId })
      .catch(() => {})
      .finally(() => loadDataRef.current());
  }, [patchProjectTasks]);

  const UNDO_WINDOW_MS = 10000;

  // Deferred delete: remove from the UI now, call the server only after the
  // undo window closes. Undo simply cancels the timer — nothing was lost.
  const scheduleDelete = useCallback(({ entityId, message, commitAction, commitBody, onOptimistic, onUndo }) => {
    if (pendingDeletesRef.current.has(entityId)) return;
    patchEpochRef.current++;
    pendingDeletesRef.current.set(entityId, { timer: null, commitAction, commitBody });
    // Optimistically strip the entity from all current state
    setAppData(prev => {
      const f = filterPendingDeletes({ ...prev, sharedProjects: [], sharedSpaces: [] });
      const next = { spaces: f.spaces, projects: f.projects };
      appDataRef.current = { ...appDataRef.current, ...next };
      return next;
    });
    setSharedProjects(prev => filterPendingDeletes({ spaces: [], projects: [], sharedProjects: prev }).sharedProjects);
    setSharedSpaces(prev => filterPendingDeletes({ spaces: [], projects: [], sharedSpaces: prev }).sharedSpaces);
    onOptimistic?.();
    const timer = setTimeout(async () => {
      pendingDeletesRef.current.delete(entityId);
      try { await api(commitAction, commitBody); } catch { /* refetch below restores it if the delete failed */ }
      loadDataRef.current();
    }, UNDO_WINDOW_MS);
    pendingDeletesRef.current.get(entityId).timer = timer;
    setToastData({
      message,
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const entry = pendingDeletesRef.current.get(entityId);
          if (!entry) return;
          clearTimeout(entry.timer);
          pendingDeletesRef.current.delete(entityId);
          onUndo?.();
          loadDataRef.current(); // server never deleted it — refetch restores it fully
        },
      },
    });
  }, [filterPendingDeletes]);

  // If the tab closes mid-undo-window, commit pending deletes with keepalive
  // requests so "deleted" items don't silently come back next session.
  useEffect(() => {
    const commitAll = () => {
      pendingDeletesRef.current.forEach(({ timer, commitAction, commitBody }) => {
        clearTimeout(timer);
        apiCommit(commitAction, commitBody);
      });
      pendingDeletesRef.current.clear();
    };
    window.addEventListener('pagehide', commitAll);
    return () => window.removeEventListener('pagehide', commitAll);
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
    const socket = socketIO(API_ORIGIN || undefined, { withCredentials: true, transports: ['polling', 'websocket'] });
    socketRef.current = socket;
    socket.on('connect', () => {
      if (currentRoomRef.current) socket.emit('join_room', currentRoomRef.current);
    });
    let debounce;
    socket.on('project_updated', () => {
      clearTimeout(debounce);
      debounce = setTimeout(loadData, 500);
    });

    // Instant notification delivery — refetch right away instead of waiting
    // for the 20s poll. The unreadCount effect plays the chime.
    socket.on('notification:new', () => loadNotifications());

    // ── Call signal events ────────────────────────────────────────
    socket.on('call:started', ({ callId, hostUserId, hostName, callType }) => {
      if (hostUserId === currentUser?.id) return;
      setActiveCalls(prev => new Map(prev).set(callId, { hostUserId, hostName, callType }));
      setDismissedCalls(prev => { const s = new Set(prev); s.delete(callId); return s; });
      setCallRequestSent(prev => { const s = new Set(prev); s.delete(callId); return s; });
    });

    socket.on('call:ended', ({ callId }) => {
      setActiveCalls(prev => { const m = new Map(prev); m.delete(callId); return m; });
      setInvitedCalls(prev => { const s = new Set(prev); s.delete(callId); return s; });
      setDismissedCalls(prev => { const s = new Set(prev); s.delete(callId); return s; });
      setCallRequestSent(prev => { const s = new Set(prev); s.delete(callId); return s; });
      setMyActiveCall(prev => (prev?.callId === callId ? null : prev));
    });

    socket.on('call:join_requested', ({ callId, requesterId, requesterName }) => {
      setPendingJoinRequests(prev => {
        if (prev.some(r => r.requesterId === requesterId && r.callId === callId)) return prev;
        return [...prev, { callId, requesterId, requesterName }];
      });
    });

    socket.on('call:join_accepted', ({ callId, token, roomName, livekitUrl, callType }) => {
      setActiveCalls(prev => { const m = new Map(prev); m.delete(callId); return m; });
      setMyActiveCall({ callId, token, roomName, livekitUrl, callType, isHost: false });
    });

    socket.on('call:join_rejected', ({ callId }) => {
      setCallRequestSent(prev => { const s = new Set(prev); s.delete(callId); return s; });
      toast('Your request to join was declined.');
    });

    socket.on('call:invited', ({ callId, hostName, callType, entityType }) => {
      // Host personally invited me — track separately so banner shows "Join Now" not "Request to Join"
      setInvitedCalls(prev => new Set([...prev, callId]));
      setActiveCalls(prev => new Map(prev).set(callId, { hostUserId: null, hostName, callType, entityType: entityType || 'project' }));
      setDismissedCalls(prev => { const s = new Set(prev); s.delete(callId); return s; });
    });

    return () => { clearTimeout(debounce); socket.disconnect(); socketRef.current = null; };
  }, [loggedIn, loadData, loadNotifications]);

  // Loop a phone ring sound when there are active incoming calls
  const ringIntervalRef = useRef(null);
  const startRinging = useCallback(() => {
    if (ringIntervalRef.current) return;
    playSingleRing();
    ringIntervalRef.current = setInterval(playSingleRing, 4000);
  }, []);

  const stopRinging = useCallback(() => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    forceStopRinging();
  }, []);

  useEffect(() => {
    if (!loggedIn || myActiveCall) {
      stopRinging();
      return;
    }
    const incoming = Array.from(activeCalls.entries()).some(([callId, call]) => 
      call.hostUserId !== currentUser?.id && !dismissedCalls.has(callId)
    );
    if (incoming) {
      startRinging();
    } else {
      stopRinging();
    }
    return () => stopRinging();
  }, [activeCalls, dismissedCalls, myActiveCall, loggedIn, currentUser, startRinging, stopRinging]);

  // Join/leave the appropriate socket room when active view changes
  const activeProjectId = currentProjectId || currentSharedProjectId;
  const activeSpaceId = currentSpaceId || currentSharedSpaceId;
  useEffect(() => {
    const newRoom = activeProjectId
      ? `project:${activeProjectId}`
      : activeSpaceId
        ? `space:${activeSpaceId}`
        : null;
    const prevRoom = currentRoomRef.current;
    if (prevRoom !== newRoom) {
      if (prevRoom) socketRef.current?.emit('leave_room', prevRoom);
      if (newRoom) socketRef.current?.emit('join_room', newRoom);
      currentRoomRef.current = newRoom;
    }
  }, [activeProjectId, activeSpaceId]);

  const checkAuth = useCallback(async () => {
    try {
      const r = await api('check', null, 'GET');
      if (r.googleClientId) {
        setGoogleClientId(r.googleClientId);
      }
      if (r.loggedIn) {
        setLoggedIn(true);
        setCurrentUser(r.user);
        identifyUser(r.user);
        setLivekitEnabled(r.features?.livekit === true);
        loadData();
        loadNotifications();
        syncPushIfGranted(); // silent — re-attaches this browser's push subscription, never prompts
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
    // Commit any deletes still inside their undo window before the session ends
    pendingDeletesRef.current.forEach(({ timer, commitAction, commitBody }) => {
      clearTimeout(timer);
      apiCommit(commitAction, commitBody);
    });
    pendingDeletesRef.current.clear();
    track('logged_out');
    resetAnalytics();
    // Detach this browser's push subscription while the session cookie is still valid
    await disablePushForLogout();
    await api('logout');
    // Clear all SW caches so stale authenticated data isn't served to the next user on this browser
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
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

  // ── Call helpers ──────────────────────────────────────────────────
  const startCall = useCallback(async (callId, callType, entityType = 'project', asHost = true) => {
    try {
      const param = entityType === 'space' ? `&spaceId=${callId}` : `&projectId=${callId}`;
      const r = await api('get_call_token', null, 'GET', `${param}&callType=${callType}`);
      if (r.error) { toast(r.error); return; }
      setMyActiveCall({ callId, token: r.token, roomName: r.roomName, livekitUrl: r.livekitUrl, callType, isHost: asHost });
      // Clear invite tracking once joined
      setInvitedCalls(prev => { const s = new Set(prev); s.delete(callId); return s; });
      setActiveCalls(prev => { const m = new Map(prev); m.delete(callId); return m; });
    } catch (err) {
      toast('Failed to start call');
    }
  }, []); // eslint-disable-line

  const requestJoinCall = useCallback((callId) => {
    if (!socketRef.current) return;
    socketRef.current.emit('call:join_request', { callId, requesterName: currentUser?.name || 'Someone' });
    setCallRequestSent(prev => new Set([...prev, callId]));
  }, [currentUser]);

  const acceptJoin = useCallback((req) => {
    setPendingJoinRequests(prev => prev.filter(r => !(r.requesterId === req.requesterId && r.callId === req.callId)));
    socketRef.current?.emit('call:accept_join', { callId: req.callId, requesterId: req.requesterId, requesterName: req.requesterName });
  }, []);

  const rejectJoin = useCallback((req) => {
    setPendingJoinRequests(prev => prev.filter(r => !(r.requesterId === req.requesterId && r.callId === req.callId)));
    socketRef.current?.emit('call:reject_join', { callId: req.callId, requesterId: req.requesterId });
  }, []);

  const inviteToCall = useCallback((callId, inviteeId) => {
    socketRef.current?.emit('call:invite', { callId, inviteeId });
  }, []);

  const endCall = useCallback(() => {
    setMyActiveCall(null);
    setPendingJoinRequests([]);
  }, []);

  if (loading) return <Spinner />;

  if (staticPage === 'privacy') {
    return (
      <React.Suspense fallback={<Spinner />}>
        <PrivacyPolicyPage onBack={() => { window.history.pushState({}, '', '/'); setStaticPage(null); }} />
      </React.Suspense>
    );
  }

  if (staticPage === 'terms') {
    return (
      <React.Suspense fallback={<Spinner />}>
        <TermsPage onBack={() => { window.history.pushState({}, '', '/'); setStaticPage(null); }} />
      </React.Suspense>
    );
  }

  if (inviteToken && !loggedIn) {
    return <LoginScreen googleClientId={googleClientId} onLoginSuccess={(user) => {
      setLoggedIn(true);
      setCurrentUser(user);
      identifyUser(user);
      loadData();
      loadNotifications();
      enablePush();
    }} onOpenPrivacy={() => setStaticPage('privacy')} onOpenTerms={() => setStaticPage('terms')} />;
  }

  if (inviteToken && loggedIn) {
    return (
      <React.Suspense fallback={<Spinner />}>
        <InviteLandingView inviteToken={inviteToken} onAccept={handleAcceptInvite} />
      </React.Suspense>
    );
  }

  if (!loggedIn) {
    return <LoginScreen googleClientId={googleClientId} onLoginSuccess={(user) => {
      setLoggedIn(true);
      setCurrentUser(user);
      identifyUser(user);
      loadData();
      loadNotifications();
      enablePush();
    }} onOpenPrivacy={() => setStaticPage('privacy')} onOpenTerms={() => setStaticPage('terms')} />;
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
  // Projects nested inside shared spaces aren't in sharedProjects — resolve them
  // from the space, inheriting the space-level role so viewer/editor gating applies.
  const currentSharedProject = currentSharedProjectId
    ? (sharedProjects.find(p => p.id === currentSharedProjectId)
      || sharedSpaces.flatMap(s => (s.projects || []).map(p => ({ ...p, myRole: s.myRole, ownerInfo: s.ownerInfo }))).find(p => p.id === currentSharedProjectId))
    : undefined;
  const currentSharedSpace = sharedSpaces.find(s => s.id === currentSharedSpaceId);
  const currentSpace = appData.spaces?.find(s => s.id === currentSpaceId);
  const activeView = currentSharedProject ? 'shared' : currentSharedSpace ? 'shared-space' : currentProjectId ? 'project' : currentSpaceId && currentSpace ? 'space' : 'dashboard';

  const requestLeaveShared = (kind, item) => setLeaveConfirm({ open: true, kind, item });
  const performLeaveShared = async () => {
    const { kind, item } = leaveConfirm;
    setLeaveConfirm({ open: false, kind: '', item: null });
    if (!item) return;
    const r = kind === 'space'
      ? await api('leave_space', { spaceId: item.id })
      : await api('leave_project', { projectId: item.id });
    if (r?.ok) {
      if (kind === 'space' && currentSharedSpaceId === item.id) setCurrentSharedSpaceId(null);
      if (kind === 'project' && currentSharedProjectId === item.id) setCurrentSharedProjectId(null);
      toast(`You left "${item.title}"`);
      loadData();
    } else {
      toast(r?.error || `Could not leave ${kind}`);
    }
  };

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
        onToast={toast}
        onScheduleDelete={scheduleDelete}
        onLeaveShared={requestLeaveShared}
        isLoading={!dataLoaded}
      />

      <DialogModal
        isOpen={leaveConfirm.open}
        type="confirm"
        title={leaveConfirm.kind === 'space' ? 'Leave space' : 'Leave project'}
        message={`Leave "${leaveConfirm.item?.title}"? You will lose access${leaveConfirm.kind === 'space' ? ' to this space and its projects' : ''}. ${leaveConfirm.item?.ownerInfo?.name || 'The owner'} can re-invite you later.`}
        onConfirm={performLeaveShared}
        onCancel={() => setLeaveConfirm({ open: false, kind: '', item: null })}
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
            currentUser={currentUser}
            isLoading={!dataLoaded}
            onToggleTask={toggleTaskOptimistic}
            onOpenProject={(pid) => { setCurrentProjectId(pid); setCurrentSharedProjectId(null); }}
            onOpenSharedProject={(pid) => { setCurrentSharedProjectId(pid); setCurrentProjectId(null); }}
            onOpenSpace={(sid) => { setCurrentSpaceId(sid); setCurrentProjectId(null); setCurrentSharedProjectId(null); setCurrentSharedSpaceId(null); }}
            onOpenSharedSpace={(sid) => { setCurrentSharedSpaceId(sid); setCurrentSpaceId(null); setCurrentProjectId(null); setCurrentSharedProjectId(null); }}
            onReorder={loadData}
            onOpenSearch={() => setIsCommandPaletteOpen(true)}
            onOpenNotifications={() => setShowNotifications(true)}
            onOpenFeedback={() => setShowFeedback(true)}
            unreadNotifications={unreadCount}
            onLeaveShared={requestLeaveShared}
          />
        )}
        {!showProfile && activeView === 'space' && currentSpace && (
          <SpaceView
            space={currentSpace}
            projects={(appData.projects || []).filter(p => p.spaceId === currentSpaceId)}
            onToggleTask={toggleTaskOptimistic}
            onOpenProject={(pid) => { setCurrentProjectId(pid); setCurrentSharedProjectId(null); }}
            onReorder={loadData}
            onAddProject={() => { setAddProjectSpaceId(currentSpaceId); setShowAddProject(true); }}
            onOpenCollab={() => setShowSpaceCollab({ open: true, spaceId: currentSpaceId })}
            onEditSpace={() => setShowEditSpace(currentSpace)}
            onOpenSearch={() => setIsCommandPaletteOpen(true)}
            onOpenNotifications={() => setShowNotifications(true)}
            onOpenFeedback={() => setShowFeedback(true)}
            unreadNotifications={unreadCount}
            livekitEnabled={livekitEnabled}
            onStartCall={(callType) => startCall(currentSpaceId, callType, 'space')}
            incomingCall={!dismissedCalls.has(currentSpaceId) && activeCalls.has(currentSpaceId) && activeCalls.get(currentSpaceId)?.hostUserId !== currentUser?.id ? { ...activeCalls.get(currentSpaceId), callId: currentSpaceId, isInvited: invitedCalls.has(currentSpaceId) } : null}
            onRequestJoinCall={() => requestJoinCall(currentSpaceId)}
            onJoinInvitedCall={() => { const c = activeCalls.get(currentSpaceId); startCall(currentSpaceId, c?.callType || 'audio', 'space', false); }}
            callRequestSent={callRequestSent.has(currentSpaceId)}
            isInCall={myActiveCall?.callId === currentSpaceId}
            onDismissCallBanner={() => setDismissedCalls(prev => new Set([...prev, currentSpaceId]))}
            onToast={toast}
          />
        )}
        {!showProfile && activeView === 'shared-space' && currentSharedSpace && (
          <SpaceView
            space={currentSharedSpace}
            projects={(currentSharedSpace.projects || []).filter(p => !p.archived)}
            onToggleTask={toggleTaskOptimistic}
            onOpenProject={(pid) => {
              // My own projects in this space use the owner view; everyone else's
              // open through the shared path, which carries role-based gating.
              if ((appData.projects || []).some(p => p.id === pid)) { setCurrentProjectId(pid); setCurrentSharedProjectId(null); }
              else { setCurrentSharedProjectId(pid); setCurrentProjectId(null); }
              setCurrentSharedSpaceId(null);
            }}
            onReorder={loadData}
            onAddProject={() => { setAddProjectSpaceId(currentSharedSpace.id); setShowAddProject(true); }}
            canAddProject={currentSharedSpace.myRole === 'editor'}
            isSharedView={true}
            sharedBy={currentSharedSpace.ownerInfo?.name || ''}
            onOpenCollab={() => {}}
            onEditSpace={() => {}}
            onOpenSearch={() => setIsCommandPaletteOpen(true)}
            onOpenNotifications={() => setShowNotifications(true)}
            onOpenFeedback={() => setShowFeedback(true)}
            unreadNotifications={unreadCount}
            onToast={toast}
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
                onPatchTasks={patchProjectTasks}
                onScheduleTaskDelete={(task) => scheduleDelete({
                  entityId: task.id,
                  message: 'Task deleted',
                  commitAction: 'delete_task',
                  commitBody: { projectId: currentProject.id, taskId: task.id },
                })}
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
                livekitEnabled={livekitEnabled}
                onStartCall={(callType) => startCall(currentProject.id, callType, 'project')}
                incomingCall={!dismissedCalls.has(currentProject.id) && activeCalls.has(currentProject.id) && activeCalls.get(currentProject.id).hostUserId !== currentUser?.id ? { ...activeCalls.get(currentProject.id), callId: currentProject.id, isInvited: invitedCalls.has(currentProject.id) } : null}
                onRequestJoinCall={() => requestJoinCall(currentProject.id)}
                onJoinInvitedCall={() => { const c = activeCalls.get(currentProject.id); startCall(currentProject.id, c?.callType || 'audio', 'project', false); }}
                callRequestSent={callRequestSent.has(currentProject.id)}
                isInCall={myActiveCall?.callId === currentProject.id}
                onDismissCallBanner={() => setDismissedCalls(prev => new Set([...prev, currentProject.id]))}
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
                onPatchTasks={patchProjectTasks}
                onScheduleTaskDelete={(task) => scheduleDelete({
                  entityId: task.id,
                  message: 'Task deleted',
                  commitAction: 'delete_task',
                  commitBody: { projectId: currentSharedProject.id, taskId: task.id },
                })}
                isSharedView={true}
                sharedBy={currentSharedProject.sharedBy || currentSharedProject.ownerInfo?.name || ''}
                currentUserRole={currentSharedProject.myRole || 'viewer'}
                onBack={() => {
                  const spaceId = currentSharedProject?.spaceId;
                  setCurrentSharedProjectId(null);
                  const parentSharedSpace = spaceId ? sharedSpaces.find(s => s.id === spaceId) : null;
                  if (parentSharedSpace) setCurrentSharedSpaceId(parentSharedSpace.id);
                }}
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
                livekitEnabled={livekitEnabled}
                onStartCall={(callType) => startCall(currentSharedProject.id, callType, 'project')}
                incomingCall={!dismissedCalls.has(currentSharedProject.id) && activeCalls.has(currentSharedProject.id) && activeCalls.get(currentSharedProject.id).hostUserId !== currentUser?.id ? { ...activeCalls.get(currentSharedProject.id), callId: currentSharedProject.id, isInvited: invitedCalls.has(currentSharedProject.id) } : null}
                onRequestJoinCall={() => requestJoinCall(currentSharedProject.id)}
                onJoinInvitedCall={() => { const c = activeCalls.get(currentSharedProject.id); startCall(currentSharedProject.id, c?.callType || 'audio', 'project', false); }}
                callRequestSent={callRequestSent.has(currentSharedProject.id)}
                isInCall={myActiveCall?.callId === currentSharedProject.id}
                onDismissCallBanner={() => setDismissedCalls(prev => new Set([...prev, currentSharedProject.id]))}
              />
            </motion.div>
          </AnimatePresence>
        )}
        {!showProfile && (activeView === 'dashboard' || activeView === 'space' || activeView === 'shared-space') && <QuoteBar />}
      </main>

      {/* Global pulse animation for call indicators */}
      <style>{`
        @keyframes bj-call-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
          50% { box-shadow: 0 0 0 5px rgba(34,197,94,0); }
        }
      `}</style>

      {/* Floating call room — renders over everything regardless of active view */}
      <AnimatePresence>
        {myActiveCall && (
          <CallRoom
            key={myActiveCall.roomName}
            token={myActiveCall.token}
            roomName={myActiveCall.roomName}
            livekitUrl={myActiveCall.livekitUrl}
            callType={myActiveCall.callType}
            isHost={myActiveCall.isHost}
            callId={myActiveCall.callId}
            collaborators={(() => {
              // For project calls, include space-level collaborators so they can be invited too
              const callProject = [...(appData.projects || []), ...sharedProjects].find(p => p.id === myActiveCall.callId);
              if (callProject) {
                const parentSpace = callProject.spaceId ? [...(appData.spaces || []), ...sharedSpaces].find(s => s.id === callProject.spaceId) : null;
                const directIds = new Set((callProject.collaborators || []).map(c => c.userId).filter(Boolean));
                const viaSpace = (parentSpace?.collaborators || []).filter(c => c.userId && !directIds.has(c.userId));
                return [...(callProject.collaborators || []), ...viaSpace];
              }
              return [...(appData.spaces || []), ...sharedSpaces].find(s => s.id === myActiveCall.callId)?.collaborators || [];
            })()}
            pendingJoinRequests={pendingJoinRequests.filter(r => r.callId === myActiveCall.callId)}
            onAcceptJoin={acceptJoin}
            onRejectJoin={rejectJoin}
            onInvite={(inviteeId) => inviteToCall(myActiveCall.callId, inviteeId)}
            onEnd={endCall}
            socket={socketRef.current}
            currentUser={currentUser}
          />
        )}
      </AnimatePresence>

      {/* Global call notifications — show for any project/space not currently on screen */}
      {livekitEnabled && loggedIn && !myActiveCall && (() => {
        const currentEntityId = (currentProjectId || currentSharedProjectId || currentSpaceId || currentSharedSpaceId);
        const allProjects = [...(appData.projects || []), ...sharedProjects];
        const allSpaces = [...(appData.spaces || []), ...sharedSpaces];
        const globalCalls = Array.from(activeCalls.entries())
          .filter(([callId, call]) =>
            call.hostUserId !== currentUser?.id &&
            !dismissedCalls.has(callId) &&
            callId !== currentEntityId
          )
          .map(([callId, call]) => {
            const entity = call.entityType === 'space'
              ? allSpaces.find(s => s.id === callId)
              : allProjects.find(p => p.id === callId);
            return { callId, ...call, entityName: entity?.title || null, isInvited: invitedCalls.has(callId) };
          });
        if (globalCalls.length === 0) return null;
        return (
          <GlobalCallNotification
            calls={globalCalls}
            onJoin={(c) => startCall(c.callId, c.callType, c.entityType || 'project', false)}
            onRequestJoin={(c) => requestJoinCall(c.callId)}
            onDismiss={(callId) => setDismissedCalls(prev => new Set([...prev, callId]))}
            requestSent={callRequestSent}
          />
        );
      })()}

      <Toast toast={toastData} onClear={() => setToastData(null)} />
      <AnimatePresence>
        {lightboxUrl && <FadeOut key="lightbox"><Lightbox url={lightboxUrl} onClose={() => setLightboxUrl('')} /></FadeOut>}
      </AnimatePresence>

      <AnimatePresence>
      {showAddProject && (
        <FadeOut key="add-project">
        <ProjectModal
          spaceId={addProjectSpaceId}
          onClose={() => setShowAddProject(false)}
          onSuccess={(id) => { loadData(); setCurrentProjectId(id); setCurrentSharedSpaceId(null); setCurrentSharedProjectId(null); setShowAddProject(false); toast('Project created!'); }}
        />
        </FadeOut>
      )}
      </AnimatePresence>
      <AnimatePresence>
      {showAddSpace && (
        <FadeOut key="add-space">
        <SpaceModal
          onClose={() => setShowAddSpace(false)}
          onSuccess={(id) => { loadData(); if (id) setCurrentSpaceId(id); setShowAddSpace(false); toast('Space created!'); }}
        />
        </FadeOut>
      )}
      </AnimatePresence>
      <AnimatePresence>
      {showEditSpace && (
        <FadeOut key="edit-space">
        <SpaceModal
          space={showEditSpace}
          onClose={() => setShowEditSpace(null)}
          onSuccess={() => { loadData(); setShowEditSpace(null); toast('Space updated!'); }}
        />
        </FadeOut>
      )}
      </AnimatePresence>

      <AnimatePresence>
      {showWordpad.open && currentProject && (
        <FadeOut key="wordpad">
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
        </FadeOut>
      )}
      </AnimatePresence>

      <AnimatePresence>
      {showCollab.open && (<FadeOut key="collab">{(() => {
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
      })()}</FadeOut>)}
      </AnimatePresence>

      <AnimatePresence>
      {showSpaceCollab.open && (
        <FadeOut key="space-collab">
        <SpaceCollabModal
          spaceId={showSpaceCollab.spaceId}
          space={(appData.spaces || []).find(s => s.id === showSpaceCollab.spaceId)}
          onClose={() => setShowSpaceCollab({ open: false, spaceId: '' })}
          onUpdate={loadData}
          onUpdateRole={updateSpaceCollabRole}
          onToast={toast}
          currentUser={currentUser}
        />
        </FadeOut>
      )}
      </AnimatePresence>

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
