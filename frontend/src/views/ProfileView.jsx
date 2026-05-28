import React, { useState, useEffect } from 'react';
import { api } from '../api';

function initials(name) {
  return (name || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}
function hashColor(str) {
  const c = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444'];
  let h = 0;
  for (let i = 0; i < (str||'').length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return c[Math.abs(h) % c.length];
}
function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="stat-card" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>{sub}</div>}
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

export default function ProfileView({ onBack, currentUser, onUserUpdate, onLogout }) {
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

  const toggleTheme = () => {
    const isLight = document.body.classList.contains('theme-light');
    if (isLight) { document.body.classList.remove('theme-light'); localStorage.setItem('theme', 'dark'); }
    else          { document.body.classList.add('theme-light');    localStorage.setItem('theme', 'light'); }
  };
  const isLight = () => document.body.classList.contains('theme-light');

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

  if (loading) return null;

  const user  = profileData?.user  || {};
  const stats = profileData?.stats || {};
  const avatarColor = hashColor(user.name || '');
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
          <div style={{
            width: '72px', height: '72px', borderRadius: '50%',
            background: avatarColor, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '26px', fontWeight: '900', flexShrink: 0,
          }}>
            {initials(user.name)}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '900', letterSpacing: '-0.5px' }}>{user.name}</h1>
              {isAdmin && (
                <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: '#7c3aed22', color: '#7c3aed' }}>⚡ Admin</span>
              )}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--muted)', marginTop: '3px' }}>{user.email}</div>
            <div style={{ fontSize: '12px', color: 'var(--faint)', marginTop: '3px' }}>Member since {fmt(user.createdAt)}</div>
          </div>
        </div>

        {/* ── Stats ── */}
        <Section title="Your Stats">
          <div className="stats-row" style={{ marginBottom: 0 }}>
            <StatCard label="PROJECTS"   value={stats.projectCount}   color="var(--accent)" />
            <StatCard label="SPACES"     value={stats.spaceCount}     color="var(--text)" />
            <StatCard label="TASKS DONE" value={stats.taskDone}       color="#10b981" sub={`of ${stats.taskTotal} total`} />
            <StatCard label="COMPLETION" value={`${stats.completionRate}%`} color={stats.completionRate >= 60 ? '#10b981' : stats.completionRate >= 30 ? '#f59e0b' : '#ef4444'} />
            <StatCard label="FILES"      value={stats.fileCount}      color="#3b82f6" />
            <StatCard label="FEEDBACK"   value={stats.feedbackCount}  color="#ec4899" />
          </div>
        </Section>

        {/* ── Edit Profile ── */}
        <Section title="Edit Profile">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '22px' }}>
            <Field label="Display Name">
              <input value={editName} onChange={e => { setEditName(e.target.value); setEditMsg(''); }} style={inputStyle} placeholder="Your name" />
            </Field>
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
