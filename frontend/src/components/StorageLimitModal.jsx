import React from 'react';
import { motion, AnimatePresence } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { Sparkles } from 'lucide-react';

// Shown when an upload is rejected with code 'storage_limit' (200 MB free tier).
// The Upgrade button is a placeholder until the Pro screen exists — wire
// onUpgrade to it when it does.
export default function StorageLimitModal({ isOpen, onClose, onUpgrade }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="lightbox-overlay"
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          style={{ zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div className="dialog-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="storage-limit-title">
            <div className="dialog-header" id="storage-limit-title">You've reached your free upload limit.</div>
            <div className="dialog-message">
              This app is built by a small independent team. To keep free accounts available for everyone,
              storage is currently limited to 200 MB per user.
              <br /><br />
              If you enjoy using the app, upgrading to Pro gives you more storage and exclusive
              features—and directly supports future development.
            </div>
            <div className="dialog-actions">
              <button className="dialog-btn cancel" onClick={onClose}>Maybe later</button>
              <button className="dialog-btn confirm" onClick={onUpgrade} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={15} /> Upgrade to Pro
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
