import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Prompt-based service worker updates: instead of silently reloading
// (autoUpdate), we surface a toast so users aren't interrupted mid-edit.
// Clicking "Refresh" activates the waiting SW and reloads.
export default function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="toast show" role="status" aria-live="polite" aria-atomic="true">
      <span>A new version of BrainJot is available.</span>
      <button className="toast-action" onClick={() => updateServiceWorker(true)}>
        Refresh
      </button>
      <button className="toast-action" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  );
}
