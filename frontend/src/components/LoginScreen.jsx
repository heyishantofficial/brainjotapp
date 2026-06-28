import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function LoginScreen({ onLoginSuccess, googleClientId, onOpenPrivacy, onOpenTerms }) {
  const [authType, setAuthType] = useState('password'); // 'password' | 'otp'

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
  const [showForgot, setShowForgot] = useState(false);
  const debounceRef = useRef(null);

  // Registration only happens via OTP — password mode is login-only
  const isRegistering = authType === 'otp' && otpSent && !emailExists;

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
  }, [username, authType, otpSent, emailExists]);

  const handleGoogleCredentialResponse = async (response) => {
    setLoading(true); setError('');
    try {
      const r = await api('google_auth', { credential: response.credential });
      if (r.ok) onLoginSuccess(r.user);
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
  }, [googleClientId, authType]);

  const handleSendOtp = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address'); return;
    }
    setLoading(true); setError('');
    try {
      const r = await api('send_otp', { email });
      if (r.ok) { setOtpSent(true); setEmailExists(r.exists); }
      else setError(r.error || 'Failed to send OTP. Please try again.');
    } catch { setError('Failed to connect to server'); }
    finally { setLoading(false); }
  };

  const handleVerifyOtp = async () => {
    if (!otp?.trim()) { setError('Verification code is required'); return; }
    setLoading(true); setError('');
    try {
      const r = await api('verify_otp', { email, otp });
      if (r.ok) {
        if (r.exists) onLoginSuccess(r.user);
        else setEmailExists(false);
      } else setError(r.error || 'Invalid or expired code');
    } catch { setError('Failed to connect to server'); }
    finally { setLoading(false); }
  };

  const handleRegisterOtp = async () => {
    if (!name?.trim() || !username?.trim()) { setError('Name and Username are required'); return; }
    if (usernameStatus !== 'available') { setError('Please choose a valid, available username'); return; }
    if (!consentGiven) { setError('You must agree to the Terms of Service and Privacy Policy'); return; }
    setLoading(true); setError('');
    try {
      const r = await api('register_otp', { email, name, username, otp, consentGiven: true });
      if (r.ok) onLoginSuccess(r.user);
      else setError(r.error || 'Registration failed');
    } catch { setError('Failed to connect to server'); }
    finally { setLoading(false); }
  };

  const doSubmit = async () => {
    setError('');
    if (authType === 'otp') {
      if (!otpSent) await handleSendOtp();
      else if (emailExists) await handleVerifyOtp();
      else await handleRegisterOtp();
      return;
    }
    setLoading(true);
    try {
      const r = await api('login', { email, password });
      if (r.ok) onLoginSuccess(r.user);
      else setError(r.error || 'Invalid email or password.');
    } finally { setLoading(false); }
  };

  const switchAuthType = (next) => {
    setAuthType(next); setError(''); setUsernameStatus(null);
    setShowForgot(false); setOtpSent(false); setOtp(''); setConsentGiven(false);
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
    if (authType === 'otp') {
      if (otpSent && !emailExists) return 'Almost there';
      if (otpSent) return 'Check your inbox';
      return 'Continue with email';
    }
    return 'Sign in';
  };

  const getSubtext = () => {
    if (authType === 'otp') {
      if (otpSent) return emailExists ? `We sent a 6-digit code to ${email}` : 'Complete your profile to finish signing up.';
      return 'Enter your email to sign in or create an account.';
    }
    return 'Welcome back to your workspace.';
  };

  const getButtonText = () => {
    if (loading) return 'Please wait…';
    if (authType === 'otp') {
      if (!otpSent) return 'Continue';
      return emailExists ? 'Verify & Sign in' : 'Complete sign up';
    }
    return 'Sign in';
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
          <span className="lv-brand-tag">The workspace where ideas connect.</span>
        </div>

        <h2 className="lv-title">{getTitle()}</h2>
        <p className="lv-sub">{getSubtext()}</p>

        {/* Google SSO */}
        {googleClientId && !otpSent && (
          <>
            <div id="google-signin-btn" style={{ width: '100%', marginBottom: '6px' }} />
            <p className="lv-google-notice">
              By continuing with Google you agree to our{' '}
              <button type="button" className="lv-link" onClick={onOpenTerms}>Terms</button>
              {' & '}
              <button type="button" className="lv-link" onClick={onOpenPrivacy}>Privacy Policy</button>
            </p>
          </>
        )}

        {/* Divider */}
        {googleClientId && !otpSent && (
          <div className="lv-divider"><span>or</span></div>
        )}

        {/* Name — register only */}
        {isRegistering && (
          <div className="lv-field">
            <label className="lv-label">Full name</label>
            <input className="lv-input" type="text" placeholder="Your name" value={name} autoComplete="name" onChange={e => setName(e.target.value)} />
          </div>
        )}

        {/* Email */}
        {!(authType === 'otp' && otpSent) && (
          <div className="lv-field">
            <label className="lv-label">Email address</label>
            <input className="lv-input" type="email" placeholder="you@example.com" value={email} autoComplete="email" onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && authType === 'otp' && !otpSent && doSubmit()} />
          </div>
        )}

        {/* Password */}
        {authType === 'password' && (
          <div className="lv-field">
            <label className="lv-label">Password</label>
            <div className="lv-field-pass">
              <input
                className="lv-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                autoComplete="current-password"
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSubmit()}
              />
              <button type="button" className="lv-eye" onClick={() => setShowPassword(v => !v)} tabIndex={-1}>
                {showPassword
                  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>
        )}

        {/* Username — register only */}
        {isRegistering && (
          <div className="lv-field">
            <label className="lv-label">Username</label>
            <div className="lv-field-at">
              <span className="lv-at">@</span>
              <input
                className="lv-input"
                type="text"
                placeholder="yourhandle"
                value={username}
                autoComplete="username"
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                onKeyDown={e => e.key === 'Enter' && doSubmit()}
              />
            </div>
            {unHint && <div className="lv-hint" style={{ color: unHint.color }}>{unHint.text}</div>}
          </div>
        )}

        {/* OTP code */}
        {authType === 'otp' && otpSent && (
          <div className="lv-field">
            <label className="lv-label">Verification code</label>
            <input
              className="lv-input lv-otp"
              type="text"
              maxLength="6"
              placeholder="123456"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && doSubmit()}
            />
          </div>
        )}

        {/* Consent checkbox */}
        {isRegistering && (
          <label className="lv-consent">
            <input type="checkbox" checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)} />
            <span>
              I agree to the{' '}
              <button type="button" className="lv-link" onClick={onOpenTerms}>Terms of Service</button>
              {' '}and{' '}
              <button type="button" className="lv-link" onClick={onOpenPrivacy}>Privacy Policy</button>
            </span>
          </label>
        )}

        {/* Error */}
        {error && <div className="lv-err">{error}</div>}

        {/* Submit */}
        <button className="lv-btn-primary" onClick={doSubmit} disabled={loading}>
          {getButtonText()}
        </button>

        {/* Magic link / OTP switch */}
        {!otpSent && (
          <button className="lv-btn-link" onClick={() => switchAuthType(authType === 'password' ? 'otp' : 'password')}>
            {authType === 'password' ? 'Send a magic link instead' : 'Sign in with password instead'}
          </button>
        )}

        {/* OTP resend */}
        {authType === 'otp' && otpSent && (
          <button className="lv-btn-link" onClick={handleSendOtp} disabled={loading}>Resend code</button>
        )}

        {/* Forgot password */}
        {authType === 'password' && (
          <div style={{ textAlign: 'center' }}>
            {!showForgot
              ? <button className="lv-btn-link" onClick={() => setShowForgot(true)}>Forgot password?</button>
              : <p className="lv-forgot-msg">Contact your workspace admin or reach out to support.</p>
            }
          </div>
        )}

        {/* Sign up / sign in toggle */}
        {authType === 'password' && (
          <p className="lv-switch">
            Need an account?{' '}
            <button className="lv-link" onClick={() => switchAuthType('otp')}>Sign up with email</button>
          </p>
        )}
        {authType === 'otp' && !otpSent && (
          <p className="lv-switch">
            Already have an account?{' '}
            <button className="lv-link" onClick={() => switchAuthType('password')}>Sign in with password</button>
          </p>
        )}
      </div>
    </div>
  );
}
