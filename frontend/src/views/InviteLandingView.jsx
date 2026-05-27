import React from 'react';
import { motion } from 'framer-motion'; // eslint-disable-line no-unused-vars

export default function InviteLandingView({ inviteToken: _inviteToken, onAccept }) { // eslint-disable-line no-unused-vars
  // In a real app, we would fetch the invite details from the backend using the token.
  // For now, we use mock data to demonstrate the UX.
  const inviterName = 'Priya Sharma';
  const projectTitle = 'Design Sprint Q3';

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Decorative background blobs */}
      <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '50vw', height: '50vw', background: 'var(--accent)', filter: 'blur(100px)', opacity: 0.1, borderRadius: '50%' }}></div>
      <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '40vw', height: '40vw', background: '#6366f1', filter: 'blur(100px)', opacity: 0.1, borderRadius: '50%' }}></div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        style={{
          background: 'var(--surface)',
          padding: '48px',
          borderRadius: '32px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
          border: '1px solid var(--border)',
          maxWidth: '480px',
          width: '90%',
          textAlign: 'center',
          position: 'relative',
          zIndex: 1
        }}
      >
        <div style={{ fontSize: '48px', marginBottom: '24px' }}>🧠✨</div>
        <h1 style={{ fontSize: '28px', fontWeight: '800', letterSpacing: '-1px', marginBottom: '16px', lineHeight: '1.2' }}>
          You've been invited to peek inside <span style={{ color: 'var(--accent)' }}>{inviterName}'s</span> brain.
        </h1>
        <p style={{ fontSize: '16px', color: 'var(--muted)', marginBottom: '32px', lineHeight: '1.5' }}>
          They want to collaborate with you on <strong style={{ color: 'var(--text)' }}>{projectTitle}</strong>. 
          Ready to jump in and get things done?
        </p>
        
        <button
          onClick={onAccept}
          style={{
            background: 'var(--text)',
            color: 'var(--bg)',
            border: 'none',
            padding: '16px 32px',
            borderRadius: '16px',
            fontSize: '16px',
            fontWeight: '800',
            cursor: 'pointer',
            width: '100%',
            transition: 'transform 0.2s',
          }}
          onMouseOver={e => e.currentTarget.style.transform = 'scale(1.02)'}
          onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          Accept & Join Workspace
        </button>
      </motion.div>
    </div>
  );
}
