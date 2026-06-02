import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { AnimatePresence, motion } from 'framer-motion';

// ── Helpers ──────────────────────────────────────────────────────────────────
const initials = (n = '') =>
  n.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';

// ── Icons ────────────────────────────────────────────────────────────────────
const MicIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);
const MicOffIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);
const CamIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>
);
const CamOffIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);
// End call = plain X — unambiguous on a red button
const EndCallIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const UserPlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="8.5" cy="7" r="4"/>
    <line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>
  </svg>
);
const MaximizeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
  </svg>
);
const MinimizeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
  </svg>
);
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const XIcon = ({ s = 13 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const GripIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)" stroke="none">
    <circle cx="8" cy="5" r="1.5"/><circle cx="16" cy="5" r="1.5"/>
    <circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/>
    <circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/>
  </svg>
);

// ── Audio Waveform — canvas bars driven by Web Audio API ─────────────────────
function AudioWaveform({ audioStream, active, barCount = 24, height = 48 }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const barsRef = useRef(Array(barCount).fill(0.04));

  // Wire up AudioContext + AnalyserNode to the mic MediaStream
  useEffect(() => {
    if (!audioStream) return;
    let ctx, source, analyser;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      source = ctx.createMediaStreamSource(audioStream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 128;           // 64 frequency bins
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch (_) {}
    return () => {
      analyserRef.current = null;
      audioCtxRef.current = null;
      try { ctx?.close(); } catch (_) {}
    };
  }, [audioStream]);

  // Canvas draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const W = container.clientWidth || 240;
    const H = height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx2d = canvas.getContext('2d');
    ctx2d.scale(dpr, dpr);

    let simTime = 0;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      simTime += 0.04;

      let rawHeights;
      const analyser = analyserRef.current;

      if (analyser && active) {
        // Real audio frequency data
        const bufLen = analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        analyser.getByteFrequencyData(data);
        rawHeights = Array.from({ length: barCount }, (_, i) => {
          const start = Math.floor(i * bufLen / barCount);
          const end = Math.floor((i + 1) * bufLen / barCount);
          let sum = 0;
          for (let j = start; j < end; j++) sum += data[j];
          const avg = sum / Math.max(1, end - start) / 255;
          // Soft center-emphasis envelope so bass/treble extremes don't dominate
          const c = Math.abs(i / barCount - 0.5) * 2;
          return avg * (0.5 + (1 - c) * 0.5);
        });
      } else if (active) {
        // Animated idle wave (no analyser yet)
        rawHeights = Array.from({ length: barCount }, (_, i) => {
          const c = Math.abs(i / barCount - 0.5) * 2;
          return Math.max(0.04, 0.18 + Math.sin(simTime + i * 0.4) * 0.12 + (1 - c) * 0.15);
        });
      } else {
        // Flat line when muted or disconnected
        rawHeights = Array(barCount).fill(0.04);
      }

      // Smooth bars toward target
      const bars = barsRef.current;
      for (let i = 0; i < barCount; i++) {
        bars[i] += (rawHeights[i] - bars[i]) * 0.2;
      }

      ctx2d.clearRect(0, 0, W, H);
      const barW = Math.max(2, Math.floor((W - (barCount - 1) * 2.5) / barCount));

      for (let i = 0; i < barCount; i++) {
        const barH = Math.max(2, bars[i] * H * 0.9);
        const x = i * (barW + 2.5);
        const y = (H - barH) / 2;
        const r = Math.min(barW / 2, 2.5);

        const alpha = 0.35 + bars[i] * 0.65;
        const grad = ctx2d.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, `rgba(74,222,128,${Math.min(1, alpha + 0.2)})`);
        grad.addColorStop(1, `rgba(34,197,94,${Math.min(1, alpha - 0.1)})`);
        ctx2d.fillStyle = grad;

        ctx2d.beginPath();
        ctx2d.moveTo(x + r, y);
        ctx2d.lineTo(x + barW - r, y);
        ctx2d.arcTo(x + barW, y, x + barW, y + r, r);
        ctx2d.lineTo(x + barW, y + barH - r);
        ctx2d.arcTo(x + barW, y + barH, x + barW - r, y + barH, r);
        ctx2d.lineTo(x + r, y + barH);
        ctx2d.arcTo(x, y + barH, x, y + barH - r, r);
        ctx2d.lineTo(x, y + r);
        ctx2d.arcTo(x, y, x + r, y, r);
        ctx2d.closePath();
        ctx2d.fill();
      }
    };

    draw();
    return () => { cancelAnimationFrame(rafRef.current); };
  }, [active, barCount, height, audioStream]); // re-init canvas when stream arrives

  return (
    <div ref={containerRef} style={{ width: '100%', height: `${height}px` }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: `${height}px`, display: 'block' }} />
    </div>
  );
}

// ── Video attachment ─────────────────────────────────────────────────────────
function VideoTile({ track, muted = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { try { track.detach(el); } catch {} };
  }, [track]);
  return (
    <video ref={ref} autoPlay playsInline muted={muted}
      style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#0a0d16' }} />
  );
}

function AudioRenderer({ track }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { try { track.detach(el); } catch {} };
  }, [track]);
  return <audio ref={ref} autoPlay style={{ display: 'none' }} />;
}

// ── Audio avatar (audio-call mode) ───────────────────────────────────────────
function AudioAvatar({ name, isMuted, isSpeaking, isLocal, size = 52 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
      <div style={{
        width: `${size}px`, height: `${size}px`, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(74,222,128,0.18), rgba(34,197,94,0.07))',
        border: `2px solid ${isSpeaking ? 'rgba(74,222,128,0.75)' : 'rgba(255,255,255,0.1)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: isSpeaking ? '#4ade80' : 'rgba(255,255,255,0.7)',
        fontWeight: '700', fontSize: `${Math.round(size * 0.27)}px`,
        boxShadow: isSpeaking ? '0 0 18px rgba(74,222,128,0.3)' : 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        position: 'relative',
      }}>
        {initials(name)}
        {isMuted && (
          <div style={{
            position: 'absolute', bottom: '-2px', right: '-2px',
            width: '16px', height: '16px', borderRadius: '50%',
            background: 'rgba(239,68,68,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23"/>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
            </svg>
          </div>
        )}
      </div>
      <span style={{
        fontSize: '11px', fontWeight: '600', color: 'rgba(255,255,255,0.45)',
        maxWidth: `${size + 8}px`, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', textAlign: 'center',
      }}>
        {isLocal ? 'You' : name.split(' ')[0]}
      </span>
    </div>
  );
}

// ── Video participant tile ────────────────────────────────────────────────────
function VideoTileCard({ name, videoTrack, isMuted, isSpeaking, isLocal, fillHeight = false }) {
  return (
    <div style={{
      position: 'relative', borderRadius: '12px', overflow: 'hidden',
      background: '#0a0d16',
      ...(fillHeight ? { height: '100%' } : { aspectRatio: '16/9' }),
      border: `1.5px solid ${isSpeaking ? 'rgba(74,222,128,0.55)' : 'rgba(255,255,255,0.05)'}`,
      transition: 'border-color 0.2s',
    }}>
      {videoTrack
        ? <VideoTile track={videoTrack} muted={isLocal} />
        : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '50%',
              background: 'rgba(74,222,128,0.1)', border: '2px solid rgba(74,222,128,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#4ade80', fontWeight: '700', fontSize: '16px',
            }}>{initials(name)}</div>
          </div>
        )
      }
      <div style={{
        position: 'absolute', bottom: '7px', left: '7px',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        borderRadius: '6px', padding: '2px 8px',
        fontSize: '11px', fontWeight: '600', color: 'rgba(255,255,255,0.85)',
        display: 'flex', alignItems: 'center', gap: '4px',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        {isMuted && <span style={{ color: '#f87171', fontSize: '10px' }}>⊘</span>}
        {name}{isLocal ? ' (You)' : ''}
      </div>
    </div>
  );
}

// ── Control button ────────────────────────────────────────────────────────────
function CtrlBtn({ title, danger, active, muted, onClick, children, size = 42 }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={title} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: `${size}px`, height: `${size}px`, borderRadius: '50%', border: 'none',
        cursor: 'pointer', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
        background: danger
          ? (hover ? 'rgba(220,38,38,0.95)' : 'rgba(239,68,68,0.85)')
          : muted
          ? (hover ? 'rgba(239,68,68,0.28)' : 'rgba(239,68,68,0.18)')
          : active
          ? (hover ? 'rgba(74,222,128,0.25)' : 'rgba(74,222,128,0.15)')
          : (hover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'),
        color: danger ? '#fff' : muted ? '#f87171' : active ? '#4ade80' : 'rgba(255,255,255,0.8)',
        boxShadow: danger ? '0 4px 18px rgba(239,68,68,0.4)' : 'none',
        backdropFilter: 'blur(8px)',
      }}
    >{children}</button>
  );
}

const glass = {
  background: 'rgba(10, 13, 22, 0.88)',
  backdropFilter: 'blur(28px) saturate(180%)',
  WebkitBackdropFilter: 'blur(28px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.09)',
  boxShadow: '0 32px 64px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04)',
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function CallRoom({
  token, roomName, livekitUrl, callType, isHost,
  callId, collaborators, pendingJoinRequests,
  onAcceptJoin, onRejectJoin, onInvite, onEnd,
  socket, currentUser,
}) {
  const [participants, setParticipants] = useState([]);
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [localAudioStream, setLocalAudioStream] = useState(null);
  const [localMuted, setLocalMuted] = useState(false);
  const [localCameraOff, setLocalCameraOff] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState(new Set());
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 320) : 0,
    y: typeof window !== 'undefined' ? Math.max(0, window.innerHeight - 490) : 0,
  }));
  const roomRef = useRef(null);

  // ── Sync participants ─────────────────────────────────────────────
  const syncParticipants = useCallback((room) => {
    const parts = [];
    for (const p of room.remoteParticipants.values()) {
      let videoTrack = null, audioTrack = null, isMuted = true;
      for (const pub of p.trackPublications.values()) {
        if (pub.isSubscribed && pub.track) {
          if (pub.kind === Track.Kind.Video) videoTrack = pub.track;
          if (pub.kind === Track.Kind.Audio) { audioTrack = pub.track; isMuted = pub.isMuted; }
        }
      }
      parts.push({ identity: p.identity, name: p.name || p.identity, videoTrack, audioTrack, isMuted });
    }
    setParticipants(parts);
  }, []);

  // ── LiveKit connection ────────────────────────────────────────────
  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const refresh = () => syncParticipants(room);

    room
      .on(RoomEvent.Connected, () => setIsConnected(true))
      .on(RoomEvent.Disconnected, () => { setIsConnected(false); onEnd(); })
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setActiveSpeakers(new Set(speakers.map(s => s.identity)));
      });

    (async () => {
      try {
        await room.connect(livekitUrl, token);
        await room.localParticipant.setMicrophoneEnabled(true);

        // Capture mic MediaStream for the waveform analyser
        for (const pub of room.localParticipant.trackPublications.values()) {
          if (pub.kind === Track.Kind.Audio && pub.track?.mediaStreamTrack) {
            setLocalAudioStream(new MediaStream([pub.track.mediaStreamTrack]));
            break;
          }
        }

        if (callType === 'video') {
          await room.localParticipant.setCameraEnabled(true);
          for (const pub of room.localParticipant.trackPublications.values()) {
            if (pub.kind === Track.Kind.Video && pub.track) { setLocalVideoTrack(pub.track); break; }
          }
        }
      } catch (err) {
        setError(err.message || 'Failed to connect');
      }
    })();

    return () => { room.disconnect(); };
  }, [token, livekitUrl, callType, syncParticipants, onEnd]);

  // ── Controls ──────────────────────────────────────────────────────
  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !localMuted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setLocalMuted(next);
  }, [localMuted]);

  const toggleCamera = useCallback(async () => {
    if (callType !== 'video') return;
    const room = roomRef.current;
    if (!room) return;
    const next = !localCameraOff;
    await room.localParticipant.setCameraEnabled(!next);
    if (!next) {
      for (const pub of room.localParticipant.trackPublications.values()) {
        if (pub.kind === Track.Kind.Video && pub.track) { setLocalVideoTrack(pub.track); break; }
      }
    } else {
      setLocalVideoTrack(null);
    }
    setLocalCameraOff(next);
  }, [localCameraOff, callType]);

  const handleEnd = useCallback(() => {
    if (isHost) socket?.emit('call:end', { callId });
    roomRef.current?.disconnect();
    onEnd();
  }, [isHost, socket, callId, onEnd]);

  // ── Drag ──────────────────────────────────────────────────────────
  const startDrag = useCallback((e) => {
    if (isFullscreen) return;
    const startX = e.clientX, startY = e.clientY;
    const origX = pos.x, origY = pos.y;
    const onMove = (ev) => {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 290, origX + ev.clientX - startX)),
        y: Math.max(0, Math.min(window.innerHeight - 120, origY + ev.clientY - startY)),
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  }, [isFullscreen, pos.x, pos.y]);

  // ── Computed values ───────────────────────────────────────────────
  const inCallIds = new Set([currentUser?.id, ...participants.map(p => p.identity)]);
  const uninvited = (collaborators || []).filter(c => c.userId && !inCallIds.has(c.userId));
  const totalInCall = participants.length + 1;
  const localSpeaking = activeSpeakers.has(currentUser?.id);

  // ── Shared controls bar ───────────────────────────────────────────
  const ControlsBar = ({ large = false }) => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: large ? '14px' : '10px',
      padding: large ? '18px 24px' : '10px 14px 14px',
    }}>
      <CtrlBtn title={localMuted ? 'Unmute' : 'Mute'} active={!localMuted} muted={localMuted} onClick={toggleMute} size={large ? 50 : 42}>
        {localMuted ? <MicOffIcon /> : <MicIcon />}
      </CtrlBtn>
      {callType === 'video' && (
        <CtrlBtn title={localCameraOff ? 'Camera on' : 'Camera off'} active={!localCameraOff} muted={localCameraOff} onClick={toggleCamera} size={large ? 50 : 42}>
          {localCameraOff ? <CamOffIcon /> : <CamIcon />}
        </CtrlBtn>
      )}
      {isHost && (
        <CtrlBtn title="Invite to call" active={showInvite} onClick={() => setShowInvite(v => !v)} size={large ? 50 : 42}>
          <UserPlusIcon />
        </CtrlBtn>
      )}
      <CtrlBtn title={isHost ? 'End call for everyone' : 'Leave call'} danger onClick={handleEnd} size={large ? 56 : 42}>
        <EndCallIcon />
      </CtrlBtn>
    </div>
  );

  // ── Fullscreen ────────────────────────────────────────────────────
  if (isFullscreen) {
    const cols = totalInCall === 1 ? 1 : totalInCall <= 2 ? 2 : totalInCall <= 4 ? 2 : 3;
    const rows = Math.ceil(totalInCall / cols);

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(5, 7, 15, 0.97)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          display: 'flex', flexDirection: 'column',
          fontFamily: 'inherit',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '18px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)', gap: '12px', flexShrink: 0,
        }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
            background: isConnected ? '#4ade80' : '#f59e0b',
            boxShadow: isConnected ? '0 0 10px #4ade8088' : 'none',
            animation: isConnected ? 'bj-call-pulse 2s ease-in-out infinite' : 'none',
          }} />
          <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '700', fontSize: '15px', flex: 1 }}>
            {callType === 'video' ? 'Video' : 'Audio'} Call
            {!isConnected && <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: '400' }}> · Connecting…</span>}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>
            {totalInCall} {totalInCall === 1 ? 'person' : 'people'}
          </span>
          <button
            onClick={() => setIsFullscreen(false)}
            style={{
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px', padding: '6px 12px', color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', fontWeight: '600',
            }}
          >
            <MinimizeIcon /> Minimize
          </button>
        </div>

        {error && (
          <div style={{ padding: '8px 24px', color: '#f87171', fontSize: '12px', background: 'rgba(239,68,68,0.07)', flexShrink: 0 }}>
            ⚠ {error}
          </div>
        )}

        {/* Body — fills all remaining height */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: '16px', minHeight: 0 }}>
          {callType === 'video' ? (
            // Video: adaptive grid fills the body completely
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
              gap: '10px',
              width: '100%',
              height: '100%',
              flex: 1,
              minHeight: 0,
            }}>
              <VideoTileCard
                name={currentUser?.name || 'You'}
                videoTrack={localCameraOff ? null : localVideoTrack}
                isMuted={localMuted} isSpeaking={localSpeaking} isLocal fillHeight
              />
              {participants.map(p => (
                <React.Fragment key={p.identity}>
                  <VideoTileCard
                    name={p.name} videoTrack={p.videoTrack}
                    isMuted={p.isMuted} isSpeaking={activeSpeakers.has(p.identity)} isLocal={false} fillHeight
                  />
                  {p.audioTrack && <AudioRenderer track={p.audioTrack} />}
                </React.Fragment>
              ))}
            </div>
          ) : (
            // Audio: centered layout
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', flex: 1, gap: '40px', width: '100%', maxWidth: '640px', margin: '0 auto',
            }}>
              <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <AudioAvatar name={currentUser?.name || 'You'} isMuted={localMuted} isSpeaking={localSpeaking} isLocal size={88} />
                {participants.map(p => (
                  <React.Fragment key={p.identity}>
                    <AudioAvatar name={p.name} isMuted={p.isMuted} isSpeaking={activeSpeakers.has(p.identity)} isLocal={false} size={88} />
                    {p.audioTrack && <AudioRenderer track={p.audioTrack} />}
                  </React.Fragment>
                ))}
              </div>
              <div style={{ width: '100%', padding: '20px 24px', background: 'rgba(255,255,255,0.03)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <AudioWaveform audioStream={localAudioStream} active={isConnected && !localMuted} barCount={40} height={56} />
              </div>
              {participants.length === 0 && isConnected && (
                <div style={{ color: 'rgba(255,255,255,0.22)', fontSize: '14px', fontWeight: '500' }}>
                  Waiting for others to join…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Join requests */}
        {isHost && pendingJoinRequests?.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '0 24px 12px', flexShrink: 0 }}>
            {pendingJoinRequests.map(req => (
              <JoinRequest key={req.requesterId} req={req} onAccept={() => onAcceptJoin(req)} onReject={() => onRejectJoin(req)} />
            ))}
          </div>
        )}

        {/* Invite panel */}
        <AnimatePresence>
          {showInvite && uninvited.length > 0 && (
            <motion.div
              initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.2 }}
              style={{
                position: 'absolute', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(10,13,22,0.96)', backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '18px',
                padding: '16px', minWidth: '220px', maxWidth: '300px',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '10px' }}>Invite</div>
              {uninvited.map(c => <InviteRow key={c.userId} name={c.name} onInvite={() => { onInvite(c.userId); setShowInvite(false); }} />)}
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <ControlsBar large />
        </div>
      </motion.div>
    );
  }

  // ── Mini floating window ──────────────────────────────────────────
  const miniW = callType === 'video' ? 310 : 284;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: 'fixed', left: `${pos.x}px`, top: `${pos.y}px`,
        width: `${miniW}px`, zIndex: 9999,
        borderRadius: '20px', overflow: 'hidden',
        fontFamily: 'inherit', userSelect: 'none', ...glass,
      }}
    >
      {/* Header / drag handle */}
      <div
        onMouseDown={startDrag}
        style={{
          padding: '12px 14px 10px',
          display: 'flex', alignItems: 'center', gap: '8px',
          borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'grab',
        }}
      >
        <span style={{ color: 'rgba(255,255,255,0.2)', display: 'flex', flexShrink: 0 }}><GripIcon /></span>
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
          background: isConnected ? '#4ade80' : '#f59e0b',
          boxShadow: isConnected ? '0 0 8px #4ade8077' : 'none',
          animation: isConnected ? 'bj-call-pulse 2s ease-in-out infinite' : 'none',
        }} />
        <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: '13px', flex: 1 }}>
          {callType === 'video' ? 'Video' : 'Audio'} Call
          {!isConnected && <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: '400', fontSize: '11px' }}> · Connecting</span>}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', fontWeight: '600', flexShrink: 0 }}>{totalInCall}p</span>
        <button
          title="Fullscreen" onClick={() => setIsFullscreen(true)}
          style={{
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px', padding: '4px', cursor: 'pointer',
            color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <MaximizeIcon />
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 14px', color: '#f87171', fontSize: '12px', background: 'rgba(239,68,68,0.07)' }}>
          ⚠ {error}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: '12px 12px 0' }}>
        {callType === 'video' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
            <VideoTileCard name={currentUser?.name || 'You'} videoTrack={localCameraOff ? null : localVideoTrack} isMuted={localMuted} isSpeaking={localSpeaking} isLocal />
            {participants.map(p => (
              <React.Fragment key={p.identity}>
                <VideoTileCard name={p.name} videoTrack={p.videoTrack} isMuted={p.isMuted} isSpeaking={activeSpeakers.has(p.identity)} isLocal={false} />
                {p.audioTrack && <AudioRenderer track={p.audioTrack} />}
              </React.Fragment>
            ))}
            {participants.length === 0 && isConnected && (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '12px', padding: '16px 0', fontWeight: '600' }}>
                Waiting for others…
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', paddingBottom: '10px' }}>
              <AudioAvatar name={currentUser?.name || 'You'} isMuted={localMuted} isSpeaking={localSpeaking} isLocal size={48} />
              {participants.map(p => (
                <React.Fragment key={p.identity}>
                  <AudioAvatar name={p.name} isMuted={p.isMuted} isSpeaking={activeSpeakers.has(p.identity)} isLocal={false} size={48} />
                  {p.audioTrack && <AudioRenderer track={p.audioTrack} />}
                </React.Fragment>
              ))}
            </div>
            <div style={{ padding: '6px 4px 10px' }}>
              <AudioWaveform audioStream={localAudioStream} active={isConnected && !localMuted} barCount={22} height={44} />
            </div>
            {participants.length === 0 && isConnected && (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '11px', fontWeight: '600', paddingBottom: '8px' }}>
                Waiting for others…
              </div>
            )}
          </>
        )}
      </div>

      {/* Join requests (host) */}
      {isHost && pendingJoinRequests?.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ fontSize: '10px', fontWeight: '700', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '2px' }}>Requests</div>
          {pendingJoinRequests.map(req => (
            <JoinRequest key={req.requesterId} req={req} onAccept={() => onAcceptJoin(req)} onReject={() => onRejectJoin(req)} />
          ))}
        </div>
      )}

      {/* Invite panel */}
      <AnimatePresence>
        {showInvite && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }}
            style={{ overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: '10px', fontWeight: '700', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Invite</div>
              {uninvited.length === 0
                ? <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', fontWeight: '500', padding: '2px 0' }}>Everyone is already in.</div>
                : uninvited.map(c => <InviteRow key={c.userId} name={c.name} onInvite={() => { onInvite(c.userId); setShowInvite(false); }} />)
              }
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <ControlsBar />
      </div>
    </motion.div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function JoinRequest({ req, onAccept, onReject }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px',
      borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        background: 'rgba(74,222,128,0.1)', border: '1.5px solid rgba(74,222,128,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#4ade80', fontWeight: '700', fontSize: '11px',
      }}>{initials(req.requesterName)}</div>
      <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px', flex: 1, fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {req.requesterName}
      </span>
      <button onClick={onAccept} title="Accept"
        style={{ background: 'rgba(74,222,128,0.85)', color: '#000', border: 'none', borderRadius: '7px', padding: '4px 10px', fontWeight: '800', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
        <CheckIcon />
      </button>
      <button onClick={onReject} title="Decline"
        style={{ background: 'rgba(255,255,255,0.06)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '7px', padding: '4px 10px', fontWeight: '800', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
        <XIcon />
      </button>
    </div>
  );
}

function InviteRow({ name, onInvite }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onInvite}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
        padding: '7px 6px', background: hover ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: 'none', borderRadius: '10px', cursor: 'pointer',
        color: 'rgba(255,255,255,0.8)', fontSize: '13px', fontWeight: '600',
        transition: 'background 0.12s',
      }}
    >
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        background: 'rgba(74,222,128,0.1)', border: '1.5px solid rgba(74,222,128,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#4ade80', fontWeight: '700', fontSize: '11px',
      }}>{initials(name)}</div>
      {name}
    </button>
  );
}
