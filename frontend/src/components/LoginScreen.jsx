import React, { useState } from 'react';
import { api } from '../api';

export default function LoginScreen({ onLoginSuccess }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const doSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const body = mode === 'register' ? { name, email, password } : { email, password };
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

  const switchMode = (next) => { setMode(next); setError(''); };

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
            onKeyDown={e => e.key === 'Enter' && doSubmit()}
          />
        </div>

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
