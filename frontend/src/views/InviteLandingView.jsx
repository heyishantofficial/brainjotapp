import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../api';

export default function InviteLandingView({ inviteToken, onAccept }) {
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState('');

  const handleJoin = async () => {
    setStatus('loading');
    setErrMsg('');
    const r = await api('join_via_link', { token: inviteToken });
    if (r?.ok) {
      setResult(r);
      setStatus('success');
      setTimeout(() => onAccept(r), 1200);
    } else {
      setErrMsg(r?.error || 'Invalid or expired invite link.');
      setStatus('error');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '50vw', height: '50vw', background: 'var(--accent)', filter: 'blur(100px)', opacity: 0.1, borderRadius: '50%' }} />
      <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '40vw', height: '40vw', background: '#6366f1', filter: 'blur(100px)', opacity: 0.1, borderRadius: '50%' }} />
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        style={{ background: 'var(--surface)', padding: '48px', borderRadius: '32px', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', border: '1px solid var(--border)', maxWidth: '480px', width: '90%', textAlign: 'center', position: 'relative', zIndex: 1 }}
      >
        <div style={{ fontSize: '48px', marginBottom: '24px' }}>{status === 'success' ? '🎉' : '🧠✨'}</div>
        {status === 'success' ? (
          <>
            <h1 style={{ fontSize: '26px', fontWeight: '800', letterSpacing: '-0.5px', marginBottom: '12px' }}>You're in!</h1>
            <p style={{ color: 'var(--muted)', fontSize: '15px', lineHeight: 1.5 }}>
              Joined <strong style={{ color: 'var(--text)' }}>{result.entityTitle}</strong> as{' '}
              <span style={{ color: 'var(--accent)', fontWeight: '700' }}>{result.role}</span>.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '28px', fontWeight: '800', letterSpacing: '-1px', marginBottom: '16px', lineHeight: '1.2' }}>
              You've been invited to collaborate on{' '}
              <span style={{ color: 'var(--accent)' }}>BrainJot</span>
            </h1>
            <p style={{ fontSize: '15px', color: 'var(--muted)', marginBottom: '32px', lineHeight: '1.5' }}>
              Click below to accept and start collaborating.
            </p>
            {errMsg && (
              <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '16px', fontWeight: '600', padding: '10px 14px', background: 'rgba(239,68,68,0.08)', borderRadius: '10px' }}>
                {errMsg}
              </div>
            )}
            <button
              onClick={handleJoin}
              disabled={status === 'loading'}
              style={{ background: 'var(--text)', color: 'var(--bg)', border: 'none', padding: '16px 32px', borderRadius: '16px', fontSize: '16px', fontWeight: '800', cursor: status === 'loading' ? 'default' : 'pointer', width: '100%', opacity: status === 'loading' ? 0.7 : 1, transition: 'transform 0.2s' }}
              onMouseOver={e => { if (status !== 'loading') e.currentTarget.style.transform = 'scale(1.02)'; }}
              onMouseOut={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {status === 'loading' ? 'Joining…' : 'Accept & Join'}
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
