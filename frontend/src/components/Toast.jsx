import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion'; // eslint-disable-line no-unused-vars

export default function Toast({ toast, onClear }) {
  const duration = toast?.duration || 5000;

  useEffect(() => {
    if (toast?.message) {
      const timer = setTimeout(() => {
        onClear();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [toast, duration, onClear]);

  return (
    <AnimatePresence>
      {toast?.message && (
        <motion.div
          key="toast"
          className="toast show"
          id="toast"
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
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action.onClick();
                onClear();
              }}
            >
              {toast.action.label}
            </button>
          )}
          {/* Countdown bar — only for toasts with an action (e.g. Undo) so the
              user can see how long the window stays open */}
          {toast.action && (
            <div className="toast-countdown" key={toast.message + duration}>
              <div className="toast-countdown-fill" style={{ animationDuration: `${duration}ms` }} />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
