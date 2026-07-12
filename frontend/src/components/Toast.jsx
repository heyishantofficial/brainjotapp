import React, { useEffect } from 'react';

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

  if (!toast?.message) return null;

  return (
    <div className={`toast show`} id="toast" role="status" aria-live="polite" aria-atomic="true">
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
    </div>
  );
}
