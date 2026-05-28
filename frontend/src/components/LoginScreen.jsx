import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function LoginScreen({ onLoginSuccess }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState(null); // null | 'checking' | 'available' | 'taken' | string (error)
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  // Auto-suggest username from name
  useEffect(() => {
    if (mode === 'register' && name && !username) {
      const suggested = name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9_]/g, '').slice(0, 20);
      if (suggested.length >= 3) setUsername(suggested);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Debounced availability check
  useEffect(() => {
    if (mode !== 'register' || !username) { setUsernameStatus(null); return; }
    clearTimeout(debounceRef.current);
    setUsernameStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api('check_username', null, 'GET', `&username=${encodeURIComponent(username)}`);
        if (r.error) setUsernameStatus(r.error);
        else setUsernameStatus(r.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus(null);
      }
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [username, mode]);

  const doSubmit = async () => {
    setError('');
    if (mode === 'register') {
      if (usernameStatus !== 'available') { setError('Please choose a valid, available username'); return; }
    }
    setLoading(true);
    try {
      const body = mode === 'register' ? { name, email, password, username } : { email, password };
      const r = await api(mode, body);
      if (r.ok) {
        onLoginSuccess(r.user);
      } else {
        setError(r.error || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next) => { setMode(next); setError(''); setUsernameStatus(null); };

  const unHint = (() => {
    if (!username || mode !== 'register') return null;
    if (usernameStatus === 'checking') return { color: 'var(--muted)', text: 'Checking…' };
    if (usernameStatus === 'available') return { color: '#10b981', text: '✓ @' + username + ' is available' };
    if (usernameStatus === 'taken') return { color: '#ef4444', text: '✕ @' + username + ' is taken' };
    if (typeof usernameStatus === 'string') return { color: '#ef4444', text: usernameStatus };
    return null;
  })();

  return (
    <div id="login-screen">
      <div className="login-box">
        <div className="login-year">BJ</div>
        <div className="login-title">
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
        </div>
        <div className="login-sub">
          {mode === 'login' ? 'Sign in to your workspace.' : 'Get started with BrainJot.'}
        </div>

        {mode === 'register' && (
          <div className="field">
            <label>Name</label>
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <label>Email</label>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Password</label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !mode === 'register' && doSubmit()}
          />
        </div>

        {mode === 'register' && (
          <div className="field">
            <label>Username</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: '14px', fontWeight: '700', pointerEvents: 'none' }}>@</span>
              <input
                type="text"
                placeholder="yourhandle"
                value={username}
                style={{ paddingLeft: '26px' }}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                onKeyDown={e => e.key === 'Enter' && doSubmit()}
              />
            </div>
            {unHint && (
              <div style={{ fontSize: '12px', color: unHint.color, marginTop: '4px', fontWeight: '600' }}>{unHint.text}</div>
            )}
            <div style={{ fontSize: '11px', color: 'var(--faint)', marginTop: '4px' }}>
              This is your permanent unique handle in BrainJot — choose wisely.
            </div>
          </div>
        )}

        <button className="btn-primary" onClick={doSubmit} disabled={loading}>
          {loading ? '...' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        {error && <div className="login-err" style={{ display: 'block' }}>{error}</div>}

        <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
          {mode === 'login' ? (
            <>
              No account?{' '}
              <button
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                onClick={() => switchMode('register')}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                onClick={() => switchMode('login')}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
