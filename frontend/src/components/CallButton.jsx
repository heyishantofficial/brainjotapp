import React from 'react';

function PhonePlusIcon({ color, size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.65 3.42 2 2 0 0 1 3.62 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.91 5.91l.77-.77a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.72 16z" />
      <line x1="19" y1="3" x2="19" y2="9" />
      <line x1="22" y1="6" x2="16" y2="6" />
    </svg>
  );
}

function VideoIcon({ color, size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

export default function CallButton({ project, onStartCall, hasActiveCall, isInCall, contrastColor }) {
  const hasCollabs = (project.collaborators || []).length > 0;
  if (!hasCollabs) return null;

  const disabled = isInCall || hasActiveCall;

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
      <CallBtn
        title={isInCall ? 'Currently in call' : hasActiveCall ? 'Call in progress' : 'Audio Call'}
        disabled={disabled}
        active={isInCall || hasActiveCall}
        contrastColor={contrastColor}
        onClick={() => !disabled && onStartCall('audio')}
      >
        <PhonePlusIcon color={contrastColor} size={17} />
        {(isInCall || hasActiveCall) && (
          <span style={{
            position: 'absolute', top: '5px', right: '5px',
            width: '7px', height: '7px', borderRadius: '50%',
            background: '#22c55e',
            boxShadow: '0 0 0 2px rgba(34,197,94,0.3)',
            animation: 'bj-call-pulse 1.5s ease-in-out infinite',
          }} />
        )}
      </CallBtn>

      <CallBtn
        title={isInCall ? 'Currently in call' : hasActiveCall ? 'Call in progress' : 'Video Call'}
        disabled={disabled}
        contrastColor={contrastColor}
        onClick={() => !disabled && onStartCall('video')}
      >
        <VideoIcon color={contrastColor} size={17} />
      </CallBtn>
    </div>
  );
}

function CallBtn({ title, disabled, active, contrastColor, onClick, children }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: active ? `${contrastColor}3a` : `${contrastColor}20`,
        border: active ? `1.5px solid ${contrastColor}50` : '1.5px solid transparent',
        borderRadius: '50%',
        width: '40px',
        height: '40px',
        minWidth: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        position: 'relative',
        transition: 'background 0.15s, border-color 0.15s',
        flexShrink: 0,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = `${contrastColor}38`; }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? `${contrastColor}3a` : `${contrastColor}20`; }}
    >
      {children}
    </button>
  );
}
