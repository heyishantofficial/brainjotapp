/**
 * BrainJot — Web Push subscription management.
 * The service worker (public/sw.js) shows the notifications; this module
 * handles permission + subscribing this browser and syncing it to the backend.
 */
import { api } from '../api';
import { requestNotificationPermission } from './notifications';

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// The Push API wants the VAPID key as a Uint8Array, not base64url.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// The PWA service worker is registered app-wide by PWAUpdatePrompt
// (vite-plugin-pwa); our push handlers ride along via workbox.importScripts.
// Don't register a second SW here — just wait for the existing one. The
// timeout covers dev, where the PWA plugin is disabled and .ready never fires.
async function getReadyRegistration() {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

async function subscribeAndSync() {
  const { key } = await api('get_push_key', null, 'GET');
  if (!key) return false; // push not configured on the server
  const reg = await getReadyRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
  await api('subscribe_push', { subscription: sub.toJSON() });
  return true;
}

/**
 * Ask for permission (if needed) and subscribe. Call from a login flow —
 * requesting permission needs user context to not feel like spam.
 */
export async function enablePush() {
  if (!pushSupported()) return false;
  const granted = await requestNotificationPermission();
  if (!granted) return false;
  try {
    return await subscribeAndSync();
  } catch (e) {
    console.warn('[BrainJot] push subscribe failed:', e);
    return false;
  }
}

/**
 * Silent re-sync on app load for returning sessions: only proceeds when the
 * user already granted permission, so it never prompts.
 */
export async function syncPushIfGranted() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    await subscribeAndSync();
  } catch (e) {
    console.warn('[BrainJot] push sync failed:', e);
  }
}

/**
 * Best-effort detach of this browser's subscription from the account.
 * Call BEFORE the logout request (the API call needs the session cookie).
 * The subscription itself stays alive in the browser so the next login can
 * re-attach it instantly.
 */
export async function disablePushForLogout() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager?.getSubscription();
    if (sub?.endpoint) await api('unsubscribe_push', { endpoint: sub.endpoint });
  } catch { /* best-effort */ }
}
