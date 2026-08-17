import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { track } from '../analytics';

const TAGLINES = [
  "Your brain, but actually organized.",
  "Your second brain. The first one's doing its best.",
  "For overthinkers who never finish anything.",
  "Because your brain has terrible storage.",
  "Notes app for people who hate notes apps.",
  "Where shower thoughts go to become actual things.",
  "Finally closing those 47 browser tabs.",
  "All your ideas. Now with 100% less forgetting.",
];

export default function LoginScreen({ onLoginSuccess, googleClientId, onOpenPrivacy, onOpenTerms }) {
  const [mode, setMode] = useState('password'); // 'password' | 'code'
  const [intent, setIntent] = useState('signin'); // copy only: 'signin' | 'signup'
  const [taglineIdx, setTaglineIdx] = useState(0);
  const [taglineVisible, setTaglineVisible] = useState(true);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [otp, setOtp] = useState('');

  const [otpSent, setOtpSent] = useState(false);
  const [emailExists, setEmailExists] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [usernameStatus, setUsernameStatus] = useState(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setTaglineVisible(false);
      setTimeout(() => {
        setTaglineIdx(i => (i + 1) % TAGLINES.length);
        setTaglineVisible(true);
      }, 600);
    }, 3800);
    return () => clearInterval(interval);
  }, []);

  // Registration only happens via emailed code — password mode is login-only
  const isRegistering = mode === 'code' && otpSent && !emailExists;

  useEffect(() => {
    if (isRegistering && name && !username) {
      const suggested = name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9_]/g, '').slice(0, 20);
      if (suggested.length >= 3) setUsername(suggested);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  useEffect(() => {
    if (!isRegistering || !username) { setUsernameStatus(null); return; }
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
  }, [username, mode, otpSent, emailExists]);

  const handleGoogleCredentialResponse = async (response) => {
    setLoading(true); setError('');
    try {
      // Consent is given by the notice printed directly under the sign-in buttons
      const r = await api('google_auth', { credential: response.credential, consentGiven: true });
      if (r.ok) {
        track(r.isNewUser ? 'signed_up' : 'logged_in', { method: 'google' });
        onLoginSuccess(r.user);
      }
      else setError(r.error || 'Google Authentication failed');
    } catch { setError('Failed to connect to server'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!googleClientId) return;
    const initGoogle = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({ client_id: googleClientId, callback: handleGoogleCredentialResponse });
        const btnEl = document.getElementById('google-signin-btn');
        if (btnEl) {
          window.google.accounts.id.renderButton(btnEl, { theme: 'filled_black', size: 'large', width: btnEl.offsetWidth || 336 });
        }
      } else setTimeout(initGoogle, 100);
    };
    initGoogle();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId, mode, otpSent]);

  const handleSendOtp = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address'); return;
    }
    setLoading(true); setError('');
    try {
      const r = await api('send_otp', { email });
      if (r.ok) { setOtpSent(true); setEmailExists(r.exists); }
      else setError(r.error || 'Failed to send the code. Please try again.');
    } catch { setError('Failed to connect to server'); }
    finally { setLoading(false); }
  };

  const handleVerifyOtp = async () => {
    if (!otp?.trim()) { setError('Enter the 6-digit code we emailed you'); return; }
    setLoading(true); setError('');
    try {
      const r = await api('verify_otp', { email, otp });
      if (r.ok) {
        if (r.exists) {
          track('logged_in', { method: 'otp' });
          onLoginSuccess(r.user);
        }
        else setEmailExists(false);
      } else setError(r.error || 'Invalid or expired code');
    } catch { setError('Failed to connect to server'); }
    finally { setLoading(false); }
  };

  const handleRegisterOtp = async () => {
    if (!name?.trim() || !username?.trim()) { setError('Name and username are required'); return; }
    if (usernameStatus !== 'available') { setError('Please choose a valid, available username'); return; }
    if (!consentGiven) { setError('You must agree to the Terms of Service and Privacy Policy'); return; }
    setLoading(true); setError('');
    try {
      const r = await api('register_otp', { email, name, username, otp, consentGiven: true });
      if (r.ok) {
        track('signed_up', { method: 'email_otp' });
        onLoginSuccess(r.user);
      }
      else setError(r.error || 'Registration failed');
    } catch { setError('Failed to connect to server'); }
    finally { setLoading(false); }
  };

  const doSubmit = async () => {
    setError('');
    if (mode === 'code') {
      if (!otpSent) await handleSendOtp();
      else if (emailExists) await handleVerifyOtp();
      else await handleRegisterOtp();
      return;
    }
    setLoading(true);
    try {
      const r = await api('login', { email, password });
      if (r.ok) {
        track('logged_in', { method: 'password' });
        onLoginSuccess(r.user);
      }
      else setError(r.error || 'Invalid email or password.');
    } finally { setLoading(false); }
  };

  const switchMode = (nextMode, nextIntent = 'signin') => {
    setMode(nextMode); setIntent(nextIntent);
    setError(''); setUsernameStatus(null);
    setOtpSent(false); setOtp(''); setConsentGiven(false);
  };

  const unHint = (() => {
    if (!username || !isRegistering) return null;
    if (usernameStatus === 'checking') return { color: 'rgba(255,255,255,0.4)', text: 'Checking…' };
    if (usernameStatus === 'available') return { color: '#6ee7b7', text: '✓ @' + username + ' is available' };
    if (usernameStatus === 'taken') return { color: '#f87171', text: '✕ @' + username + ' is taken' };
    if (typeof usernameStatus === 'string') return { color: '#f87171', text: usernameStatus };
    return null;
  })();

  const getTitle = () => {
    if (mode === 'password') return 'Sign in';
    if (isRegistering) return 'Almost done';
    if (otpSent) return 'Enter your code';
    return intent === 'signup' ? 'Create your account' : 'Sign in with a code';
  };

  const getSubtext = () => {
    if (mode === 'password') return null;
    if (isRegistering) return 'Pick a name and a handle to finish setting up.';
    if (otpSent) return `We emailed a 6-digit code to ${email}.`;
    return intent === 'signup'
      ? "We'll email you a 6-digit code — no password to remember."
      : "We'll email you a 6-digit code. No password needed.";
  };

  const getButtonText = () => {
    if (loading) return 'Please wait…';
    if (mode === 'password') return 'Sign in';
    if (isRegistering) return 'Create account';
    return otpSent ? 'Sign in' : 'Email me a code';
  };

  return (
    <div id="login-screen">
      {/* Background video */}
      <video className="lv-video-bg" src="/bg-video.mp4" autoPlay loop muted playsInline />
      <div className="lv-overlay" />

      {/* Auth card */}
      <div className="lv-card">
        {/* Brand */}
        <div className="lv-brand">
          <span className="lv-brand-name">BrainJot</span>
          <span className="lv-brand-tag" style={{ opacity: taglineVisible ? 1 : 0, transition: 'opacity 0.6s ease' }}>{TAGLINES[taglineIdx]}</span>
        </div>

        <h2 className="lv-title">{getTitle()}</h2>
        {getSubtext() && <p className="lv-sub">{getSubtext()}</p>}

        {/* Error */}
        {error && <div className="lv-err">{error}</div>}

        <form onSubmit={e => { e.preventDefault(); doSubmit(); }}>
          {/* Email — hidden once a code is on its way */}
          {!otpSent && (
            <div className="lv-field">
              <input
                className="lv-input"
                type="email"
                placeholder="Email address"
                aria-label="Email address"
                value={email}
                autoComplete="email"
                autoFocus
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          )}

          {/* Password */}
          {mode === 'password' && (
            <div className="lv-field">
              <div className="lv-field-pass">
                <input
                  className="lv-input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  aria-label="Password"
                  value={password}
                  autoComplete="current-password"
                  onChange={e => setPassword(e.target.value)}
                />
                <button type="button" className="lv-eye" onClick={() => setShowPassword(v => !v)} tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>
          )}

          {/* Forgot password → emailed code, which is the actual recovery path */}
          {mode === 'password' && (
            <div className="lv-row-end">
              <button type="button" className="lv-link lv-link-quiet" onClick={() => switchMode('code')}>Forgot password?</button>
            </div>
          )}

          {/* Emailed code */}
          {otpSent && emailExists && (
            <div className="lv-field">
              <input
                className="lv-input lv-otp"
                type="text"
                inputMode="numeric"
                maxLength="6"
                placeholder="123456"
                aria-label="6-digit code"
                value={otp}
                autoFocus
                onChange={e => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              />
            </div>
          )}

          {/* Finish sign-up */}
          {isRegistering && (
            <>
              <div className="lv-field">
                <input className="lv-input" type="text" placeholder="Your full name" aria-label="Full name" value={name} autoComplete="name" autoFocus onChange={e => setName(e.target.value)} />
              </div>
              <div className="lv-field">
                <div className="lv-field-at">
                  <span className="lv-at">@</span>
                  <input
                    className="lv-input"
                    type="text"
                    placeholder="username"
                    aria-label="Username"
                    value={username}
                    autoComplete="username"
                    onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                  />
                </div>
                {unHint && <div className="lv-hint" style={{ color: unHint.color }}>{unHint.text}</div>}
              </div>
              <label className="lv-consent">
                <input type="checkbox" checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)} />
                <span>
                  I agree to the{' '}
                  <button type="button" className="lv-link" onClick={onOpenTerms}>Terms of Service</button>
                  {' '}and{' '}
                  <button type="button" className="lv-link" onClick={onOpenPrivacy}>Privacy Policy</button>
                </span>
              </label>
            </>
          )}

          <button className="lv-btn-primary" type="submit" disabled={loading}>
            {getButtonText()}
          </button>
        </form>

        {/* Google — one alternative, below the primary path */}
        {googleClientId && !otpSent && (
          <>
            <div className="lv-divider"><span>or</span></div>
            <div id="google-signin-btn" />
          </>
        )}

        {/* One contextual footer link */}
        {otpSent ? (
          <p className="lv-switch">
            Didn&apos;t get it?{' '}
            <button className="lv-link" onClick={handleSendOtp} disabled={loading}>Resend</button>
            {' · '}
            <button className="lv-link" onClick={() => switchMode(mode, intent)}>Change email</button>
          </p>
        ) : mode === 'password' ? (
          <p className="lv-switch">
            New to BrainJot?{' '}
            <button className="lv-link" onClick={() => switchMode('code', 'signup')}>Create an account</button>
          </p>
        ) : (
          <p className="lv-switch">
            {intent === 'signup' ? 'Already have an account? ' : 'Know your password? '}
            <button className="lv-link" onClick={() => switchMode('password')}>Sign in</button>
          </p>
        )}

        {/* Consent notice — only on the steps that can create an account
            (Google, or sending a code to a new email). The finish-sign-up step
            has its own explicit checkbox instead. */}
        {!otpSent && (
          <p className="lv-fineprint">
            By continuing you agree to our{' '}
            <button type="button" className="lv-link lv-link-quiet" onClick={onOpenTerms}>Terms</button>
            {' '}and{' '}
            <button type="button" className="lv-link lv-link-quiet" onClick={onOpenPrivacy}>Privacy Policy</button>.
          </p>
        )}
      </div>
    </div>
  );
}
