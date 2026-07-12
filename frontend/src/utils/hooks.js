import { useEffect } from 'react';

// One interaction grammar: every overlay closes on Escape.
// Pass enabled=false to pause (e.g. while a nested dialog is open).
export function useEscapeClose(onClose, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, enabled]);
}
