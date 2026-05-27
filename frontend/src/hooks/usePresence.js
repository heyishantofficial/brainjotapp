/**
 * BrainJot — Online Presence Hook
 *
 * Simulates real-time presence by polling localStorage every 5 seconds.
 * Each tab/session writes its own "heartbeat" and reads others.
 *
 * TODO: Replace localStorage polling with WebSocket or Supabase Realtime:
 *   - On mount: ws.send({ type: 'join', projectId, userId })
 *   - On ws.message: update onlineUsers state
 *   - On unmount: ws.send({ type: 'leave', projectId, userId })
 */

import { useState, useEffect, useRef } from 'react';

const HEARTBEAT_INTERVAL = 5000;  // 5s
const PRESENCE_TIMEOUT = 15000;   // consider offline after 15s no heartbeat

/**
 * @param {string} projectId — the current project being viewed
 * @param {string} currentUserId — the logged-in user's ID
 * @param {string} currentUserName — the logged-in user's display name
 * @returns {{ onlineUsers: Array<{id, name, color}> }}
 */
export function usePresence(projectId, currentUserId = 'me', currentUserName = 'You') {
  const [onlineUsers, setOnlineUsers] = useState([]);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!projectId) return;

    const presenceKey = `brainjot_presence_${projectId}`;

    const writeHeartbeat = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(presenceKey) || '{}');
        stored[currentUserId] = {
          id: currentUserId,
          name: currentUserName,
          ts: Date.now(),
        };
        localStorage.setItem(presenceKey, JSON.stringify(stored));
      } catch { /* ignore localStorage errors (private browsing / quota exceeded) */ }
    };

    const readPresence = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(presenceKey) || '{}');
        const now = Date.now();
        const active = Object.values(stored).filter(u => now - u.ts < PRESENCE_TIMEOUT);
        const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
        const online = active.map((u) => ({
          ...u,
          color: colors[Math.abs(hashCode(u.id)) % colors.length],
          isMe: u.id === currentUserId,
        }));
        setOnlineUsers(online);
      } catch { /* ignore localStorage errors (private browsing / quota exceeded) */ }
    };

    writeHeartbeat();
    readPresence();

    intervalRef.current = setInterval(() => {
      writeHeartbeat();
      readPresence();
    }, HEARTBEAT_INTERVAL);

    return () => {
      clearInterval(intervalRef.current);
    };
  }, [projectId, currentUserId, currentUserName]);

  return { onlineUsers };
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
}
