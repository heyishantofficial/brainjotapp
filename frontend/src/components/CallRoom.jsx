import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { AnimatePresence, motion } from 'framer-motion';

const initials = (n = '') =>
  n.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';

// Attaches a single video track to a <video> element via useEffect
function VideoTile({ track, muted = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { try { track.detach(el); } catch {} };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px', background: '#111' }}
    />
  );
}

// Attaches a remote audio track to a hidden <audio> element
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

// A single participant row for audio-only calls
function AudioParticipantRow({ name, isMuted, isLocal }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '8px 10px', borderRadius: '12px', background: '#161b22',
    }}>
      <div style={{
        width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
        background: '#22c55e18', border: '2px solid #22c55e33',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#22c55e', fontWeight: '700', fontSize: '13px',
      }}>{initials(name)}</div>
      <span style={{ color: '#e6edf3', fontWeight: '600', fontSize: '13px', flex: 1 }}>
        {name}{isLocal && <span style={{ color: '#6b7280', fontWeight: '400' }}> (You)</span>}
      </span>
      {isMuted && <span style={{ fontSize: '13px' }}>🔇</span>}
    </div>
  );
}

// A single participant tile for video calls
function VideoParticipantTile({ name, videoTrack, isMuted, isLocal }) {
  return (
    <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', background: '#111', aspectRatio: '16/9' }}>
      {videoTrack
        ? <VideoTile track={videoTrack} muted={isLocal} />
        : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#161b22',
          }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '50%',
              background: '#22c55e18', border: '2px solid #22c55e33',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#22c55e', fontWeight: '700', fontSize: '16px',
            }}>{initials(name)}</div>
          </div>
        )
      }
      <div style={{
        position: 'absolute', bottom: '6px', left: '6px',
        background: 'rgba(0,0,0,0.65)', borderRadius: '7px',
        padding: '3px 8px', fontSize: '11px', fontWeight: '600', color: '#fff',
        display: 'flex', alignItems: 'center', gap: '4px',
      }}>
        {isMuted && <span>🔇</span>}
        {name}{isLocal && ' (You)'}
      </div>
    </div>
  );
}

// Control button
function CtrlBtn({ title, active, danger, onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '40px', height: '40px', borderRadius: '50%', border: 'none',
        cursor: 'pointer', fontSize: '16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: danger
          ? (hover ? '#dc262680' : '#ef444433')
          : active
            ? (hover ? '#22c55e44' : '#22c55e22')
            : (hover ? '#374151' : '#1f2937'),
        transition: 'background 0.15s',
      }}
    >
      {children}
    </button>
  );
}

export default function CallRoom({
  token, roomName, livekitUrl, callType, isHost,
  projectId, collaborators, pendingJoinRequests,
  onAcceptJoin, onRejectJoin, onInvite, onEnd,
  socket, currentUser,
}) {
  const [participants, setParticipants] = useState([]); // { identity, name, videoTrack, audioTrack, isMuted }
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [localMuted, setLocalMuted] = useState(false);
  const [localCameraOff, setLocalCameraOff] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const roomRef = useRef(null);

  // Build participant list from room state
  const syncParticipants = useCallback((room) => {
    const parts = [];
    for (const p of room.remoteParticipants.values()) {
      let videoTrack = null;
      let audioTrack = null;
      let isMuted = true;
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
      .on(RoomEvent.TrackUnmuted, refresh);

    (async () => {
      try {
        await room.connect(livekitUrl, token);

        // Enable mic always; camera only for video calls
        await room.localParticipant.setMicrophoneEnabled(true);
        if (callType === 'video') {
          await room.localParticipant.setCameraEnabled(true);
          // Grab local video track reference for preview
          for (const pub of room.localParticipant.trackPublications.values()) {
            if (pub.kind === Track.Kind.Video && pub.track) {
              setLocalVideoTrack(pub.track);
              break;
            }
          }
        }
      } catch (err) {
        setError(err.message || 'Failed to connect to call');
      }
    })();

    return () => { room.disconnect(); };
  }, [token, livekitUrl, callType, syncParticipants, onEnd]);

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
    if (isHost) socket?.emit('call:end', { projectId });
    roomRef.current?.disconnect();
    onEnd();
  }, [isHost, socket, projectId, onEnd]);

  // Collaborators not yet in the call (for invite list)
  const inCallIds = new Set([currentUser?.id, ...participants.map(p => p.identity)]);
  const uninvited = (collaborators || []).filter(c => c.userId && !inCallIds.has(c.userId));

  const totalInCall = participants.length + 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.94 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        width: callType === 'video' ? '300px' : '272px',
        background: '#0d1117',
        border: '1px solid rgba(34,197,94,0.2)',
        borderRadius: '20px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(34,197,94,0.06)',
        zIndex: 9999,
        overflow: 'hidden',
        fontFamily: 'inherit',
      }}
    >
      {/* ── Header ── */}
      <div style={{
        padding: '14px 16px 10px',
        display: 'flex', alignItems: 'center', gap: '10px',
        borderBottom: '1px solid rgba(34,197,94,0.12)',
      }}>
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
          background: isConnected ? '#22c55e' : '#f59e0b',
          boxShadow: isConnected ? '0 0 8px #22c55e80' : 'none',
          animation: isConnected ? 'bj-call-pulse 2s ease-in-out infinite' : 'none',
        }} />
        <span style={{ color: '#e6edf3', fontWeight: '700', fontSize: '13px', flex: 1 }}>
          {isConnected
            ? `${callType === 'video' ? '📹' : '🎤'} ${callType === 'video' ? 'Video' : 'Audio'} Call`
            : 'Connecting…'}
        </span>
        <span style={{ color: '#6b7280', fontSize: '12px', fontWeight: '600' }}>
          {totalInCall} {totalInCall === 1 ? 'person' : 'people'}
        </span>
      </div>

      {error && (
        <div style={{ padding: '10px 16px', color: '#f87171', fontSize: '13px', background: '#1f0a0a', borderBottom: '1px solid #2d1010' }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Participant list ── */}
      <div style={{ padding: '10px', maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Local participant */}
        {callType === 'video'
          ? <VideoParticipantTile name={currentUser?.name || 'You'} videoTrack={localCameraOff ? null : localVideoTrack} isMuted={localMuted} isLocal />
          : <AudioParticipantRow name={currentUser?.name || 'You'} isMuted={localMuted} isLocal />
        }

        {/* Remote participants */}
        {participants.map(p => (
          <React.Fragment key={p.identity}>
            {callType === 'video'
              ? <VideoParticipantTile name={p.name} videoTrack={p.videoTrack} isMuted={p.isMuted} isLocal={false} />
              : <AudioParticipantRow name={p.name} isMuted={p.isMuted} isLocal={false} />
            }
            {p.audioTrack && <AudioRenderer track={p.audioTrack} />}
          </React.Fragment>
        ))}

        {participants.length === 0 && !error && isConnected && (
          <div style={{ textAlign: 'center', color: '#4b5563', fontSize: '12px', padding: '12px 0', fontWeight: '600' }}>
            Waiting for others to join…
          </div>
        )}
      </div>

      {/* ── Pending join requests (host only) ── */}
      {isHost && pendingJoinRequests?.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(34,197,94,0.12)', padding: '8px 10px' }}>
          <div style={{ color: '#6b7280', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
            Join Requests
          </div>
          {pendingJoinRequests.map(req => (
            <div key={req.requesterId} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '7px 8px', borderRadius: '10px', background: '#161b22', marginBottom: '4px',
            }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                background: '#22c55e18', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#22c55e', fontWeight: '700', fontSize: '11px',
              }}>{initials(req.requesterName)}</div>
              <span style={{ color: '#e6edf3', fontSize: '12px', flex: 1, fontWeight: '600' }}>
                {req.requesterName}
              </span>
              <button
                onClick={() => onAcceptJoin(req)}
                title="Accept"
                style={{ background: '#22c55e', color: '#000', border: 'none', borderRadius: '7px', padding: '4px 10px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
              >✓</button>
              <button
                onClick={() => onRejectJoin(req)}
                title="Decline"
                style={{ background: '#1f2937', color: '#f87171', border: 'none', borderRadius: '7px', padding: '4px 10px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Invite panel (host only, slides open) ── */}
      <AnimatePresence>
        {showInvite && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden', borderTop: '1px solid rgba(34,197,94,0.12)' }}
          >
            <div style={{ padding: '8px 10px' }}>
              <div style={{ color: '#6b7280', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
                Invite to call
              </div>
              {uninvited.length === 0 ? (
                <div style={{ color: '#4b5563', fontSize: '12px', padding: '4px 0', fontWeight: '600' }}>Everyone is already in the call.</div>
              ) : uninvited.map(c => (
                <InviteRow key={c.userId} name={c.name} onInvite={() => { onInvite(c.userId); setShowInvite(false); }} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Controls ── */}
      <div style={{
        padding: '10px 14px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
        borderTop: '1px solid #161b22',
      }}>
        <CtrlBtn title={localMuted ? 'Unmute' : 'Mute'} active={!localMuted} onClick={toggleMute}>
          {localMuted ? '🔇' : '🎙️'}
        </CtrlBtn>

        {callType === 'video' && (
          <CtrlBtn title={localCameraOff ? 'Camera on' : 'Camera off'} active={!localCameraOff} onClick={toggleCamera}>
            {localCameraOff ? '📷' : '📹'}
          </CtrlBtn>
        )}

        {isHost && (
          <CtrlBtn title="Invite to call" active={showInvite} onClick={() => setShowInvite(v => !v)}>
            ➕
          </CtrlBtn>
        )}

        <CtrlBtn title={isHost ? 'End call for everyone' : 'Leave call'} danger onClick={handleEnd}>
          📵
        </CtrlBtn>
      </div>
    </motion.div>
  );
}

function InviteRow({ name, onInvite }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onInvite}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
        padding: '7px 8px', background: hover ? '#1f2937' : 'none',
        border: 'none', borderRadius: '10px', cursor: 'pointer',
        color: '#e6edf3', fontSize: '13px', fontWeight: '600',
        transition: 'background 0.12s',
      }}
    >
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%',
        background: '#22c55e18', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#22c55e', fontWeight: '700', fontSize: '11px', flexShrink: 0,
      }}>{initials(name)}</div>
      {name}
    </button>
  );
}
