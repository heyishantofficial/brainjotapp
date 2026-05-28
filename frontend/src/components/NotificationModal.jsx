import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { api } from '../api';
import Avatar from './Avatar';

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function NotifRow({ notif, onRespond, onNavigate }) {
  const [responding, setResponding] = useState(false);

  const handleRespond = async (e, accept) => {
    e.stopPropagation();
    setResponding(true);
    await onRespond(notif.id, accept);
  };

  const isInvite = notif.type === 'collab_invite';
  const isMention = notif.type === 'mention';
  const isAssigned = notif.type === 'task_assigned';
  const isInviteResponse = notif.type === 'invite_response';
  const isTaskComment = notif.type === 'task_comment';
  const isPending = notif.status === 'pending';
  const canNavigate = !!(notif.meta?.entityId && notif.meta?.entityType);

  const icon = isInvite ? '👥' : isMention || isTaskComment ? '💬' : isAssigned ? '📋' : isInviteResponse ? (notif.meta?.accepted === false ? '❌' : '✅') : '🔔';

  let bodyText;
  if (isInvite) {
    bodyText = (
      <>
        <span style={{ fontWeight: '800' }}>@{notif.fromUsername}</span> invited you to collaborate on{' '}
        <span style={{ fontWeight: '800' }}>{notif.meta?.entityTitle}</span>
        {' '}as <span style={{ fontWeight: '700', color: 'var(--accent)' }}>{notif.meta?.role}</span>
      </>
    );
  } else if (isMention) {
    bodyText = (
      <>
        <span style={{ fontWeight: '800' }}>@{notif.fromUsername}</span> mentioned you in{' '}
        <span style={{ fontWeight: '800' }}>{notif.meta?.taskTitle || notif.meta?.entityTitle}</span>
        {notif.meta?.commentText && (
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px', fontStyle: 'italic' }}>"{notif.meta.commentText}"</div>
        )}
      </>
    );
  } else if (isAssigned) {
    bodyText = (
      <>
        <span style={{ fontWeight: '800' }}>@{notif.fromUsername}</span> assigned you to{' '}
        <span style={{ fontWeight: '800' }}>{notif.meta?.taskTitle || 'a task'}</span>
        {notif.meta?.entityTitle && (
          <span style={{ fontSize: '12px', color: 'var(--muted)' }}> in {notif.meta.entityTitle}</span>
        )}
      </>
    );
  } else if (isInviteResponse) {
    const wasAccepted = notif.meta?.accepted !== false;
    bodyText = (
      <>
        <span style={{ fontWeight: '800' }}>@{notif.fromUsername}</span>{' '}
        {wasAccepted ? 'accepted' : 'declined'} your invite to{' '}
        <span style={{ fontWeight: '800' }}>{notif.meta?.entityTitle}</span>
        {wasAccepted && notif.meta?.role && (
          <span style={{ fontSize: '12px', color: 'var(--muted)' }}> as {notif.meta.role}</span>
        )}
      </>
    );
  } else if (isTaskComment) {
    bodyText = (
      <>
        <span style={{ fontWeight: '800' }}>@{notif.fromUsername}</span> commented on your task{' '}
        <span style={{ fontWeight: '800' }}>{notif.meta?.taskTitle || 'a task'}</span>
        {notif.meta?.commentText && (
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px', fontStyle: 'italic' }}>"{notif.meta.commentText}"</div>
        )}
      </>
    );
  } else {
    bodyText = <><span style={{ fontWeight: '800' }}>{notif.fromName}</span> {notif.meta?.entityTitle}</>;
  }

  return (
    <div
      onClick={canNavigate ? () => onNavigate?.({ entityType: notif.meta.entityType, entityId: notif.meta.entityId, taskId: notif.meta.taskId }) : undefined}
      style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        background: isPending ? 'var(--surface2)' : 'transparent',
        cursor: canNavigate ? 'pointer' : 'default',
      }}
      onMouseEnter={canNavigate ? e => { e.currentTarget.style.background = 'var(--surface2)'; } : undefined}
      onMouseLeave={canNavigate ? e => { e.currentTarget.style.background = isPending ? 'var(--surface2)' : 'transparent'; } : undefined}
    >
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <div style={{ fontSize: '18px', paddingTop: '2px' }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', color: 'var(--text)', lineHeight: '1.5' }}>{bodyText}</div>
          <div style={{ fontSize: '11px', color: 'var(--faint)', marginTop: '4px', fontWeight: '600' }}>
            {timeAgo(notif.createdAt)}
          </div>

          {/* Accept / Deny buttons for pending invites */}
          {isInvite && isPending && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button
                disabled={responding}
                onClick={(e) => handleRespond(e, true)}
                style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: 'var(--accent)', color: '#000', fontSize: '12px', fontWeight: '800', cursor: responding ? 'default' : 'pointer', opacity: responding ? 0.6 : 1 }}
              >
                {responding ? '…' : 'Accept'}
              </button>
              <button
                disabled={responding}
                onClick={(e) => handleRespond(e, false)}
                style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: '12px', fontWeight: '700', cursor: responding ? 'default' : 'pointer', opacity: responding ? 0.6 : 1 }}
              >
                Deny
              </button>
            </div>
          )}

          {/* Accepted / Denied status badge */}
          {isInvite && !isPending && notif.status !== 'read' && (
            <div style={{ marginTop: '8px', fontSize: '11px', fontWeight: '700', color: notif.status === 'accepted' ? '#10b981' : '#ef4444' }}>
              {notif.status === 'accepted' ? '✓ You joined' : '✕ Declined'}
            </div>
          )}
        </div>
        <Avatar name={notif.fromName} src={notif.fromAvatarUrl} size={36} />
      </div>
    </div>
  );
}

export default function NotificationModal({ isOpen, onClose, notifications, onRefresh, onNavigate }) {
  const modalRef = useRef(null);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleRespond = async (notifId, accept) => {
    await api('respond_collab_invite', { notifId, accept });
    onRefresh();
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    await api('mark_notification_read', {});
    await onRefresh();
    setMarkingAll(false);
  };

  const pendingCount = notifications.filter(n => n.status === 'pending').length;
  // Non-invite pending = unread mentions, comments, assignments (can be bulk-cleared)
  const clearableCount = notifications.filter(n => n.status === 'pending' && n.type !== 'collab_invite').length;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="modal-overlay" style={{ zIndex: 99999, background: 'transparent' }} onClick={onClose}>
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: '70px', right: '20px',
              width: '400px', maxWidth: '92vw',
              borderRadius: '24px', overflow: 'hidden',
              background: 'var(--surface)', border: '1px solid var(--border)',
              boxShadow: '0 20px 50px rgba(0,0,0,0.4)', zIndex: 100000,
            }}
          >
            <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>
                  Notifications
                  {pendingCount > 0 && (
                    <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: '900', background: '#ef4444', color: '#fff', padding: '2px 7px', borderRadius: '20px' }}>{pendingCount}</span>
                  )}
                </h2>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>Invites, mentions and activity</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {clearableCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    disabled={markingAll}
                    style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: markingAll ? 'default' : 'pointer', fontSize: '12px', fontWeight: '700', opacity: markingAll ? 0.5 : 1, whiteSpace: 'nowrap' }}
                  >
                    {markingAll ? '…' : 'Mark all read'}
                  </button>
                )}
                <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '20px' }}>✕</button>
              </div>
            </div>

            <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--muted)' }}>
                  <div style={{ fontSize: '36px', marginBottom: '12px' }}>📭</div>
                  <div style={{ fontWeight: '700' }}>You're all caught up!</div>
                  <div style={{ fontSize: '13px', marginTop: '4px' }}>No notifications yet.</div>
                </div>
              ) : (
                notifications.map(n => (
                  <NotifRow key={n.id} notif={n} onRespond={handleRespond} onNavigate={onNavigate} />
                ))
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
