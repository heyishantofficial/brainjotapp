import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// Phone ring icon
const PhoneRingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.65 3.42 2 2 0 0 1 3.62 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.91 5.91l.77-.77a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
);

const VideoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>
);

// One notification card per incoming call
function CallNotificationCard({ callInfo, onJoin, onRequestJoin, onDismiss, requestSent }) {
  const { hostName, callType, entityName, isInvited } = callInfo;
  const isVideo = callType === 'video';

  return (
    <motion.div
      initial={{ opacity: 0, x: 60, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.95 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      style={{
        background: 'rgba(10, 13, 22, 0.94)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(34,197,94,0.25)',
        borderRadius: '16px',
        padding: '14px 16px',
        width: '300px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        fontFamily: 'inherit',
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        {/* Animated icon */}
        <div style={{
          width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
          background: 'rgba(34,197,94,0.12)',
          border: '1.5px solid rgba(34,197,94,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#4ade80',
          animation: 'bj-call-pulse 1.5s ease-in-out infinite',
        }}>
          {isVideo ? <VideoIcon /> : <PhoneRingIcon />}
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: 'rgba(255,255,255,0.9)', lineHeight: '1.3' }}>
            {isInvited
              ? <><span style={{ color: '#4ade80' }}>{hostName}</span> invited you to a {callType} call</>
              : <><span style={{ color: '#4ade80' }}>{hostName}</span> started a {callType} call</>
            }
          </div>
          {entityName && (
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontWeight: '500', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              in {entityName}
            </div>
          )}
        </div>

        {/* Dismiss X */}
        <button
          onClick={onDismiss}
          style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
            cursor: 'pointer', padding: '2px', lineHeight: 1, flexShrink: 0,
            display: 'flex', alignItems: 'center',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {isInvited ? (
          <button
            onClick={onJoin}
            style={{
              flex: 1, background: '#22c55e', color: '#000', border: 'none',
              borderRadius: '10px', padding: '8px 0',
              fontWeight: '700', fontSize: '13px', cursor: 'pointer',
            }}
          >
            Join Now
          </button>
        ) : requestSent ? (
          <div style={{ flex: 1, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '12px', fontWeight: '600', padding: '8px 0' }}>
            Request sent…
          </div>
        ) : (
          <button
            onClick={onRequestJoin}
            style={{
              flex: 1, background: 'transparent', color: '#4ade80',
              border: '1.5px solid rgba(74,222,128,0.4)',
              borderRadius: '10px', padding: '8px 0',
              fontWeight: '700', fontSize: '13px', cursor: 'pointer',
            }}
          >
            Request to Join
          </button>
        )}
        <button
          onClick={onDismiss}
          style={{
            background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px', padding: '8px 16px',
            fontWeight: '600', fontSize: '13px', cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    </motion.div>
  );
}

// Stack of notifications — renders in bottom-right, above the call room
export default function GlobalCallNotification({ calls, onJoin, onRequestJoin, onDismiss, requestSent }) {
  if (!calls || calls.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 9998, // just below CallRoom (9999)
      display: 'flex',
      flexDirection: 'column-reverse',
      gap: '10px',
      pointerEvents: 'none', // let clicks through the gap
    }}>
      <AnimatePresence>
        {calls.map(callInfo => (
          <div key={callInfo.callId} style={{ pointerEvents: 'all' }}>
            <CallNotificationCard
              callInfo={callInfo}
              onJoin={() => onJoin(callInfo)}
              onRequestJoin={() => onRequestJoin(callInfo)}
              onDismiss={() => onDismiss(callInfo.callId)}
              requestSent={requestSent.has(callInfo.callId)}
            />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
