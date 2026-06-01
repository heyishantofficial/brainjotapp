import React, { useState, useEffect, useRef } from 'react';
import { api, apiUpload } from '../api';
import Avatar from '../components/Avatar';

async function compressAvatar(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 200;
      const scale = Math.min(MAX / img.width, MAX / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.78);
    };
    img.src = url;
  });
}


function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="stat-card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color, marginTop: '6px' }}>{value ?? '—'}</div>
      <div style={{ flex: 1 }} />
      {sub && <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '6px' }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '36px' }}>
      <div style={{ fontSize: '11px', fontWeight: '800', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px' }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: 'var(--muted)', marginBottom: '6px' }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: '12px',
  border: '1px solid var(--border)', background: 'var(--surface2)',
  color: 'var(--text)', fontSize: '14px', fontFamily: 'inherit',
  outline: 'none', boxSizing: 'border-box',
};

const btnPrimary = {
  background: 'var(--accent)', color: '#000', border: 'none',
  borderRadius: '12px', padding: '10px 20px', fontSize: '13px',
  fontWeight: '800', cursor: 'pointer', fontFamily: 'inherit',
};

const btnSecondary = {
  background: 'transparent', color: 'var(--muted)',
  border: '1px solid var(--border)', borderRadius: '12px',
  padding: '10px 20px', fontSize: '13px', fontWeight: '700',
  cursor: 'pointer', fontFamily: 'inherit',
};

export default function ProfileView({ onBack, currentUser, onUserUpdate, onLogout, onOpenAdmin }) {
  const [profileData, setProfileData] = useState(null);
  const [loading,     setLoading]     = useState(true);

  // edit profile
  const [editName,  setEditName]  = useState(currentUser?.name  || '');
  const [editEmail, setEditEmail] = useState(currentUser?.email || '');
  const [editMsg,   setEditMsg]   = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // change password
  const [curPw,  setCurPw]  = useState('');
  const [newPw,  setNewPw]  = useState('');
  const [confPw, setConfPw] = useState('');
  const [pwMsg,  setPwMsg]  = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  // set username (for existing users without one)
  const [unameVal,    setUnameVal]    = useState('');
  const [unameStatus, setUnameStatus] = useState('idle'); // idle | checking | available | taken | error
  const [unameMsg,    setUnameMsg]    = useState('');
  const [unameSaving, setUnameSaving] = useState(false);
  const unameDebounce = useRef(null);
  const avatarInputRef = useRef(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // delete account
  const [showDelete,  setShowDelete]  = useState(false);
  const [deletePw,    setDeletePw]    = useState('');
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deleteMsg,   setDeleteMsg]   = useState('');

  useEffect(() => {
    api('get_profile_stats').then(r => {
      if (r?.user) {
        setProfileData(r);
        setEditName(r.user.name);
        setEditEmail(r.user.email);
      }
      setLoading(false);
    });
  }, []);

  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('soundEnabled') !== 'false');

  const toggleTheme = () => {
    const isLight = document.body.classList.contains('theme-light');
    if (isLight) { document.body.classList.remove('theme-light'); localStorage.setItem('theme', 'dark'); }
    else          { document.body.classList.add('theme-light');    localStorage.setItem('theme', 'light'); }
  };
  const isLight = () => document.body.classList.contains('theme-light');

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('soundEnabled', String(next));
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) { setEditMsg('Name cannot be empty'); return; }
    setEditSaving(true); setEditMsg('');
    const r = await api('update_profile', { name: editName.trim(), email: editEmail.trim() });
    if (r?.ok) {
      setEditMsg('✓ Saved');
      setProfileData(prev => ({ ...prev, user: { ...prev.user, name: r.name || editName.trim(), email: r.email || editEmail.trim() } }));
      onUserUpdate?.({ name: r.name || editName.trim(), email: r.email || editEmail.trim() });
    } else {
      setEditMsg(r?.error || 'Something went wrong');
    }
    setEditSaving(false);
  };

  const handleChangePassword = async () => {
    if (!curPw || !newPw || !confPw) { setPwMsg('All fields required'); return; }
    if (newPw !== confPw) { setPwMsg('New passwords do not match'); return; }
    if (newPw.length < 8) { setPwMsg('Password must be at least 8 characters'); return; }
    setPwSaving(true); setPwMsg('');
    const r = await api('change_password', { currentPassword: curPw, newPassword: newPw });
    if (r?.ok) { setPwMsg('✓ Password changed'); setCurPw(''); setNewPw(''); setConfPw(''); }
    else        { setPwMsg(r?.error || 'Something went wrong'); }
    setPwSaving(false);
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    const compressed = await compressAvatar(file);
    const r = await apiUpload(compressed, { type: 'avatar' });
    if (r?.avatarUrl) {
      setProfileData(prev => ({ ...prev, user: { ...prev.user, avatarUrl: r.avatarUrl } }));
      onUserUpdate?.({ avatarUrl: r.avatarUrl });
    }
    setAvatarUploading(false);
    e.target.value = '';
  };

  const handleUnameChange = (raw) => {
    const val = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUnameVal(val);
    setUnameStatus('idle');
    setUnameMsg('');
    clearTimeout(unameDebounce.current);
    if (!val || val.length < 3) { setUnameStatus('idle'); return; }
    setUnameStatus('checking');
    unameDebounce.current = setTimeout(async () => {
      const r = await api('check_username', null, 'GET', `&username=${encodeURIComponent(val)}`);
      if (r?.available) { setUnameStatus('available'); setUnameMsg(''); }
      else { setUnameStatus('taken'); setUnameMsg(r?.error || 'Username not available'); }
    }, 500);
  };

  const handleSetUsername = async () => {
    if (unameStatus !== 'available') return;
    setUnameSaving(true);
    const r = await api('set_username', { username: unameVal });
    if (r?.ok) {
      setProfileData(prev => ({ ...prev, user: { ...prev.user, username: r.username } }));
      onUserUpdate?.({ username: r.username });
      setUnameVal('');
      setUnameStatus('idle');
    } else {
      setUnameMsg(r?.error || 'Something went wrong');
      setUnameStatus('error');
    }
    setUnameSaving(false);
  };

  const handleExport = async () => {
    const data = await api('export_data');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'brainjot-export.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteAccount = async () => {
    if (deletePhrase !== 'DELETE MY ACCOUNT') { setDeleteMsg('Type the phrase exactly to confirm'); return; }
    if (!deletePw) { setDeleteMsg('Password required'); return; }
    setDeleteMsg('');
    const r = await api('delete_account', { password: deletePw });
    if (r?.ok) { onLogout?.(); }
    else        { setDeleteMsg(r?.error || 'Incorrect password'); }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'bj-spin 0.7s linear infinite' }} />
    </div>
  );

  const user  = profileData?.user  || {};
  const stats = profileData?.stats || {};
  const isAdmin = user.role === 'superadmin';

  return (
    <div style={{ paddingBottom: '80px' }}>
      {/* Topbar */}
      <div className="topbar" style={{ position: 'relative', paddingTop: '60px', marginBottom: '0' }}>
        <button className="back-btn" style={{ position: 'absolute', top: '20px', left: '0' }} onClick={onBack}>
          ← Back
        </button>
      </div>

      <div style={{ maxWidth: '620px', padding: '0 36px' }}>

        {/* ── Hero ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '40px', marginTop: '8px' }}>
          <div
            style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}
            onClick={() => avatarInputRef.current?.click()}
            title="Change profile picture"
          >
            <Avatar name={user.name} src={user.avatarUrl} size={72} />
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: '22px', height: '22px', borderRadius: '50%',
              background: 'var(--accent)', color: '#000',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', border: '2px solid var(--bg)',
            }}>
              {avatarUploading ? '…' : '📷'}
            </div>
            <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '900', letterSpacing: '-0.5px' }}>{user.name}</h1>
              {isAdmin && (
                <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: '#7c3aed22', color: '#7c3aed' }}>⚡ Admin</span>
              )}
            </div>
            {user.username && (
              <div style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: '700', marginTop: '2px' }}>@{user.username}</div>
            )}
            <div style={{ fontSize: '14px', color: 'var(--muted)', marginTop: '3px' }}>{user.email}</div>
            <div style={{ fontSize: '12px', color: 'var(--faint)', marginTop: '3px' }}>Member since {fmt(user.createdAt)}</div>
          </div>
        </div>

        {/* ── Admin Panel shortcut ── */}
        {isAdmin && (
          <Section title="Admin">
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '700' }}>Admin Panel</div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>Manage users, feedback and app settings</div>
                </div>
                <button
                  onClick={onOpenAdmin}
                  style={{ ...btnPrimary, whiteSpace: 'nowrap', background: '#7c3aed', color: '#fff' }}
                >
                  Open Admin ⚡
                </button>
              </div>
            </div>
          </Section>
        )}

        {/* ── Stats ── */}
        <Section title="Your Stats">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', alignItems: 'stretch' }}>
            <StatCard label="PROJECTS"   value={stats.projectCount}   color="var(--accent)" />
            <StatCard label="SPACES"     value={stats.spaceCount}     color="var(--text)" />
            <StatCard label="FILES"      value={stats.fileCount}      color="#3b82f6" />
            <StatCard label="TASKS DONE" value={stats.taskDone}       color="#10b981" sub={stats.taskTotal != null ? `of ${stats.taskTotal} total` : null} />
            <StatCard label="COMPLETION" value={stats.taskTotal != null ? `${stats.completionRate}%` : '—'} color={stats.completionRate >= 60 ? '#10b981' : stats.completionRate >= 30 ? '#f59e0b' : '#ef4444'} />
            <StatCard label="FEEDBACK"   value={stats.feedbackCount}  color="#ec4899" />
          </div>
        </Section>

        {/* ── Set Username (first time only) ── */}
        {!user.username && (
          <Section title="Claim Your @Username">
            <div style={{ background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: '18px', padding: '22px' }}>
              <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6', marginTop: 0, marginBottom: '16px' }}>
                Choose a permanent unique username — this is your <strong>@handle</strong> in BrainJot and cannot be changed later.
              </p>
              <Field label="Username">
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--accent)', fontWeight: '800', fontSize: '14px', pointerEvents: 'none' }}>@</span>
                  <input
                    value={unameVal}
                    onChange={e => handleUnameChange(e.target.value)}
                    style={{ ...inputStyle, paddingLeft: '28px' }}
                    placeholder="yourhandle"
                    maxLength={20}
                    spellCheck={false}
                  />
                </div>
                {unameVal.length > 0 && (
                  <div style={{ marginTop: '6px', fontSize: '12px', fontWeight: '700',
                    color: unameStatus === 'available' ? '#10b981' : unameStatus === 'taken' || unameStatus === 'error' ? '#ef4444' : 'var(--muted)' }}>
                    {unameStatus === 'checking' && '⏳ Checking…'}
                    {unameStatus === 'available' && '✓ Available'}
                    {(unameStatus === 'taken' || unameStatus === 'error') && `✕ ${unameMsg}`}
                  </div>
                )}
              </Field>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  onClick={handleSetUsername}
                  disabled={unameSaving || unameStatus !== 'available'}
                  style={{ ...btnPrimary, opacity: (unameSaving || unameStatus !== 'available') ? 0.5 : 1 }}
                >
                  {unameSaving ? 'Saving…' : 'Claim Username'}
                </button>
                <span style={{ fontSize: '11px', color: 'var(--faint)' }}>Lowercase letters, numbers, _ · 3–20 chars</span>
              </div>
            </div>
          </Section>
        )}

        {/* ── Edit Profile ── */}
        <Section title="Edit Profile">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '22px' }}>
            <Field label="Display Name">
              <input value={editName} onChange={e => { setEditName(e.target.value); setEditMsg(''); }} style={inputStyle} placeholder="Your name" />
            </Field>
            {user.username && (
              <Field label="Username (permanent)">
                <div style={{ ...inputStyle, color: 'var(--accent)', fontWeight: '700', cursor: 'default', userSelect: 'all' }}>@{user.username}</div>
              </Field>
            )}
            <Field label="Email Address">
              <input value={editEmail} onChange={e => { setEditEmail(e.target.value); setEditMsg(''); }} style={inputStyle} placeholder="you@email.com" type="email" />
            </Field>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
              <button onClick={handleSaveProfile} disabled={editSaving} style={btnPrimary}>
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
              {editMsg && (
                <span style={{ fontSize: '13px', color: editMsg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{editMsg}</span>
              )}
            </div>
          </div>
        </Section>

        {/* ── Change Password ── */}
        <Section title="Change Password">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '22px' }}>
            <Field label="Current Password">
              <input value={curPw} onChange={e => { setCurPw(e.target.value); setPwMsg(''); }} style={inputStyle} type="password" placeholder="Enter current password" />
            </Field>
            <Field label="New Password">
              <input value={newPw} onChange={e => { setNewPw(e.target.value); setPwMsg(''); }} style={inputStyle} type="password" placeholder="Min 8 characters" />
            </Field>
            <Field label="Confirm New Password">
              <input value={confPw} onChange={e => { setConfPw(e.target.value); setPwMsg(''); }} style={inputStyle} type="password" placeholder="Repeat new password" />
            </Field>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
              <button onClick={handleChangePassword} disabled={pwSaving} style={btnPrimary}>
                {pwSaving ? 'Updating…' : 'Update Password'}
              </button>
              {pwMsg && (
                <span style={{ fontSize: '13px', color: pwMsg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{pwMsg}</span>
              )}
            </div>
          </div>
        </Section>

        {/* ── Preferences ── */}
        <Section title="Preferences">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700' }}>Theme</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>Switch between dark and light mode</div>
              </div>
              <button
                onClick={toggleTheme}
                className="theme-toggle"
                style={{ padding: '8px 18px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {isLight() ? '🌙 Dark' : '☀️ Light'}
              </button>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '18px', marginTop: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700' }}>Sounds</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>Task completion celebration and notification chime</div>
              </div>
              <button
                onClick={toggleSound}
                style={{ padding: '8px 18px', borderRadius: '12px', border: '1px solid var(--border)', background: soundEnabled ? 'var(--accent)' : 'var(--surface2)', color: soundEnabled ? '#000' : 'var(--text)', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.2s, color 0.2s' }}
              >
                {soundEnabled ? '🔊 On' : '🔇 Off'}
              </button>
            </div>
          </div>
        </Section>

        {/* ── Data ── */}
        <Section title="Your Data">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700' }}>Export Data</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>Download all your projects, spaces and tasks as JSON</div>
              </div>
              <button onClick={handleExport} style={btnSecondary}>⬇ Export</button>
            </div>
          </div>
        </Section>

        {/* ── Sign Out ── */}
        <Section title="Session">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700' }}>Sign Out</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>End your current session and return to the login screen</div>
              </div>
              <button onClick={onLogout} style={{ ...btnSecondary, whiteSpace: 'nowrap' }}>Sign Out</button>
            </div>
          </div>
        </Section>

        {/* ── Danger Zone ── */}
        <Section title="Danger Zone">
          <div style={{ background: '#ef444408', border: '1px solid #ef444430', borderRadius: '18px', padding: '22px' }}>
            {!showDelete ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '700' }}>Delete Account</div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>Permanently delete your account and all your data. Cannot be undone.</div>
                </div>
                <button onClick={() => setShowDelete(true)} style={{ ...btnSecondary, color: '#ef4444', borderColor: '#ef444444' }}>Delete Account</button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#ef4444', marginBottom: '14px' }}>⚠ Delete Your Account</div>
                <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6', marginTop: 0, marginBottom: '16px' }}>
                  This will permanently delete your account, all your projects, spaces, tasks, and files. This action <strong>cannot be undone</strong>.
                </p>
                <Field label='Type "DELETE MY ACCOUNT" to confirm'>
                  <input value={deletePhrase} onChange={e => { setDeletePhrase(e.target.value); setDeleteMsg(''); }} style={{ ...inputStyle, borderColor: '#ef444444' }} placeholder="DELETE MY ACCOUNT" />
                </Field>
                <Field label="Enter your password">
                  <input value={deletePw} onChange={e => { setDeletePw(e.target.value); setDeleteMsg(''); }} style={{ ...inputStyle, borderColor: '#ef444444' }} type="password" placeholder="Your password" />
                </Field>
                {deleteMsg && <div style={{ fontSize: '13px', color: '#ef4444', marginBottom: '12px' }}>{deleteMsg}</div>}
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => { setShowDelete(false); setDeletePhrase(''); setDeletePw(''); setDeleteMsg(''); }} style={btnSecondary}>Cancel</button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deletePhrase !== 'DELETE MY ACCOUNT' || !deletePw}
                    style={{ ...btnPrimary, background: (deletePhrase === 'DELETE MY ACCOUNT' && deletePw) ? '#ef4444' : '#2a2a2a', color: (deletePhrase === 'DELETE MY ACCOUNT' && deletePw) ? '#fff' : 'var(--muted)', cursor: (deletePhrase === 'DELETE MY ACCOUNT' && deletePw) ? 'pointer' : 'default' }}
                  >
                    Permanently Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </Section>

      </div>
    </div>
  );
}
