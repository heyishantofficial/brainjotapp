import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion'; // eslint-disable-line no-unused-vars


export default function NotificationModal({ isOpen, onClose, notifications = [], onMarkAsRead }) {
  const modalRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Mark all as read when opening
  useEffect(() => {
    if (isOpen && notifications.some(n => !n.read)) {
      onMarkAsRead();
    }
  }, [isOpen, notifications, onMarkAsRead]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div 
          className="modal-overlay" 
          style={{ zIndex: 99999, background: 'transparent' }} 
          onClick={onClose}
        >
          <motion.div 
            ref={modalRef}
            className="notification-dropdown"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={e => e.stopPropagation()}
            style={{ 
              position: 'fixed',
              top: '70px',
              right: '20px',
              width: '380px', 
              maxWidth: '90vw', 
              padding: '0', 
              overflow: 'hidden',
              borderRadius: '24px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
              zIndex: 100000
            }}
          >
            <div style={{ padding: '24px', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px', margin: 0 }}>Notifications</h2>
              <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>Stay updated on your collaborative work</div>
            </div>

            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>📭</div>
                  <div style={{ fontWeight: '600' }}>You're all caught up!</div>
                  <div style={{ fontSize: '13px', marginTop: '4px' }}>No new notifications.</div>
                </div>
              ) : (
                notifications.map((notif, index) => (
                  <div 
                    key={notif.id} 
                    style={{ 
                      padding: '16px 24px', 
                      borderBottom: index < notifications.length - 1 ? '1px solid var(--border)' : 'none',
                      display: 'flex',
                      gap: '16px',
                      background: notif.read ? 'transparent' : 'var(--surface2)',
                      transition: 'background 0.3s ease'
                    }}
                  >
                    <div style={{ fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {notif.icon || '💬'}
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', color: 'var(--text)', lineHeight: '1.4' }}>
                        <span style={{ fontWeight: '800' }}>{notif.actor}</span> {notif.action} <span style={{ fontWeight: '800' }}>{notif.target}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--faint)', marginTop: '4px', fontWeight: '600' }}>
                        {notif.time}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
