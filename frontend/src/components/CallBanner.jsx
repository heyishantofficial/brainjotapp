import React from 'react';
import { motion } from 'framer-motion';

export default function CallBanner({ callInfo, onRequestJoin, onJoinNow, onDismiss, requestSent }) {
  if (!callInfo) return null;

  const isInvited = callInfo.isInvited;
  const typeLabel = callInfo.callType === 'video' ? 'video' : 'audio';

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 18px',
        background: 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.03))',
        border: '1px solid rgba(34,197,94,0.25)',
        borderRadius: '16px',
        marginBottom: '16px',
        fontSize: '14px',
        color: 'var(--text)',
      }}
    >
      <span style={{
        width: '9px', height: '9px', borderRadius: '50%',
        background: '#22c55e', boxShadow: '0 0 0 3px rgba(34,197,94,0.2)',
        animation: 'bj-call-pulse 1.5s ease-in-out infinite',
        flexShrink: 0, display: 'block',
      }} />

      <span style={{ fontWeight: '600', flex: 1 }}>
        <strong style={{ color: '#22c55e' }}>{callInfo.hostName}</strong>
        {isInvited
          ? <> invited you to join a <strong>{typeLabel} call</strong></>
          : <> started a <strong>{typeLabel} call</strong></>
        }
      </span>

      {isInvited ? (
        // Invited: direct join (no request needed)
        <button
          onClick={onJoinNow}
          style={{
            background: '#22c55e', color: '#000', border: 'none',
            borderRadius: '10px', padding: '7px 16px',
            fontWeight: '700', fontSize: '13px', cursor: 'pointer', flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          Join Now
        </button>
      ) : requestSent ? (
        <span style={{ color: 'var(--muted)', fontSize: '13px', fontWeight: '600', padding: '6px 12px' }}>
          Request sent…
        </span>
      ) : (
        // Not invited: must request permission
        <button
          onClick={onRequestJoin}
          style={{
            background: 'transparent', color: '#22c55e',
            border: '1.5px solid rgba(34,197,94,0.5)',
            borderRadius: '10px', padding: '6px 16px',
            fontWeight: '700', fontSize: '13px', cursor: 'pointer', flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.08)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          Request to Join
        </button>
      )}

      <button
        onClick={onDismiss} title="Dismiss"
        style={{
          background: 'transparent', color: 'var(--muted)', border: 'none',
          borderRadius: '8px', padding: '4px 8px', cursor: 'pointer',
          fontSize: '16px', lineHeight: 1, flexShrink: 0,
        }}
      >
        ✕
      </button>
    </motion.div>
  );
}
