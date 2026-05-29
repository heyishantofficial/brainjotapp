import React, { useEffect } from 'react';

export default function Toast({ toast, onClear }) {
  useEffect(() => {
    if (toast?.message) {
      const timer = setTimeout(() => {
        onClear();
      }, 5000); // Increased to 5s for actions
      return () => clearTimeout(timer);
    }
  }, [toast, onClear]);

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
    </div>
  );
}
