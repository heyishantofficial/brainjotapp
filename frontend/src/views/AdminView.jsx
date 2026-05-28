import React, { useState, useEffect, useCallback } from 'react';

// ── helpers ──────────────────────────────────────────────────────────────────

async function adminFetch(path, options = {}) {
  const res = await fetch(`/api/admin${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeAgo(d) {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function uptime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
function initials(name) {
  return (name || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}
function hashColor(str) {
  const colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

// ── sub-components ───────────────────────────────────────────────────────────

const A = {
  wrap:    { background: '#0d0d0d', minHeight: '100vh', color: '#e2e2e2', fontFamily: 'inherit' },
  header:  { height: '56px', background: '#111', borderBottom: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', padding: '0 24px', gap: '16px', position: 'sticky', top: 0, zIndex: 100 },
  surface: { background: '#161616', border: '1px solid #1e1e1e', borderRadius: '16px' },
  card:    { background: '#161616', border: '1px solid #1e1e1e', borderRadius: '14px', padding: '20px 24px' },
  btn:     { background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: '#e2e2e2' },
  input:   { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '10px', color: '#e2e2e2', padding: '8px 12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', width: '100%' },
  danger:  '#ef4444',
  success: '#10b981',
  accent:  '#7c3aed',
  muted:   '#666',
};

function StatCard({ label, value, sub, color = '#7c3aed' }) {
  return (
    <div style={{ ...A.card, minWidth: 0 }}>
      <div style={{ fontSize: '11px', fontWeight: '800', color: A.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-1.5px', color }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '11px', color: A.muted, marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function Tag({ children, color }) {
  return (
    <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: `${color}22`, color, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Avatar({ name, size = 30 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: hashColor(name || '?'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.34 + 'px', fontWeight: '800', flexShrink: 0 }}>
      {initials(name)}
    </div>
  );
}

function ConfirmModal({ message, phrase, onConfirm, onClose }) {
  const [typed, setTyped] = useState('');
  const ready = typed === phrase;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ ...A.surface, width: '100%', maxWidth: '440px', padding: '28px' }}>
        <div style={{ fontSize: '18px', fontWeight: '800', marginBottom: '10px', color: A.danger }}>⚠ Confirm Destructive Action</div>
        <div style={{ fontSize: '13px', color: '#aaa', lineHeight: '1.55', marginBottom: '20px' }}>{message}</div>
        <div style={{ fontSize: '12px', color: A.muted, marginBottom: '8px' }}>Type <strong style={{ color: '#e2e2e2', fontFamily: 'monospace' }}>{phrase}</strong> to confirm:</div>
        <input
          autoFocus
          value={typed}
          onChange={e => setTyped(e.target.value)}
          placeholder={phrase}
          style={{ ...A.input, marginBottom: '16px' }}
        />
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ ...A.btn, padding: '8px 18px', borderRadius: '10px', border: '1px solid #2a2a2a', fontSize: '13px', fontWeight: '700' }}>Cancel</button>
          <button
            onClick={() => { if (ready) { onConfirm(); onClose(); } }}
            disabled={!ready}
            style={{ ...A.btn, padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: '700', background: ready ? A.danger : '#2a2a2a', color: ready ? '#fff' : '#555', cursor: ready ? 'pointer' : 'default', transition: 'all 0.15s' }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const [stats, setStats] = useState(null);
  useEffect(() => { adminFetch('/stats').then(setStats); }, []);
  if (!stats) return <Loading />;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
      <StatCard label="Total Users"     value={stats.userCount}     color="#7c3aed" />
      <StatCard label="Projects"        value={stats.projectCount}  color="#3b82f6" />
      <StatCard label="Tasks"           value={stats.taskCount}     color="#10b981" />
      <StatCard label="Active Sessions" value={stats.sessionCount}  color="#f59e0b" />
      <StatCard label="Open Feedback"   value={stats.feedbackOpen}  sub={`${stats.feedbackCount} total`} color="#ef4444" />
      <StatCard label="DB Size"         value={`${stats.dbSizeMB} MB`} color="#6366f1" />
    </div>
  );
}

// ── tab: Users ────────────────────────────────────────────────────────────────

function UsersTab({ currentUserId, onConfirm }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grantEmail, setGrantEmail] = useState('');
  const [grantMsg, setGrantMsg] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    adminFetch('/users').then(r => { if (r.users) setUsers(r.users); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGrant = async () => {
    if (!grantEmail.trim()) return;
    const r = await adminFetch('/users/grant', { method: 'POST', body: JSON.stringify({ email: grantEmail.trim() }) });
    if (r.ok) { setGrantMsg(`✓ ${r.user.name} (${r.user.email}) is now superadmin`); setGrantEmail(''); load(); }
    else setGrantMsg(`✗ ${r.error}`);
  };

  const handleRevoke = (user) => {
    onConfirm({
      message: `Revoke superadmin from ${user.name} (${user.email})? They will lose all admin access.`,
      phrase: `REVOKE ${user.email}`,
      onConfirm: async () => {
        await adminFetch(`/users/${user.id}/revoke`, { method: 'POST' });
        load();
      },
    });
  };

  const handleDelete = (user) => {
    onConfirm({
      message: `Permanently delete ${user.name}'s account and ALL their data — projects, spaces, tasks, files. This cannot be undone.`,
      phrase: `DELETE ${user.email}`,
      onConfirm: async () => {
        await adminFetch(`/users/${user.id}`, { method: 'DELETE' });
        load();
      },
    });
  };

  const filtered = users.filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      {/* Grant admin */}
      <div style={{ ...A.card, marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <div style={{ fontSize: '11px', fontWeight: '800', color: A.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>Grant Superadmin by Email</div>
          <input
            value={grantEmail}
            onChange={e => { setGrantEmail(e.target.value); setGrantMsg(''); }}
            onKeyDown={e => e.key === 'Enter' && handleGrant()}
            placeholder="teammate@email.com"
            style={A.input}
          />
        </div>
        <button onClick={handleGrant} style={{ ...A.btn, padding: '8px 18px', borderRadius: '10px', background: A.accent, color: '#fff', fontWeight: '700', fontSize: '13px', flexShrink: 0 }}>
          Grant Admin
        </button>
        {grantMsg && <div style={{ width: '100%', fontSize: '12px', color: grantMsg.startsWith('✓') ? A.success : A.danger, marginTop: '4px' }}>{grantMsg}</div>}
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search users…"
        style={{ ...A.input, marginBottom: '14px', maxWidth: '320px' }}
      />

      {loading ? <Loading /> : (
        <div style={A.surface}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 80px 80px 100px 120px', gap: '12px', padding: '10px 20px', borderBottom: '1px solid #1e1e1e', fontSize: '10px', fontWeight: '800', color: A.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <span>User</span><span>Email</span><span>Role</span><span>Projects</span><span>Joined</span><span style={{ textAlign: 'right' }}>Actions</span>
          </div>
          {filtered.map((u, i) => (
            <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 80px 80px 100px 120px', gap: '12px', padding: '12px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #1a1a1a' : 'none', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <Avatar name={u.name} />
                <span style={{ fontSize: '13px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                {u.id === currentUserId && <Tag color="#f59e0b">You</Tag>}
              </div>
              <span style={{ fontSize: '12px', color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
              <span>
                {u.role === 'superadmin'
                  ? <Tag color={A.accent}>ADMIN</Tag>
                  : <Tag color={A.muted}>User</Tag>
                }
              </span>
              <span style={{ fontSize: '13px', color: '#aaa' }}>{u.projectCount}</span>
              <span style={{ fontSize: '12px', color: A.muted }}>{fmt(u.createdAt)}</span>
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                {u.role === 'superadmin' && u.id !== currentUserId && (
                  <button onClick={() => handleRevoke(u)} style={{ ...A.btn, fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '8px', border: `1px solid ${A.accent}44`, color: A.accent }}>Revoke</button>
                )}
                {u.role !== 'superadmin' && (
                  <button onClick={() => { setGrantEmail(u.email); window.scrollTo(0,0); }} style={{ ...A.btn, fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '8px', border: `1px solid #2a2a2a`, color: '#aaa' }}>↑ Admin</button>
                )}
                {u.id !== currentUserId && (
                  <button onClick={() => handleDelete(u)} style={{ ...A.btn, fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '8px', border: `1px solid ${A.danger}44`, color: A.danger }}>Delete</button>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: A.muted, fontSize: '13px' }}>No users found.</div>}
        </div>
      )}
    </div>
  );
}

// ── tab: Sessions ─────────────────────────────────────────────────────────────

function SessionsTab({ onConfirm }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch('/sessions').then(r => { if (r.sessions) setSessions(r.sessions); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleKick = (s) => {
    onConfirm({
      message: `Force-logout ${s.userName} (${s.userEmail})? Their session will be terminated immediately.`,
      phrase: `LOGOUT ${s.userEmail}`,
      onConfirm: async () => {
        await adminFetch(`/sessions/${s.sessionId}`, { method: 'DELETE' });
        load();
      },
    });
  };

  if (loading) return <Loading />;

  return (
    <div>
      <div style={{ fontSize: '12px', color: A.muted, marginBottom: '14px' }}>{sessions.length} active session{sessions.length !== 1 ? 's' : ''}</div>
      <div style={A.surface}>
        {sessions.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: A.muted, fontSize: '13px' }}>No active sessions.</div>}
        {sessions.map((s, i) => (
          <div key={s.sessionId} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderBottom: i < sessions.length - 1 ? '1px solid #1a1a1a' : 'none' }}>
            <Avatar name={s.userName} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: '700' }}>{s.userName} {s.isSelf && <Tag color="#f59e0b">You</Tag>}</div>
              <div style={{ fontSize: '12px', color: '#888' }}>{s.userEmail}</div>
            </div>
            <div style={{ fontSize: '11px', color: A.muted, textAlign: 'right', flexShrink: 0 }}>
              <div>expires {fmt(s.expires)}</div>
            </div>
            {!s.isSelf && (
              <button onClick={() => handleKick(s)} style={{ ...A.btn, fontSize: '11px', fontWeight: '700', padding: '4px 10px', borderRadius: '8px', border: `1px solid ${A.danger}44`, color: A.danger, flexShrink: 0 }}>Force Logout</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── tab: Feedback ─────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  bug:     { icon: '🐛', label: 'Bug',     color: '#ef4444' },
  idea:    { icon: '💡', label: 'Idea',    color: '#f59e0b' },
  general: { icon: '💬', label: 'General', color: '#6366f1' },
};

function FeedbackTab({ onConfirm }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = useCallback(() => {
    setLoading(true);
    adminFetch('/feedback').then(r => { if (r.items) setItems(r.items); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (item) => {
    onConfirm({
      message: `Delete this feedback from ${item.userName}? This is permanent.`,
      phrase: `DELETE FEEDBACK`,
      onConfirm: async () => {
        await adminFetch(`/feedback/${item.id}`, { method: 'DELETE' });
        load();
      },
    });
  };

  const handleToggleStatus = async (id) => {
    const res = await fetch(`/api/?action=toggle_feedback_status`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedbackId: id }) });
    const r = await res.json();
    if (r?.ok) setItems(prev => prev.map(it => it.id !== id ? it : { ...it, status: r.status }));
  };

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'bug', label: '🐛 Bugs' },
    { key: 'idea', label: '💡 Ideas' },
    { key: 'general', label: '💬 General' },
    { key: 'open', label: '🔴 Open' },
    { key: 'fixed', label: '✅ Fixed' },
  ];

  const filtered = items.filter(it => {
    if (filter === 'all') return true;
    if (filter === 'open') return it.status === 'open';
    if (filter === 'fixed') return it.status === 'fixed';
    return it.type === filter;
  });

  const openCount = items.filter(i => i.status === 'open').length;

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {filters.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{ ...A.btn, padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: '700', border: filter === f.key ? `1px solid ${A.accent}` : '1px solid #2a2a2a', background: filter === f.key ? A.accent : 'transparent', color: filter === f.key ? '#fff' : A.muted }}>
            {f.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: A.muted, alignSelf: 'center' }}>{openCount} open · {items.length} total</div>
      </div>

      {loading ? <Loading /> : (
        <div style={A.surface}>
          {filtered.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: A.muted, fontSize: '13px' }}>Nothing here.</div>}
          {filtered.map((item, idx) => {
            const tc = TYPE_CONFIG[item.type] || TYPE_CONFIG.general;
            return (
              <div key={item.id} style={{ padding: '14px 20px', borderBottom: idx < filtered.length - 1 ? '1px solid #1a1a1a' : 'none', opacity: item.status === 'fixed' ? 0.55 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
                  <Avatar name={item.userName} size={26} />
                  <span style={{ fontSize: '13px', fontWeight: '700' }}>{item.userName}</span>
                  <span style={{ fontSize: '11px', color: A.muted }}>{timeAgo(item.createdAt)}</span>
                  <Tag color={tc.color}>{tc.icon} {tc.label}</Tag>
                  <Tag color={item.status === 'fixed' ? A.success : A.danger}>{item.status === 'fixed' ? '✅ Fixed' : '🔴 Open'}</Tag>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                    <button onClick={() => handleToggleStatus(item.id)} style={{ ...A.btn, fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '8px', border: '1px solid #2a2a2a', color: '#aaa' }}>
                      {item.status === 'fixed' ? '↩ Reopen' : '✓ Mark Fixed'}
                    </button>
                    <button onClick={() => handleDelete(item)} style={{ ...A.btn, fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '8px', border: `1px solid ${A.danger}44`, color: A.danger }}>Delete</button>
                  </div>
                </div>
                <p style={{ margin: '0 0 0 34px', fontSize: '13px', lineHeight: '1.55', color: '#ccc', wordBreak: 'break-word' }}>{item.message}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── tab: System ───────────────────────────────────────────────────────────────

function SystemTab() {
  const [sys, setSys] = useState(null);
  useEffect(() => { adminFetch('/system').then(setSys); }, []);
  if (!sys) return <Loading />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Server info */}
      <div style={A.card}>
        <div style={{ fontSize: '11px', fontWeight: '800', color: A.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '14px' }}>Server</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
          {[
            ['Node.js', sys.nodeVersion],
            ['Uptime', uptime(sys.uptime)],
            ['Environment', sys.nodeEnv],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: '11px', color: A.muted, marginBottom: '3px' }}>{k}</div>
              <div style={{ fontSize: '14px', fontWeight: '700' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Env health */}
      <div style={A.card}>
        <div style={{ fontSize: '11px', fontWeight: '800', color: A.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '14px' }}>Environment Variables</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
          {Object.entries(sys.envHealth).map(([key, ok]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '8px', background: ok ? '#10b98110' : '#ef444410', border: `1px solid ${ok ? '#10b98130' : '#ef444430'}` }}>
              <span style={{ fontSize: '14px' }}>{ok ? '✅' : '❌'}</span>
              <span style={{ fontSize: '12px', fontWeight: '700', color: ok ? A.success : A.danger, fontFamily: 'monospace' }}>{key}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Collections */}
      <div style={A.surface}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e1e', fontSize: '11px', fontWeight: '800', color: A.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Database Collections</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', padding: '8px 20px', borderBottom: '1px solid #1e1e1e', fontSize: '10px', fontWeight: '800', color: A.muted, textTransform: 'uppercase' }}>
          <span>Collection</span><span>Documents</span><span>Size</span>
        </div>
        {sys.collections.map((c, i) => (
          <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', padding: '10px 20px', borderBottom: i < sys.collections.length - 1 ? '1px solid #1a1a1a' : 'none', fontSize: '13px' }}>
            <span style={{ fontFamily: 'monospace', color: '#aaa' }}>{c.name}</span>
            <span style={{ fontWeight: '700' }}>{c.count}</span>
            <span style={{ color: A.muted }}>{c.sizeMB} MB</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Loading() {
  return <div style={{ padding: '60px', textAlign: 'center', color: '#555', fontSize: '13px' }}>Loading…</div>;
}

// ── Main AdminView ─────────────────────────────────────────────────────────────

const TABS = ['Overview', 'Users', 'Sessions', 'Feedback', 'System'];

export default function AdminView({ currentUser, onLogout }) {
  const [tab, setTab] = useState('Overview');
  const [confirm, setConfirm] = useState(null);

  const openConfirm = ({ message, phrase, onConfirm }) => {
    setConfirm({ message, phrase, onConfirm });
  };

  return (
    <div style={A.wrap}>
      {/* Header */}
      <div style={A.header}>
        <span style={{ fontSize: '18px', fontWeight: '900', letterSpacing: '-0.5px', color: '#e2e2e2' }}>
          ⚡ BrainJot Admin
        </span>
        <span style={{ fontSize: '11px', fontWeight: '800', padding: '2px 8px', borderRadius: '6px', background: `${A.accent}22`, color: A.accent }}>SUPERADMIN</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '13px', color: '#888', marginRight: '4px' }}>{currentUser?.name}</span>
        <button
          onClick={onLogout}
          style={{ ...A.btn, fontSize: '12px', fontWeight: '700', padding: '5px 12px', borderRadius: '8px', border: '1px solid #2a2a2a', color: '#aaa' }}
        >
          Logout
        </button>
        <button
          onClick={() => { window.history.pushState({}, '', '/'); window.location.reload(); }}
          style={{ ...A.btn, fontSize: '12px', fontWeight: '700', padding: '5px 12px', borderRadius: '8px', border: '1px solid #2a2a2a', color: '#aaa' }}
        >
          ← App
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', padding: '12px 24px', borderBottom: '1px solid #1a1a1a', background: '#0d0d0d' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...A.btn, padding: '7px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '700', background: tab === t ? '#1e1e1e' : 'transparent', color: tab === t ? '#e2e2e2' : A.muted, border: tab === t ? '1px solid #2a2a2a' : '1px solid transparent' }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '28px 28px', maxWidth: '1100px', margin: '0 auto' }}>
        {tab === 'Overview'  && <OverviewTab />}
        {tab === 'Users'     && <UsersTab currentUserId={currentUser?.id} onConfirm={openConfirm} />}
        {tab === 'Sessions'  && <SessionsTab onConfirm={openConfirm} />}
        {tab === 'Feedback'  && <FeedbackTab onConfirm={openConfirm} />}
        {tab === 'System'    && <SystemTab />}
      </div>

      {confirm && (
        <ConfirmModal
          message={confirm.message}
          phrase={confirm.phrase}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
