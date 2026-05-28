import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import Avatar from './Avatar';

const ROLE_LABELS = {
  editor:    { label: 'Editor',    desc: 'Can add, edit & complete tasks in all projects', icon: '✏️', color: '#6366f1' },
  commenter: { label: 'Commenter', desc: 'Can view tasks and add comments',                icon: '💬', color: '#10b981' },
  viewer:    { label: 'Viewer',    desc: 'Can view tasks and notes only',                  icon: '👁',  color: '#8b5cf6' },
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

function getSpaceInviteLink(spaceId) {
  const key = `brainjot_space_invite_${spaceId}`;
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    localStorage.setItem(key, token);
  }
  return `${window.location.origin}/?space_invite=${token}`;
}

function regenerateSpaceInviteLink(spaceId) {
  const key = `brainjot_space_invite_${spaceId}`;
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  localStorage.setItem(key, token);
  return `${window.location.origin}/?space_invite=${token}`;
}

export default function SpaceCollabModal({ spaceId, space, onClose, onUpdate, onUpdateRole, onToast }) {
  const [activeTab, setActiveTab] = useState('members');
  const [usernameInput, setUsernameInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [role, setRole] = useState('editor');
  const [inviteLink, setInviteLink] = useState(() => getSpaceInviteLink(spaceId));
  const [linkCopied, setLinkCopied] = useState(false);
  const [changingRoleId, setChangingRoleId] = useState(null);
  const [collabs, setCollabs] = useState(space?.collaborators || []);
  const [inviteMsg, setInviteMsg] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!usernameInput || usernameInput.length < 2) { setSearchResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const r = await api('find_user', null, 'GET', `&q=${encodeURIComponent(usernameInput)}`);
      setSearchResults(r?.users || []);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [usernameInput]);

  const submit = async () => {
    if (!selectedUser) { setInviteMsg('Select a user from search results'); return; }
    setInviteMsg('');
    const r = await api('send_collab_invite', { username: selectedUser.username, entityId: spaceId, entityType: 'space', role });
    if (r?.ok) {
      setInviteMsg(`✓ Invite sent to @${selectedUser.username}`);
      setSelectedUser(null); setUsernameInput(''); setSearchResults([]);
    } else {
      setInviteMsg(r?.error || 'Something went wrong');
    }
  };

  const removeCollab = async (cid) => {
    setCollabs(prev => prev.filter(c => c.id !== cid));
    await api('remove_space_collaborator', { spaceId, collaboratorId: cid });
    onUpdate();
    onToast('Collaborator removed from space');
  };

  const changeRole = async (cid, newRole) => {
    setCollabs(prev => prev.map(c => c.id === cid ? { ...c, role: newRole } : c));
    setChangingRoleId(null);
    await api('update_space_collaborator_role', { spaceId, collaboratorId: cid, role: newRole });
    onUpdateRole(spaceId, cid, newRole);
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
    const newLink = regenerateSpaceInviteLink(spaceId);
    setInviteLink(newLink);
    onToast('Space invite link regenerated');
  };

  return (
    <div className="modal-bg open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal collab-modal">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div className="modal-title" style={{ margin: 0 }}>
            Space Collaborators
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
          <button className={`collab-tab ${activeTab === 'members' ? 'active' : ''}`} onClick={() => setActiveTab('members')}>Members</button>
          <button className={`collab-tab ${activeTab === 'invite' ? 'active' : ''}`} onClick={() => setActiveTab('invite')}>+ Invite</button>
        </div>

        {/* ── TAB: MEMBERS ── */}
        {activeTab === 'members' && (
          <div style={{ marginTop: '16px' }}>
            {/* Owner row */}
            <div className="collab-member-row">
              <div className="collab-member-avatar" style={{ background: '#D4FF32', color: '#000' }}>YO</div>
              <div className="collab-member-info">
                <div className="collab-member-name">You (Owner)</div>
                <div className="collab-member-email">Space owner — full access to all projects</div>
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
                    <Avatar name={c.name} src={c.avatarUrl} size={40} style={{ border: '2px solid var(--border)' }} />
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

                  <button className="collab-remove-btn" onClick={() => removeCollab(c.id)} title="Remove collaborator">✕</button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── TAB: INVITE ── */}
        {activeTab === 'invite' && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
              Invite by @username
            </div>

            <div className="modal-field" style={{ position: 'relative' }}>
              <label>Search username</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontWeight: '700' }}>@</span>
                <input type="text" placeholder="username" style={{ paddingLeft: '26px' }}
                  value={usernameInput}
                  onChange={e => { setUsernameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setSelectedUser(null); setInviteMsg(''); }}
                />
              </div>
              {searchResults.length > 0 && !selectedUser && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', zIndex: 100, overflow: 'hidden', marginTop: '4px', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                  {searchResults.map(u => (
                    <button key={u.id} onClick={() => { setSelectedUser(u); setUsernameInput(u.username); setSearchResults([]); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <Avatar name={u.name} src={u.avatarUrl} size={32} />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text)' }}>{u.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--accent)' }}>@{u.username}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedUser && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--surface2)', borderRadius: '12px', marginBottom: '12px', border: '1px solid var(--border)' }}>
                <Avatar name={selectedUser.name} src={selectedUser.avatarUrl} size={36} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: '700' }}>{selectedUser.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--accent)' }}>@{selectedUser.username}</div>
                </div>
                <button onClick={() => { setSelectedUser(null); setUsernameInput(''); }} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
              </div>
            )}

            <div className="modal-field">
              <label>Access level</label>
              <div className="role-toggle-group">
                {Object.entries(ROLE_LABELS).map(([key, info]) => (
                  <button key={key} className={`role-toggle-btn ${role === key ? 'active' : ''}`} onClick={() => setRole(key)}>
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

            <button className="btn-save" style={{ width: '100%', marginBottom: '8px' }} onClick={submit} disabled={!selectedUser}>
              Send Invite
            </button>
            {inviteMsg && (
              <div style={{ fontSize: '13px', color: inviteMsg.startsWith('✓') ? '#10b981' : '#ef4444', marginBottom: '16px', textAlign: 'center' }}>{inviteMsg}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
