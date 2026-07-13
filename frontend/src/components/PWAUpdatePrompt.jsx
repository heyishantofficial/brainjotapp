import React from 'react';
import { motion, AnimatePresence } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { useRegisterSW } from 'virtual:pwa-register/react';

// Prompt-based service worker updates: instead of silently reloading
// (autoUpdate), we surface a toast so users aren't interrupted mid-edit.
// Clicking "Refresh" activates the waiting SW and reloads.
export default function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          key="pwa-update"
          className="toast show"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          /* motion drives transform/opacity per-frame; the CSS `transition:all`
             on .toast would fight it, so it's disabled inline */
          style={{ transition: 'none' }}
        >
          <span>A new version of BrainJot is available.</span>
          <button className="toast-action" onClick={() => updateServiceWorker(true)}>
            Refresh
          </button>
          <button className="toast-action" onClick={() => setNeedRefresh(false)}>
            Later
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
