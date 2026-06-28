import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function LoginScreen({ onLoginSuccess, googleClientId, onOpenPrivacy, onOpenTerms }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
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

  const isRegistering = (mode === 'register' && authType === 'password') || (authType === 'otp' && otpSent && !emailExists);

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
  }, [username, mode, authType, otpSent, emailExists]);

  const handleGoogleCredentialResponse = async (response) => {
    setLoading(true);
    setError('');
    try {
      const r = await api('google_auth', { credential: response.credential });
      if (r.ok) onLoginSuccess(r.user);
      else setError(r.error || 'Google Authentication failed');
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!googleClientId) return;
    const initGoogle = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({ client_id: googleClientId, callback: handleGoogleCredentialResponse });
        const btnEl = document.getElementById('google-signin-btn');
        if (btnEl) {
          window.google.accounts.id.renderButton(btnEl, { theme: 'outline', size: 'large', width: btnEl.offsetWidth || 330 });
        }
      } else {
        setTimeout(initGoogle, 100);
      }
    };
    initGoogle();
  }, [googleClientId, mode, authType]);

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
    if (mode === 'register') {
      if (usernameStatus !== 'available') { setError('Please choose a valid, available username'); return; }
      if (!consentGiven) { setError('You must agree to the Terms of Service and Privacy Policy'); return; }
    }
    setLoading(true);
    try {
      const body = mode === 'register' ? { name, email, password, username, consentGiven: true } : { email, password };
      const r = await api(mode, body);
      if (r.ok) onLoginSuccess(r.user);
      else setError(r.error || 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  };

  const switchMode = (next) => {
    setMode(next); setError(''); setUsernameStatus(null);
    setShowForgot(false); setOtpSent(false); setOtp(''); setConsentGiven(false);
  };

  const switchAuthType = (next) => {
    setAuthType(next); setError(''); setUsernameStatus(null);
    setShowForgot(false); setOtpSent(false); setOtp(''); setConsentGiven(false);
  };

  const unHint = (() => {
    if (!username || !isRegistering) return null;
    if (usernameStatus === 'checking') return { color: 'rgba(255,255,255,0.3)', text: 'Checking…' };
    if (usernameStatus === 'available') return { color: '#10b981', text: '✓ @' + username + ' is available' };
    if (usernameStatus === 'taken') return { color: '#ef4444', text: '✕ @' + username + ' is taken' };
    if (typeof usernameStatus === 'string') return { color: '#ef4444', text: usernameStatus };
    return null;
  })();

  const getTitle = () => {
    if (authType === 'otp') {
      if (otpSent && !emailExists) return 'Almost there';
      if (otpSent) return 'Check your inbox';
      return 'Continue with email';
    }
    return mode === 'login' ? 'Welcome back' : 'Create account';
  };

  const getSubtext = () => {
    if (authType === 'otp') {
      if (otpSent) return emailExists ? `We sent a 6-digit code to ${email}` : 'Complete your profile to finish signing up.';
      return 'Enter your email to sign in or create an account.';
    }
    return mode === 'login' ? 'Sign in to your workspace.' : 'Get started with BrainJot.';
  };

  const getButtonText = () => {
    if (loading) return 'Please wait…';
    if (authType === 'otp') {
      if (!otpSent) return 'Send verification code';
      return emailExists ? 'Verify & Sign in' : 'Complete sign up';
    }
    return mode === 'login' ? 'Sign in' : 'Create account';
  };

  return (
    <div id="login-screen">
      {/* Looping video background */}
      <video className="lv-bg" autoPlay loop muted playsInline>
        <source src="/bg-video.mp4" type="video/mp4" />
      </video>
      <div className="lv-overlay" />

      {/* Auth card */}
      <div className="lv-card">

        {/* Hero — lime panel with character illustration */}
        <div className="lv-hero">
          <img src="/illust.png" alt="" className="lv-illust" />
          <div className="lv-brand">
            <span className="lv-brand-name">BrainJot</span>
            <span className="lv-brand-tag">Think together.</span>
          </div>
        </div>

        {/* Form panel */}
        <div className="lv-body">
          <h2 className="lv-title">{getTitle()}</h2>
          <p className="lv-sub">{getSubtext()}</p>

          {/* Google SSO */}
          {googleClientId && !otpSent && (
            <div className="lv-google-wrap">
              <div id="google-signin-btn" style={{ display: 'flex', justifyContent: 'center', width: '100%' }} />
              <p className="lv-google-notice">
                By continuing with Google you agree to our{' '}
                <button type="button" className="lv-link" onClick={onOpenTerms}>Terms</button>
                {' & '}
                <button type="button" className="lv-link" onClick={onOpenPrivacy}>Privacy Policy</button>
              </p>
            </div>
          )}

          {/* Divider */}
          {googleClientId && !otpSent && (
            <div className="lv-divider"><span>or</span></div>
          )}

          {/* Name — register only */}
          {isRegistering && (
            <div className="lv-field">
              <input
                className="lv-input"
                type="text"
                placeholder="Full name"
                value={name}
                autoComplete="name"
                onChange={e => setName(e.target.value)}
              />
            </div>
          )}

          {/* Email — hide when OTP sent (can't change it) */}
          {!(authType === 'otp' && otpSent) && (
            <div className="lv-field">
              <input
                className="lv-input"
                type="email"
                placeholder="Email address"
                value={email}
                autoComplete="email"
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          )}

          {/* Password */}
          {authType === 'password' && (
            <div className="lv-field lv-field-pass">
              <input
                className="lv-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && mode !== 'register' && doSubmit()}
              />
              <button type="button" className="lv-eye" onClick={() => setShowPassword(v => !v)} tabIndex={-1}>
                {showPassword
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          )}

          {/* Username — register only */}
          {isRegistering && (
            <div className="lv-field">
              <div className="lv-field-at">
                <span className="lv-at">@</span>
                <input
                  className="lv-input"
                  type="text"
                  placeholder="username"
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
              <input
                className="lv-input lv-otp"
                type="text"
                maxLength="6"
                placeholder="· · · · · ·"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && doSubmit()}
              />
            </div>
          )}

          {/* Consent checkbox */}
          {isRegistering && (
            <label className="lv-consent">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={e => setConsentGiven(e.target.checked)}
              />
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

          {/* Submit button */}
          <button className="lv-btn-primary" onClick={doSubmit} disabled={loading}>
            {getButtonText()}
          </button>

          {/* OTP resend */}
          {authType === 'otp' && otpSent && (
            <div style={{ textAlign: 'center', marginTop: '10px' }}>
              <button className="lv-link" onClick={handleSendOtp} disabled={loading}>Resend code</button>
            </div>
          )}

          {/* Forgot password */}
          {mode === 'login' && authType === 'password' && (
            <div style={{ textAlign: 'center', marginTop: '8px' }}>
              {!showForgot
                ? <button className="lv-link lv-link-muted" onClick={() => setShowForgot(true)}>Forgot password?</button>
                : <p className="lv-forgot-msg">Contact your workspace admin or reach out to support.</p>
              }
            </div>
          )}

          {/* Footer */}
          <div className="lv-footer">
            <button className="lv-footer-link" onClick={() => switchAuthType(authType === 'password' ? 'otp' : 'password')}>
              {authType === 'password' ? 'Use Email OTP instead' : 'Use password instead'}
            </button>
            {authType === 'password' && (
              <span className="lv-footer-switch">
                {mode === 'login'
                  ? <>No account?{' '}<button className="lv-link" onClick={() => switchMode('register')}>Sign up</button></>
                  : <>Have an account?{' '}<button className="lv-link" onClick={() => switchMode('login')}>Sign in</button></>
                }
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
