import React, { useState, useRef, useEffect } from 'react';

// The phone+ icon from the design — matches the icon in the user's screenshot
function PhonePlusIcon({ color, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.65 3.42 2 2 0 0 1 3.62 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.91 5.91l.77-.77a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.72 16z" />
      <line x1="19" y1="3" x2="19" y2="9" />
      <line x1="22" y1="6" x2="16" y2="6" />
    </svg>
  );
}

export default function CallButton({ project, onStartCall, hasActiveCall, isInCall, contrastColor }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const ref = useRef(null);

  const hasCollabs = (project.collaborators || []).length > 0;

  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  // Hide button for solo projects (no one to call)
  if (!hasCollabs) return null;

  const btnDisabled = isInCall || hasActiveCall;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { if (!btnDisabled) setShowDropdown(v => !v); }}
        title={isInCall ? 'Currently in call' : hasActiveCall ? 'Call in progress — request to join via the banner' : 'Start a call'}
        style={{
          background: `${contrastColor}26`,
          border: 'none',
          borderRadius: '50%',
          width: '42px',
          height: '42px',
          minWidth: '42px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: btnDisabled ? 'default' : 'pointer',
          position: 'relative',
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
        onMouseEnter={e => { if (!btnDisabled) e.currentTarget.style.background = `${contrastColor}40`; }}
        onMouseLeave={e => { e.currentTarget.style.background = `${contrastColor}26`; }}
      >
        <PhonePlusIcon color={contrastColor} size={18} />

        {/* Pulsing green dot — active call in this project */}
        {(hasActiveCall || isInCall) && (
          <span style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#22c55e',
            boxShadow: '0 0 0 2px rgba(34,197,94,0.35)',
            animation: 'bj-call-pulse 1.5s ease-in-out infinite',
          }} />
        )}
      </button>

      {showDropdown && !btnDisabled && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '6px',
          minWidth: '168px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          zIndex: 2000,
        }}>
          <DropdownItem
            emoji="🎤"
            label="Audio Call"
            onClick={() => { setShowDropdown(false); onStartCall('audio'); }}
          />
          <DropdownItem
            emoji="📹"
            label="Video Call"
            onClick={() => { setShowDropdown(false); onStartCall('video'); }}
          />
        </div>
      )}
    </div>
  );
}

function DropdownItem({ emoji, label, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        padding: '10px 14px',
        background: hover ? 'var(--surface2)' : 'none',
        border: 'none',
        borderRadius: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        color: 'var(--text)',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '600',
        transition: 'background 0.12s',
      }}
    >
      <span>{emoji}</span>
      {label}
    </button>
  );
}
