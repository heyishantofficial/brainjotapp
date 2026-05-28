import React, { useState, useEffect, useCallback } from 'react';

// ── api helper ────────────────────────────────────────────────────────────────

async function adminFetch(path, options = {}) {
  const res = await fetch(`/api/admin${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

// ── utils ─────────────────────────────────────────────────────────────────────

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
function uptimeFmt(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
function initials(name) {
  return (name || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}
function hashColor(str) {
  const c = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return c[Math.abs(h) % c.length];
}

// ── design tokens ─────────────────────────────────────────────────────────────

const T = {
  bg:      '#0a0a0a',
  surface: '#131313',
  card:    '#161616',
  border:  '#1e1e1e',
  border2: '#252525',
  text:    '#e8e8e8',
  sub:     '#aaa',
  muted:   '#555',
  accent:  '#7c3aed',
  blue:    '#3b82f6',
  green:   '#10b981',
  amber:   '#f59e0b',
  red:     '#ef4444',
  pink:    '#ec4899',
};

const BTN = { background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: T.text };

// ── chart components ──────────────────────────────────────────────────────────

function AreaChart({ data = [], color = T.accent, height = 130 }) {
  const uid = Math.random().toString(36).slice(2);
  const W = 480, H = height;
  const pad = { t: 12, r: 8, b: 28, l: 32 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const max = Math.max(...data.map(d => d.count), 1);

  const pts = data.map((d, i) => ({
    x: pad.l + (data.length > 1 ? (i / (data.length - 1)) * cw : cw / 2),
    y: pad.t + (1 - d.count / max) * ch,
    d,
  }));

  // Smooth bezier
  let line = pts.length ? `M ${pts[0].x},${pts[0].y}` : '';
  for (let i = 1; i < pts.length; i++) {
    const cpx = (pts[i - 1].x + pts[i].x) / 2;
    line += ` C ${cpx},${pts[i - 1].y} ${cpx},${pts[i].y} ${pts[i].x},${pts[i].y}`;
  }
  const area = pts.length > 1
    ? `${line} L ${pts[pts.length - 1].x},${pad.t + ch} L ${pts[0].x},${pad.t + ch} Z`
    : '';

  const xLabels = pts.filter((_, i) => i % 6 === 0 || i === pts.length - 1);
  const yTicks  = [0, 0.5, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <defs>
        <linearGradient id={`ag${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + v * ch} y2={pad.t + v * ch} stroke={T.border} strokeWidth="1" />
          <text x={pad.l - 5} y={pad.t + v * ch + 4} textAnchor="end" fill={T.muted} fontSize="9">
            {Math.round(max * (1 - v))}
          </text>
        </g>
      ))}
      {area && <path d={area} fill={`url(#ag${uid})`} />}
      {line && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {pts.map((p, i) => p.d.count > 0 && (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color}>
          <title>{p.d.date}: {p.d.count}</title>
        </circle>
      ))}
      {xLabels.map((p, i) => (
        <text key={i} x={p.x} y={H - 4} textAnchor="middle" fill={T.muted} fontSize="9">
          {p.d.date.slice(5)}
        </text>
      ))}
    </svg>
  );
}

function DonutChart({ value = 0, total = 1, color = T.green, size = 110 }) {
  const pct  = total > 0 ? Math.round((value / total) * 100) : 0;
  const r    = 40, cx = 55, cy = 55;
  const circ = 2 * Math.PI * r;
  const off  = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} viewBox="0 0 110 110">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth="11" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="11"
        strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
      />
      <text x={cx} y={cy - 7} textAnchor="middle" fill={T.text} fontSize="20" fontWeight="900" fontFamily="inherit">{pct}%</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill={T.muted} fontSize="9" fontFamily="inherit">{value}/{total}</text>
    </svg>
  );
}

function HBarChart({ data = [], color = T.accent }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
      {data.map((d, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', color: T.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>{d.label}</span>
            <span style={{ fontSize: '12px', fontWeight: '800', color: T.text }}>{d.value}</span>
          </div>
          <div style={{ background: T.border, borderRadius: '4px', height: '5px', overflow: 'hidden' }}>
            <div style={{ background: `linear-gradient(90deg, ${color}, ${color}88)`, width: `${(d.value / max) * 100}%`, height: '100%', borderRadius: '4px', transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PriorityBars({ priority = {} }) {
  const items = [
    { label: '🔴 Urgent',    value: priority.urgent    || 0, color: T.red },
    { label: '🟡 Important', value: priority.important || 0, color: T.amber },
    { label: '🔵 Later',     value: priority.later     || 0, color: T.blue },
    { label: '⚪ None',      value: priority.none      || 0, color: T.muted },
  ];
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {items.map((item, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', color: T.sub }}>{item.label}</span>
            <span style={{ fontSize: '12px', fontWeight: '800', color: item.color }}>{item.value}</span>
          </div>
          <div style={{ background: T.border, borderRadius: '4px', height: '5px', overflow: 'hidden' }}>
            <div style={{ background: item.color, width: `${(item.value / max) * 100}%`, height: '100%', borderRadius: '4px', transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)', opacity: 0.85 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── shared ui ─────────────────────────────────────────────────────────────────

function Card({ children, style = {} }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: '16px', padding: '20px 22px', ...style }}>
      {children}
    </div>
  );
}

function CardTitle({ children }) {
  return (
    <div style={{ fontSize: '11px', fontWeight: '800', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '14px' }}>{children}</div>
  );
}

function StatCard({ label, value, sub, color = T.accent, icon }) {
  return (
    <Card style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '10px', fontWeight: '800', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>{label}</div>
          <div style={{ fontSize: '30px', fontWeight: '900', letterSpacing: '-1.5px', color, lineHeight: 1 }}>{value ?? '—'}</div>
          {sub && <div style={{ fontSize: '11px', color: T.muted, marginTop: '6px' }}>{sub}</div>}
        </div>
        {icon && <div style={{ fontSize: '22px', opacity: 0.5 }}>{icon}</div>}
      </div>
    </Card>
  );
}

function Tag({ children, color }) {
  return <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: `${color}22`, color, whiteSpace: 'nowrap' }}>{children}</span>;
}

function Avatar({ name, size = 30 }) {
  const bg = hashColor(name || '?');
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.34 + 'px', fontWeight: '800', flexShrink: 0 }}>
      {initials(name)}
    </div>
  );
}

function Loading({ height = 100 }) {
  return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.muted, fontSize: '13px' }}>Loading…</div>;
}

function ConfirmModal({ message, phrase, onConfirm, onClose }) {
  const [typed, setTyped] = useState('');
  const ok = typed === phrase;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: '18px', width: '100%', maxWidth: '440px', padding: '28px 28px 24px' }}>
        <div style={{ fontSize: '16px', fontWeight: '800', marginBottom: '10px', color: T.red }}>⚠ Confirm Action</div>
        <div style={{ fontSize: '13px', color: '#aaa', lineHeight: '1.6', marginBottom: '20px' }}>{message}</div>
        <div style={{ fontSize: '12px', color: T.muted, marginBottom: '8px' }}>
          Type <code style={{ color: T.text, background: T.surface, padding: '1px 6px', borderRadius: '5px', fontSize: '12px' }}>{phrase}</code> to confirm:
        </div>
        <input
          autoFocus value={typed}
          onChange={e => setTyped(e.target.value)}
          placeholder={phrase}
          style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${T.border2}`, borderRadius: '10px', color: T.text, padding: '9px 12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', marginBottom: '18px', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ ...BTN, padding: '8px 18px', borderRadius: '10px', border: `1px solid ${T.border2}`, fontSize: '13px', fontWeight: '700', color: T.sub }}>Cancel</button>
          <button
            onClick={() => { if (ok) { onConfirm(); onClose(); } }}
            style={{ ...BTN, padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: '700', background: ok ? T.red : '#2a2a2a', color: ok ? '#fff' : T.muted, cursor: ok ? 'pointer' : 'default', transition: 'all 0.15s' }}
          >Confirm</button>
        </div>
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab() {
  const [data, setData] = useState(null);
  useEffect(() => { adminFetch('/analytics').then(setData); }, []);
  if (!data) return <Loading height={400} />;

  const c = data.counts;
  const cr = data.completionRate;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Stat cards — row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '14px' }}>
        <StatCard label="Total Users"     value={c.users}           icon="👤" color={T.accent} sub={`${data.recentSignups?.length || 0} joined recently`} />
        <StatCard label="Projects"        value={c.projects}        icon="📁" color={T.blue}   sub={`${c.archivedProjects} archived`} />
        <StatCard label="Tasks"           value={c.tasks}           icon="✅" color={T.green}  sub={`${c.tasksDone} completed`} />
        <StatCard label="Overdue"         value={c.tasksOverdue}    icon="⏰" color={T.red}    sub="tasks past deadline" />
        <StatCard label="Files Uploaded"  value={c.files}           icon="📎" color={T.amber}  />
        <StatCard label="Active Sessions" value={c.activeSessions}  icon="🟢" color={T.green}  sub="users online now" />
        <StatCard label="Open Feedback"   value={c.feedbackOpen}    icon="🧪" color={T.pink}   sub={`${c.feedbackTotal} total`} />
        <StatCard label="DB Size"         value={`${c.dbSizeMB} MB`} icon="🗄️" color={T.muted} />
      </div>

      {/* Charts row 1 — User growth + Task completion */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '14px', alignItems: 'stretch' }}>
        <Card>
          <CardTitle>User Growth — Last 30 Days</CardTitle>
          <AreaChart data={data.userGrowth} color={T.accent} height={140} />
          <div style={{ display: 'flex', gap: '20px', marginTop: '12px' }}>
            <div><div style={{ fontSize: '10px', color: T.muted, marginBottom: '2px' }}>TOTAL</div><div style={{ fontSize: '18px', fontWeight: '900', color: T.accent }}>{c.users}</div></div>
            <div><div style={{ fontSize: '10px', color: T.muted, marginBottom: '2px' }}>THIS MONTH</div><div style={{ fontSize: '18px', fontWeight: '900', color: T.text }}>{data.userGrowth.reduce((s, d) => s + d.count, 0)}</div></div>
            <div><div style={{ fontSize: '10px', color: T.muted, marginBottom: '2px' }}>TODAY</div><div style={{ fontSize: '18px', fontWeight: '900', color: T.text }}>{data.userGrowth[data.userGrowth.length - 1]?.count || 0}</div></div>
          </div>
        </Card>

        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <CardTitle>Task Completion</CardTitle>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '20px' }}>
            <DonutChart value={c.tasksDone} total={c.tasks} color={cr >= 60 ? T.green : cr >= 30 ? T.amber : T.red} size={110} />
            <div style={{ flex: 1 }}>
              <div><div style={{ fontSize: '10px', color: T.muted }}>DONE</div><div style={{ fontSize: '18px', fontWeight: '900', color: T.green }}>{c.tasksDone}</div></div>
              <div style={{ marginTop: '8px' }}><div style={{ fontSize: '10px', color: T.muted }}>OPEN</div><div style={{ fontSize: '18px', fontWeight: '900', color: T.text }}>{c.tasksOpen}</div></div>
              <div style={{ marginTop: '8px' }}><div style={{ fontSize: '10px', color: T.muted }}>OVERDUE</div><div style={{ fontSize: '18px', fontWeight: '900', color: T.red }}>{c.tasksOverdue}</div></div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', fontWeight: '800', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>By Priority</div>
            <PriorityBars priority={data.taskPriority} />
          </div>
        </Card>
      </div>

      {/* Charts row 2 — Top users + Space distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <Card>
          <CardTitle>Top Users by Projects</CardTitle>
          <HBarChart
            data={(data.topUsers || []).map(u => ({ label: u.name || u.email, value: u.projectCount }))}
            color={T.blue}
          />
        </Card>
        <Card>
          <CardTitle>Projects by Space</CardTitle>
          <HBarChart
            data={(data.spaceDistribution || []).map(s => ({ label: s.title, value: s.count }))}
            color={T.accent}
          />
        </Card>
      </div>

      {/* Charts row 3 — Feedback trend + Recent signups */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '14px' }}>
        <Card>
          <CardTitle>Feedback Submissions — Last 30 Days</CardTitle>
          <AreaChart data={data.feedbackTrend} color={T.pink} height={130} />
          <div style={{ display: 'flex', gap: '20px', marginTop: '12px' }}>
            <div><div style={{ fontSize: '10px', color: T.muted, marginBottom: '2px' }}>TOTAL</div><div style={{ fontSize: '18px', fontWeight: '900', color: T.pink }}>{c.feedbackTotal}</div></div>
            <div><div style={{ fontSize: '10px', color: T.muted, marginBottom: '2px' }}>OPEN</div><div style={{ fontSize: '18px', fontWeight: '900', color: T.red }}>{c.feedbackOpen}</div></div>
            <div><div style={{ fontSize: '10px', color: T.muted, marginBottom: '2px' }}>FIXED</div><div style={{ fontSize: '18px', fontWeight: '900', color: T.green }}>{c.feedbackTotal - c.feedbackOpen}</div></div>
          </div>
        </Card>

        <Card>
          <CardTitle>Recent Signups</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {(data.recentSignups || []).map((u, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Avatar name={u.name} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                  <div style={{ fontSize: '11px', color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                </div>
                <div style={{ fontSize: '10px', color: T.muted, flexShrink: 0 }}>{timeAgo(u.createdAt)}</div>
                {u.role === 'superadmin' && <Tag color={T.accent}>Admin</Tag>}
              </div>
            ))}
            {!data.recentSignups?.length && <div style={{ color: T.muted, fontSize: '12px' }}>No users yet.</div>}
          </div>
        </Card>
      </div>

      {/* Row 4 — Task user activity */}
      <Card>
        <CardTitle>User Activity — Projects + Tasks</CardTitle>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '500px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                {['User', 'Email', 'Projects', 'Tasks', 'Ratio'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '800', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.topUsers || []).map((u, i) => {
                const ratio = u.projectCount ? (u.taskCount / u.projectCount).toFixed(1) : '0';
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Avatar name={u.name} size={26} />
                        <span style={{ fontSize: '13px', fontWeight: '700' }}>{u.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: T.sub }}>{u.email}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ background: T.blue, height: '5px', borderRadius: '4px', width: `${Math.min((u.projectCount / Math.max(...(data.topUsers||[]).map(x=>x.projectCount), 1)) * 60, 60)}px` }} />
                        <span style={{ fontSize: '13px', fontWeight: '800', color: T.blue }}>{u.projectCount}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ background: T.green, height: '5px', borderRadius: '4px', width: `${Math.min((u.taskCount / Math.max(...(data.topUsers||[]).map(x=>x.taskCount), 1)) * 60, 60)}px` }} />
                        <span style={{ fontSize: '13px', fontWeight: '800', color: T.green }}>{u.taskCount}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: T.muted }}>{ratio} tasks/project</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab({ currentUserId, onConfirm }) {
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [grantEmail, setGrant]  = useState('');
  const [grantMsg, setGrantMsg] = useState('');
  const [search, setSearch]     = useState('');
  const [sortBy, setSortBy]     = useState('projects');

  const load = useCallback(() => {
    setLoading(true);
    adminFetch('/users').then(r => { if (r.users) setUsers(r.users); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleGrant = async () => {
    if (!grantEmail.trim()) return;
    const r = await adminFetch('/users/grant', { method: 'POST', body: JSON.stringify({ email: grantEmail.trim() }) });
    if (r.ok) { setGrantMsg(`✓ ${r.user.name} is now superadmin`); setGrant(''); load(); }
    else setGrantMsg(`✗ ${r.error}`);
  };

  const handleRevoke = u => onConfirm({
    message: `Remove superadmin from ${u.name} (${u.email})?`,
    phrase:  `REVOKE ${u.email}`,
    onConfirm: async () => { await adminFetch(`/users/${u.id}/revoke`, { method: 'POST' }); load(); },
  });

  const handleDelete = u => onConfirm({
    message: `Permanently delete ${u.name}'s account. All their projects, spaces, tasks and files will be wiped. This cannot be undone.`,
    phrase:  `DELETE ${u.email}`,
    onConfirm: async () => { await adminFetch(`/users/${u.id}`, { method: 'DELETE' }); load(); },
  });

  let filtered = users.filter(u =>
    !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
  );
  filtered = [...filtered].sort((a, b) =>
    sortBy === 'projects' ? b.projectCount - a.projectCount :
    sortBy === 'newest'   ? new Date(b.createdAt) - new Date(a.createdAt) :
    (a.name || '').localeCompare(b.name || '')
  );

  const adminCount = users.filter(u => u.role === 'superadmin').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        <StatCard label="Total Users"  value={users.length}  color={T.accent} />
        <StatCard label="Admins"       value={adminCount}    color={T.amber} />
        <StatCard label="Regular Users" value={users.length - adminCount} color={T.blue} />
      </div>

      {/* Grant admin */}
      <Card>
        <CardTitle>Grant Superadmin</CardTitle>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            value={grantEmail}
            onChange={e => { setGrant(e.target.value); setGrantMsg(''); }}
            onKeyDown={e => e.key === 'Enter' && handleGrant()}
            placeholder="teammate@email.com"
            style={{ flex: 1, minWidth: '240px', background: '#1a1a1a', border: `1px solid ${T.border2}`, borderRadius: '10px', color: T.text, padding: '9px 12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}
          />
          <button onClick={handleGrant} style={{ ...BTN, padding: '9px 18px', borderRadius: '10px', background: T.accent, color: '#fff', fontWeight: '700', fontSize: '13px', flexShrink: 0 }}>Grant Admin</button>
        </div>
        {grantMsg && <div style={{ fontSize: '12px', color: grantMsg.startsWith('✓') ? T.green : T.red, marginTop: '8px' }}>{grantMsg}</div>}
      </Card>

      {/* Search + sort */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users…"
          style={{ flex: 1, minWidth: '200px', background: '#1a1a1a', border: `1px solid ${T.border2}`, borderRadius: '10px', color: T.text, padding: '8px 12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }} />
        <div style={{ display: 'flex', gap: '6px' }}>
          {[['projects', 'By Projects'], ['newest', 'Newest'], ['name', 'A–Z']].map(([k, l]) => (
            <button key={k} onClick={() => setSortBy(k)} style={{ ...BTN, padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', border: `1px solid ${sortBy === k ? T.accent : T.border}`, background: sortBy === k ? `${T.accent}22` : 'transparent', color: sortBy === k ? T.accent : T.muted }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? <Loading /> : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: '16px', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '650px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['User', 'Email', 'Role', 'Projects', 'Joined', 'Actions'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: i === 5 ? 'right' : 'left', fontSize: '10px', fontWeight: '800', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, i) => (
                  <tr key={u.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                        <Avatar name={u.name} size={28} />
                        <span style={{ fontSize: '13px', fontWeight: '700' }}>{u.name}</span>
                        {u.id === currentUserId && <Tag color={T.amber}>You</Tag>}
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: '12px', color: T.sub }}>{u.email}</td>
                    <td style={{ padding: '11px 16px' }}>
                      {u.role === 'superadmin' ? <Tag color={T.accent}>⚡ Admin</Tag> : <Tag color={T.muted}>User</Tag>}
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: '13px', fontWeight: '700', color: T.blue }}>{u.projectCount}</td>
                    <td style={{ padding: '11px 16px', fontSize: '12px', color: T.muted, whiteSpace: 'nowrap' }}>{fmt(u.createdAt)}</td>
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        {u.role !== 'superadmin' && (
                          <button onClick={() => { setGrant(u.email); }} style={{ ...BTN, fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '7px', border: `1px solid ${T.border2}`, color: T.sub }}>↑ Admin</button>
                        )}
                        {u.role === 'superadmin' && u.id !== currentUserId && (
                          <button onClick={() => handleRevoke(u)} style={{ ...BTN, fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '7px', border: `1px solid ${T.accent}44`, color: T.accent }}>Revoke</button>
                        )}
                        {u.id !== currentUserId && (
                          <button onClick={() => handleDelete(u)} style={{ ...BTN, fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '7px', border: `1px solid ${T.red}44`, color: T.red }}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: T.muted, fontSize: '13px' }}>No users found.</div>}
        </div>
      )}
    </div>
  );
}

// ── Sessions tab ──────────────────────────────────────────────────────────────

function SessionsTab({ onConfirm }) {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch('/sessions').then(r => { if (r.sessions) setSessions(r.sessions); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleKick = s => onConfirm({
    message: `Force-logout ${s.userName} (${s.userEmail})? Their session will be terminated immediately.`,
    phrase:  `LOGOUT ${s.userEmail}`,
    onConfirm: async () => { await adminFetch(`/sessions/${s.sessionId}`, { method: 'DELETE' }); load(); },
  });

  if (loading) return <Loading />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', maxWidth: '400px' }}>
        <StatCard label="Active Sessions" value={sessions.length} color={T.green} />
        <StatCard label="Unique Users"    value={new Set(sessions.map(s => s.userId)).size} color={T.blue} />
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {sessions.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: T.muted, fontSize: '13px' }}>No active sessions right now.</div>}
        {sessions.map((s, i) => (
          <div key={s.sessionId} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderBottom: i < sessions.length - 1 ? `1px solid ${T.border}` : 'none' }}>
            <Avatar name={s.userName} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {s.userName} {s.isSelf && <Tag color={T.amber}>You</Tag>}
              </div>
              <div style={{ fontSize: '12px', color: T.sub }}>{s.userEmail}</div>
            </div>
            <div style={{ fontSize: '11px', color: T.muted, textAlign: 'right', flexShrink: 0 }}>
              <div>expires</div>
              <div>{fmt(s.expires)}</div>
            </div>
            {!s.isSelf && (
              <button onClick={() => handleKick(s)} style={{ ...BTN, fontSize: '11px', fontWeight: '700', padding: '5px 10px', borderRadius: '8px', border: `1px solid ${T.red}44`, color: T.red, flexShrink: 0 }}>Force Logout</button>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── Feedback tab ──────────────────────────────────────────────────────────────

const TYPE_CFG = {
  bug:     { icon: '🐛', label: 'Bug',     color: T.red },
  idea:    { icon: '💡', label: 'Idea',    color: T.amber },
  general: { icon: '💬', label: 'General', color: '#6366f1' },
};

function FeedbackTab({ onConfirm }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');

  const load = useCallback(() => {
    setLoading(true);
    adminFetch('/feedback').then(r => { if (r.items) setItems(r.items); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleDelete = item => onConfirm({
    message: `Delete this feedback from ${item.userName}? Permanent.`,
    phrase:  'DELETE FEEDBACK',
    onConfirm: async () => { await adminFetch(`/feedback/${item.id}`, { method: 'DELETE' }); load(); },
  });

  const handleToggle = async id => {
    const r = await (await fetch('/api/?action=toggle_feedback_status', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedbackId: id }) })).json();
    if (r?.ok) setItems(prev => prev.map(it => it.id !== id ? it : { ...it, status: r.status }));
  };

  const filters = [
    { key: 'all', label: 'All' }, { key: 'bug', label: '🐛 Bugs' }, { key: 'idea', label: '💡 Ideas' },
    { key: 'general', label: '💬 General' }, { key: 'open', label: '🔴 Open' }, { key: 'fixed', label: '✅ Fixed' },
  ];
  const filtered = items.filter(it =>
    filter === 'all' ? true : filter === 'open' ? it.status === 'open' : filter === 'fixed' ? it.status === 'fixed' : it.type === filter
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <StatCard label="Total"   value={items.length}                              color={T.accent} />
        <StatCard label="Open"    value={items.filter(i => i.status === 'open').length}  color={T.red} />
        <StatCard label="Fixed"   value={items.filter(i => i.status === 'fixed').length} color={T.green} />
        <StatCard label="Bugs"    value={items.filter(i => i.type === 'bug').length}     color={T.amber} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {filters.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{ ...BTN, padding: '5px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: '700', border: `1px solid ${filter === f.key ? T.accent : T.border}`, background: filter === f.key ? `${T.accent}22` : 'transparent', color: filter === f.key ? T.accent : T.muted }}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? <Loading /> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {filtered.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: T.muted, fontSize: '13px' }}>Nothing here.</div>}
          {filtered.map((item, idx) => {
            const tc = TYPE_CFG[item.type] || TYPE_CFG.general;
            return (
              <div key={item.id} style={{ padding: '14px 20px', borderBottom: idx < filtered.length - 1 ? `1px solid ${T.border}` : 'none', opacity: item.status === 'fixed' ? 0.55 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px', flexWrap: 'wrap' }}>
                  <Avatar name={item.userName} size={26} />
                  <span style={{ fontSize: '13px', fontWeight: '700' }}>{item.userName}</span>
                  <span style={{ fontSize: '11px', color: T.muted }}>{timeAgo(item.createdAt)}</span>
                  <Tag color={tc.color}>{tc.icon} {tc.label}</Tag>
                  <Tag color={item.status === 'fixed' ? T.green : T.red}>{item.status === 'fixed' ? '✅ Fixed' : '🔴 Open'}</Tag>
                  <span style={{ fontSize: '11px', color: T.muted }}>👍 {item.upvoteCount}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                    <button onClick={() => handleToggle(item.id)} style={{ ...BTN, fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '7px', border: `1px solid ${T.border2}`, color: T.sub }}>
                      {item.status === 'fixed' ? '↩ Reopen' : '✓ Fix'}
                    </button>
                    <button onClick={() => handleDelete(item)} style={{ ...BTN, fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '7px', border: `1px solid ${T.red}44`, color: T.red }}>Delete</button>
                  </div>
                </div>
                <p style={{ margin: '0 0 0 34px', fontSize: '13px', lineHeight: '1.55', color: '#ccc', wordBreak: 'break-word' }}>{item.message}</p>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

// ── System tab ────────────────────────────────────────────────────────────────

function SystemTab() {
  const [sys, setSys] = useState(null);
  useEffect(() => { adminFetch('/system').then(setSys); }, []);
  if (!sys) return <Loading />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Server info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        <StatCard label="Node.js"     value={sys.nodeVersion} color={T.green} />
        <StatCard label="Uptime"      value={uptimeFmt(sys.uptime)} color={T.blue} />
        <StatCard label="Environment" value={sys.nodeEnv}    color={sys.nodeEnv === 'production' ? T.green : T.amber} />
      </div>

      {/* Env health */}
      <Card>
        <CardTitle>Environment Variables</CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
          {Object.entries(sys.envHealth).map(([key, ok]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px', borderRadius: '10px', background: ok ? '#10b98110' : '#ef444410', border: `1px solid ${ok ? '#10b98130' : '#ef444430'}` }}>
              <span>{ok ? '✅' : '❌'}</span>
              <span style={{ fontSize: '12px', fontWeight: '700', color: ok ? T.green : T.red, fontFamily: 'monospace' }}>{key}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Collections */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, fontSize: '11px', fontWeight: '800', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Database Collections</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              {['Collection', 'Documents', 'Size (MB)'].map((h, i) => (
                <th key={h} style={{ padding: '8px 20px', textAlign: 'left', fontSize: '10px', fontWeight: '800', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sys.collections.map((c, i) => (
              <tr key={c.name} style={{ borderBottom: i < sys.collections.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                <td style={{ padding: '10px 20px', fontFamily: 'monospace', fontSize: '13px', color: T.sub }}>{c.name}</td>
                <td style={{ padding: '10px 20px', fontSize: '13px', fontWeight: '700' }}>{c.count}</td>
                <td style={{ padding: '10px 20px', fontSize: '13px', color: T.muted }}>{c.sizeMB}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'Overview',  icon: '📊' },
  { key: 'Users',     icon: '👥' },
  { key: 'Sessions',  icon: '🟢' },
  { key: 'Feedback',  icon: '💬' },
  { key: 'System',    icon: '⚙️' },
];

export default function AdminView({ currentUser, onLogout }) {
  const [tab,     setTab]     = useState('Overview');
  const [confirm, setConfirm] = useState(null);

  const openConfirm = ({ message, phrase, onConfirm }) => setConfirm({ message, phrase, onConfirm });

  return (
    <div style={{ background: T.bg, minHeight: '100vh', color: T.text, fontFamily: 'inherit' }}>

      {/* Header */}
      <div style={{ height: '54px', background: T.surface, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', padding: '0 22px', gap: '14px', position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ fontSize: '17px', fontWeight: '900', letterSpacing: '-0.3px' }}>⚡ BrainJot Admin</span>
        <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '6px', background: `${T.accent}22`, color: T.accent, letterSpacing: '0.06em' }}>SUPERADMIN</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '13px', color: T.sub }}>{currentUser?.name}</span>
        <button onClick={() => { window.history.pushState({}, '', '/'); window.location.reload(); }}
          style={{ ...BTN, fontSize: '12px', fontWeight: '700', padding: '5px 12px', borderRadius: '8px', border: `1px solid ${T.border2}`, color: T.sub }}>
          ← App
        </button>
        <button onClick={onLogout}
          style={{ ...BTN, fontSize: '12px', fontWeight: '700', padding: '5px 12px', borderRadius: '8px', border: `1px solid ${T.border2}`, color: T.sub }}>
          Logout
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', padding: '10px 22px', borderBottom: `1px solid ${T.border}`, background: T.bg, position: 'sticky', top: '54px', zIndex: 99 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ ...BTN, padding: '7px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: '700', background: tab === t.key ? T.card : 'transparent', color: tab === t.key ? T.text : T.muted, border: `1px solid ${tab === t.key ? T.border2 : 'transparent'}`, display: 'flex', alignItems: 'center', gap: '6px' }}>
            {t.icon} {t.key}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '24px 22px', maxWidth: '1100px', margin: '0 auto' }}>
        {tab === 'Overview' && <OverviewTab />}
        {tab === 'Users'    && <UsersTab currentUserId={currentUser?.id} onConfirm={openConfirm} />}
        {tab === 'Sessions' && <SessionsTab onConfirm={openConfirm} />}
        {tab === 'Feedback' && <FeedbackTab onConfirm={openConfirm} />}
        {tab === 'System'   && <SystemTab />}
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
