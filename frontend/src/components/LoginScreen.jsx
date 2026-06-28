import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function LoginScreen({ onLoginSuccess, googleClientId, onOpenPrivacy, onOpenTerms }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [authType, setAuthType] = useState('password'); // 'password' | 'otp'
  
  // Fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [otp, setOtp] = useState('');
  
  // OTP States
  const [otpSent, setOtpSent] = useState(false);
  const [emailExists, setEmailExists] = useState(false);
  
  const [usernameStatus, setUsernameStatus] = useState(null); // null | 'checking' | 'available' | 'taken' | string (error)
  const [consentGiven, setConsentGiven] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const debounceRef = useRef(null);

  // Auto-suggest username from name
  useEffect(() => {
    if ((mode === 'register' || (authType === 'otp' && otpSent && !emailExists)) && name && !username) {
      const suggested = name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9_]/g, '').slice(0, 20);
      if (suggested.length >= 3) setUsername(suggested);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Debounced availability check
  useEffect(() => {
    const isRegistering = mode === 'register' || (authType === 'otp' && otpSent && !emailExists);
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

  // Handle Google Login Response
  const handleGoogleCredentialResponse = async (response) => {
    const credential = response.credential;
    setLoading(true);
    setError('');
    try {
      const r = await api('google_auth', { credential });
      if (r.ok) {
        onLoginSuccess(r.user);
      } else {
        setError(r.error || 'Google Authentication failed');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  // Google SDK Init
  useEffect(() => {
    if (!googleClientId) return;

    const initGoogle = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleGoogleCredentialResponse,
        });
        const btnEl = document.getElementById('google-signin-btn');
        if (btnEl) {
          window.google.accounts.id.renderButton(btnEl, {
            theme: 'filled_black',
            size: 'large',
            width: btnEl.offsetWidth || 290,
          });
        }
      } else {
        setTimeout(initGoogle, 100);
      }
    };

    initGoogle();
  }, [googleClientId, mode, authType]);

  const handleSendOtp = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await api('send_otp', { email });
      if (r.ok) {
        setOtpSent(true);
        setEmailExists(r.exists);
      } else {
        setError(r.error || 'Failed to send OTP. Please try again.');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp?.trim()) {
      setError('Verification code is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await api('verify_otp', { email, otp });
      if (r.ok) {
        if (r.exists) {
          onLoginSuccess(r.user);
        } else {
          // Verification succeeded but user is new
          setEmailExists(false);
        }
      } else {
        setError(r.error || 'Invalid or expired code');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterOtp = async () => {
    if (!name?.trim() || !username?.trim()) {
      setError('Name and Username are required');
      return;
    }
    if (usernameStatus !== 'available') {
      setError('Please choose a valid, available username');
      return;
    }
    if (!consentGiven) {
      setError('You must agree to the Terms of Service and Privacy Policy');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await api('register_otp', { email, name, username, otp, consentGiven: true });
      if (r.ok) {
        onLoginSuccess(r.user);
      } else {
        setError(r.error || 'Registration failed');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const doSubmit = async () => {
    setError('');
    if (authType === 'otp') {
      if (!otpSent) {
        await handleSendOtp();
      } else if (emailExists) {
        await handleVerifyOtp();
      } else {
        await handleRegisterOtp();
      }
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
      if (r.ok) {
        onLoginSuccess(r.user);
      } else {
        setError(r.error || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setUsernameStatus(null);
    setShowForgot(false);
    setOtpSent(false);
    setOtp('');
    setConsentGiven(false);
  };

  const switchAuthType = (next) => {
    setAuthType(next);
    setError('');
    setUsernameStatus(null);
    setShowForgot(false);
    setOtpSent(false);
    setOtp('');
    setConsentGiven(false);
  };

  const unHint = (() => {
    const isRegistering = mode === 'register' || (authType === 'otp' && otpSent && !emailExists);
    if (!username || !isRegistering) return null;
    if (usernameStatus === 'checking') return { color: 'var(--muted)', text: 'Checking…' };
    if (usernameStatus === 'available') return { color: '#10b981', text: '✓ @' + username + ' is available' };
    if (usernameStatus === 'taken') return { color: '#ef4444', text: '✕ @' + username + ' is taken' };
    if (typeof usernameStatus === 'string') return { color: '#ef4444', text: usernameStatus };
    return null;
  })();

  const getSubtext = () => {
    if (authType === 'otp') {
      if (otpSent) {
        return emailExists 
          ? 'Enter the verification code sent to your email.' 
          : 'Complete your profile to sign up.';
      }
      return 'Sign in or register with a verification code.';
    }
    return mode === 'login' ? 'Sign in to your workspace.' : 'Get started with BrainJot.';
  };

  const getButtonText = () => {
    if (loading) return 'Please wait…';
    if (authType === 'otp') {
      if (!otpSent) return 'Send verification code';
      return emailExists ? 'Verify & Sign in' : 'Verify & Register';
    }
    return mode === 'login' ? 'Sign in' : 'Create account';
  };

  return (
    <div id="login-screen">
      <div className="login-box">
        <div className="login-year">BJ</div>
        <div className="login-title">
          {authType === 'otp' 
            ? (otpSent && !emailExists ? 'Create your profile' : 'Verification')
            : (mode === 'login' ? 'Welcome back' : 'Create your account')}
        </div>
        <div className="login-sub">
          {getSubtext()}
        </div>

        {/* Google SSO section */}
        {googleClientId && !otpSent && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginBottom: '8px' }}>
              <div id="google-signin-btn" style={{ width: '100%', minHeight: '40px' }} />
            </div>
            <p style={{ fontSize: '11px', color: 'var(--faint)', textAlign: 'center', marginBottom: '16px', lineHeight: '1.5' }}>
              By continuing with Google, you agree to our{' '}
              <button onClick={onOpenTerms} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '11px', padding: 0, textDecoration: 'underline' }}>Terms of Service</button>
              {' '}and{' '}
              <button onClick={onOpenPrivacy} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '11px', padding: 0, textDecoration: 'underline' }}>Privacy Policy</button>.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', margin: '18px 0', color: 'var(--muted)', fontSize: '12px' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--border)' }}></div>
              <span style={{ padding: '0 10px', fontWeight: '500', opacity: 0.6 }}>or</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--border)' }}></div>
            </div>
          </>
        )}

        {/* Name (for standard Register OR new-user OTP signup) */}
        {((mode === 'register' && authType === 'password') || (authType === 'otp' && otpSent && !emailExists)) && (
          <div className="field">
            <label>Name</label>
            <input
              type="text"
              placeholder="Your name"
              value={name}
              autoComplete="name"
              onChange={e => setName(e.target.value)}
            />
          </div>
        )}

        {/* Email Field */}
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            disabled={authType === 'otp' && otpSent}
            autoComplete="email"
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        {/* Password Field (only for Password authentication) */}
        {authType === 'password' && (
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && mode !== 'register' && doSubmit()}
            />
          </div>
        )}

        {/* Username Field (for standard Register OR new-user OTP signup) */}
        {((mode === 'register' && authType === 'password') || (authType === 'otp' && otpSent && !emailExists)) && (
          <div className="field">
            <label>Username</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: '14px', fontWeight: '700', pointerEvents: 'none' }}>@</span>
              <input
                type="text"
                placeholder="yourhandle"
                value={username}
                autoComplete="username"
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

        {/* OTP Verification Code Field */}
        {authType === 'otp' && otpSent && (
          <div className="field">
            <label>Verification Code</label>
            <input
              type="text"
              maxLength="6"
              placeholder="123456"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && doSubmit()}
              style={{ letterSpacing: '6px', textAlign: 'center', fontWeight: '700' }}
            />
          </div>
        )}

        {/* Consent checkbox — shown only during registration */}
        {(mode === 'register' && authType === 'password') || (authType === 'otp' && otpSent && !emailExists) ? (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '16px', fontSize: '13px', color: 'var(--muted)', lineHeight: '1.5' }}>
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={e => setConsentGiven(e.target.checked)}
              style={{ marginTop: '2px', accentColor: 'var(--accent)', flexShrink: 0, width: '15px', height: '15px', cursor: 'pointer' }}
            />
            <span>
              I agree to the{' '}
              <button onClick={onOpenTerms} type="button" style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: '13px', padding: 0, fontWeight: '600', textDecoration: 'underline' }}>Terms of Service</button>
              {' '}and{' '}
              <button onClick={onOpenPrivacy} type="button" style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: '13px', padding: 0, fontWeight: '600', textDecoration: 'underline' }}>Privacy Policy</button>
            </span>
          </label>
        ) : null}

        <button className="btn-primary" onClick={doSubmit} disabled={loading}>
          {getButtonText()}
        </button>

        {error && <div className="login-err" style={{ display: 'block' }}>{error}</div>}

        {/* OTP Resend Options */}
        {authType === 'otp' && otpSent && (
          <div style={{ textAlign: 'center', marginTop: '14px' }}>
            <button
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
              onClick={handleSendOtp}
              disabled={loading}
            >
              Resend verification code
            </button>
          </div>
        )}

        {/* Forgot Password Link */}
        {mode === 'login' && authType === 'password' && (
          <div style={{ textAlign: 'center', marginTop: '10px' }}>
            {!showForgot ? (
              <button
                style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '13px', padding: 0, textDecoration: 'underline' }}
                onClick={() => setShowForgot(true)}
              >
                Forgot password?
              </button>
            ) : (
              <div style={{ fontSize: '13px', color: 'var(--muted)', background: 'var(--surface2)', borderRadius: '10px', padding: '10px 14px', lineHeight: '1.5' }}>
                Password reset is not available via email yet. Contact your workspace admin or reach out to support.
              </div>
            )}
          </div>
        )}

        {/* Authentication Method Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginTop: '18px', borderTop: '0.5px solid var(--border)', paddingTop: '14px' }}>
          {authType === 'password' ? (
            <button
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
              onClick={() => switchAuthType('otp')}
            >
              Sign in with Email OTP
            </button>
          ) : (
            <button
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
              onClick={() => switchAuthType('password')}
            >
              Sign in with password
            </button>
          )}

          {/* Login Mode Selector */}
          {authType === 'password' && (
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              {mode === 'login' ? (
                <>
                  No account?{' '}
                  <button
                    style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: '13px', fontWeight: '600', padding: 0 }}
                    onClick={() => switchMode('register')}
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: '13px', fontWeight: '600', padding: 0 }}
                    onClick={() => switchMode('login')}
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
