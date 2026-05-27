import React, { useState } from 'react';
import { api } from '../api';

/**
 * CollabModal — Full collaboration management panel
 *
 * Tabs:
 *   1. Members — list all collaborators, their roles, online status, remove/change role
 *   2. Invite  — invite by email (with role), share invite link
 *
 * TODO when backend is ready:
 *   - invite_collaborator: also pass { role } field
 *   - add endpoint: PATCH /api/collaborator/role { projectId, collaboratorId, role }
 *   - add endpoint: POST  /api/project/regenerate-link { projectId }
 *   - add endpoint: GET   /api/project/presence { projectId } → { onlineIds: [] }
 */

const ROLE_LABELS = {
  editor: { label: 'Editor', desc: 'Can add, edit & complete tasks', icon: '✏️', color: '#6366f1' },
  commenter: { label: 'Commenter', desc: 'Can view tasks and add comments', icon: '💬', color: '#10b981' },
  viewer: { label: 'Viewer', desc: 'Can view tasks and notes only',   icon: '👁',  color: '#8b5cf6' },
};

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function hashColor(str) {
  const colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

// Generate or retrieve invite link for this project (stored in localStorage until backend ready)
function getInviteLink(projectId) {
  const key = `brainjot_invite_${projectId}`;
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    localStorage.setItem(key, token);
  }
  // TODO: replace with real server-generated token from POST /api/project/invite-link
  return `${window.location.origin}/invite/${token}`;
}

function regenerateInviteLink(projectId) {
  const key = `brainjot_invite_${projectId}`;
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  localStorage.setItem(key, token);
  // TODO: call POST /api/project/regenerate-link { projectId } to invalidate old link on server
  return `${window.location.origin}/invite/${token}`;
}

export default function CollabModal({ projectId, project, onClose, onUpdate, onUpdateRole, onToast }) {
  const [activeTab, setActiveTab] = useState('members');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [inviteLink, setInviteLink] = useState(() => getInviteLink(projectId));
  const [linkCopied, setLinkCopied] = useState(false);
  const [changingRoleId, setChangingRoleId] = useState(null);

  const collabs = project?.collaborators || [];

  const submit = async () => {
    if (!email.trim()) return;
    // Mock update: update local object immutably
    if (project && project.collaborators) {
      project.collaborators.push({ id: 'c' + Date.now(), name: name || email, email, role });
    }
    await api('invite_collaborator', { projectId, name, email, role });
    setName(''); setEmail(''); setRole('editor');
    onUpdate();
    onToast(`${name || email} invited as ${ROLE_LABELS[role].label}!`);
    setActiveTab('members');
  };

  const removeCollab = async (cid) => {
    await api('remove_collaborator', { projectId, collaboratorId: cid });
    onUpdate();
    onToast('Collaborator removed');
  };

  const changeRole = async (cid, newRole) => {
    await api('update_collaborator_role', { projectId, collaboratorId: cid, role: newRole });
    onUpdateRole(projectId, cid, newRole);
    setChangingRoleId(null);
    onToast(`Role updated to ${ROLE_LABELS[newRole].label}`);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      onToast('Could not copy — please copy manually');
    }
  };

  const regenerate = () => {
    const newLink = regenerateInviteLink(projectId);
    setInviteLink(newLink);
    onToast('Invite link regenerated');
  };

  return (
    <div className="modal-bg open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal collab-modal">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div className="modal-title" style={{ margin: 0 }}>
            👥 Collaborators
            {collabs.length > 0 && (
              <span style={{ marginLeft: '8px', fontSize: '13px', fontWeight: '700', background: 'var(--surface3)', color: 'var(--muted)', padding: '2px 8px', borderRadius: '20px' }}>
                {collabs.length}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>✕</button>
        </div>

        {/* Tabs */}
        <div className="collab-tabs">
          <button className={`collab-tab ${activeTab === 'members' ? 'active' : ''}`} onClick={() => setActiveTab('members')}>
            Members
          </button>
          <button className={`collab-tab ${activeTab === 'invite' ? 'active' : ''}`} onClick={() => setActiveTab('invite')}>
            + Invite
          </button>
        </div>

        {/* ── TAB: MEMBERS ── */}
        {activeTab === 'members' && (
          <div style={{ marginTop: '16px' }}>
            {/* Owner row */}
            <div className="collab-member-row">
              <div className="collab-member-avatar" style={{ background: '#D4FF32', color: '#000' }}>
                YO
              </div>
              <div className="collab-member-info">
                <div className="collab-member-name">You (Owner)</div>
                <div className="collab-member-email">Project owner</div>
              </div>
              <div className="collab-role-badge" style={{ background: 'rgba(212,255,50,0.1)', color: '#D4FF32', borderColor: 'rgba(212,255,50,0.2)' }}>
                👑 Owner
              </div>
            </div>

            {collabs.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: '13px', padding: '24px 0' }}>
                No collaborators yet.<br />
                <button onClick={() => setActiveTab('invite')} style={{ marginTop: '8px', background: 'transparent', border: 'none', color: 'var(--accent)', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                  + Invite someone
                </button>
              </div>
            )}

            {collabs.map(c => {
              const memberRole = c.role || 'editor';
              const roleInfo = ROLE_LABELS[memberRole];
              const isChanging = changingRoleId === c.id;

              return (
                <div key={c.id} className="collab-member-row">
                  {/* Avatar with presence dot */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div className="collab-member-avatar" style={{ background: hashColor(c.name || c.id) }}>
                      {initials(c.name)}
                    </div>
                    {/* TODO: Replace with real presence data from usePresence hook */}
                    {/* Simulated: show online dot for first collaborator as demo */}
                    {c.id === collabs[0]?.id && (
                      <div className="presence-dot online" title="Online now" />
                    )}
                  </div>

                  <div className="collab-member-info">
                    <div className="collab-member-name">{c.name}</div>
                    <div className="collab-member-email">{c.email}</div>
                  </div>

                  {/* Role badge + change role */}
                  <div style={{ position: 'relative', marginLeft: 'auto', marginRight: '8px' }}>
                    <button
                      className="collab-role-badge"
                      style={{ background: `${roleInfo.color}18`, color: roleInfo.color, borderColor: `${roleInfo.color}40`, cursor: 'pointer' }}
                      onClick={() => setChangingRoleId(isChanging ? null : c.id)}
                    >
                      {roleInfo.icon} {roleInfo.label} ▾
                    </button>

                    {isChanging && (
                      <div className="role-dropdown">
                        {Object.entries(ROLE_LABELS).map(([key, info]) => (
                          <button
                            key={key}
                            className={`role-option ${memberRole === key ? 'active' : ''}`}
                            onClick={() => changeRole(c.id, key)}
                          >
                            <span style={{ fontSize: '15px' }}>{info.icon}</span>
                            <div>
                              <div style={{ fontWeight: '700', fontSize: '13px' }}>{info.label}</div>
                              <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '1px' }}>{info.desc}</div>
                            </div>
                            {memberRole === key && <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button className="collab-remove-btn" onClick={() => removeCollab(c.id)} title="Remove collaborator">
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── TAB: INVITE ── */}
        {activeTab === 'invite' && (
          <div style={{ marginTop: '16px' }}>
            {/* Invite by email */}
            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
              Invite by email
            </div>
            <div className="modal-field">
              <label>Name</label>
              <input type="text" placeholder="e.g. Priya Sharma" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="modal-field">
              <label>Email *</label>
              <input type="email" placeholder="e.g. priya@example.com" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()} />
            </div>

            {/* Role Toggle */}
            <div className="modal-field">
              <label>Access level</label>
              <div className="role-toggle-group">
                {Object.entries(ROLE_LABELS).map(([key, info]) => (
                  <button
                    key={key}
                    className={`role-toggle-btn ${role === key ? 'active' : ''}`}
                    onClick={() => setRole(key)}
                  >
                    <span style={{ fontSize: '16px' }}>{info.icon}</span>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: '700', fontSize: '13px' }}>{info.label}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '1px' }}>{info.desc}</div>
                    </div>
                    {role === key && <div className="role-check">✓</div>}
                  </button>
                ))}
              </div>
            </div>

            <button className="btn-save" style={{ width: '100%', marginBottom: '24px' }} onClick={submit}>
              Send invite
            </button>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--border2)' }} />
              <span style={{ fontSize: '11px', color: 'var(--faint)', fontWeight: '700' }}>OR SHARE A LINK</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--border2)' }} />
            </div>

            {/* Invite link */}
            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              🔗 Anyone with this link joins as Viewer
            </div>
            <div className="invite-link-box">
              <div className="invite-link-text">{inviteLink}</div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button className="invite-link-btn" onClick={copyLink}>
                  {linkCopied ? '✓ Copied!' : 'Copy'}
                </button>
                <button className="invite-link-btn secondary" onClick={regenerate} title="Generate a new link (invalidates old one)">
                  ↺
                </button>
              </div>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--faint)', marginTop: '6px' }}>
              {/* TODO: Note about server-side validation */}
              Link joins are view-only. Regenerating invalidates the previous link.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
