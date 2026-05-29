import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api';
import Avatar from './Avatar';

const ROLE_LABELS = {
  editor: { label: 'Editor', desc: 'Can add, edit & complete tasks in all projects', icon: '✏️', color: '#6366f1' },
  viewer: { label: 'Viewer', desc: 'Can view tasks and notes only',                  icon: '👁',  color: '#8b5cf6' },
};

export default function SpaceCollabModal({ spaceId, space, onClose, onUpdate, onUpdateRole, onToast, currentUser }) {
  const [activeTab, setActiveTab] = useState('members');
  const dialogRef = useRef(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const prev = document.activeElement;
    el.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')[0]?.focus();
    const trap = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(el.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    el.addEventListener('keydown', trap);
    return () => { el.removeEventListener('keydown', trap); prev?.focus(); };
  }, [onClose]);
  const [emailInput, setEmailInput] = useState('');
  const [role, setRole] = useState('editor');
  const [inviteMsg, setInviteMsg] = useState('');
  const [changingRoleId, setChangingRoleId] = useState(null);
  const [collabs, setCollabs] = useState(space?.collaborators || []);
  // Invite link state
  const [inviteLink, setInviteLink] = useState(() =>
    space?.inviteToken ? `${window.location.origin}/?join=${space.inviteToken}` : ''
  );
  const [linkRole, setLinkRole] = useState(space?.inviteLinkRole || 'editor');
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);

  const submit = async () => {
    if (!emailInput.trim()) { setInviteMsg('Enter an email address'); return; }
    setInviteMsg('');
    const r = await api('send_collab_invite', { email: emailInput.trim(), entityId: spaceId, entityType: 'space', role });
    if (r?.ok) {
      setInviteMsg(r.notFound
        ? `✓ Signup invite emailed to ${emailInput.trim()}`
        : `✓ Invite sent to ${r.invitedName || emailInput.trim()}`);
      setEmailInput('');
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

  const generateLink = async () => {
    setLinkLoading(true);
    const r = await api('generate_invite_link', { entityId: spaceId, entityType: 'space', role: linkRole });
    setLinkLoading(false);
    if (r?.token) {
      setInviteLink(`${window.location.origin}/?join=${r.token}`);
      onToast('Invite link generated');
    }
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

  const ownerInitials = (currentUser?.name || 'YO').split(' ').filter(Boolean).map(n => n[0].toUpperCase()).join('').slice(0, 2) || 'YO';

  return (
    <div className="modal-bg open" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal collab-modal" role="dialog" aria-modal="true" aria-labelledby="space-collab-modal-title" ref={dialogRef}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div className="modal-title" id="space-collab-modal-title" style={{ margin: 0 }}>
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
            <div className="collab-member-row">
              <div className="collab-member-avatar" style={{ background: '#D4FF32', color: '#000' }}>{ownerInitials}</div>
              <div className="collab-member-info">
                <div className="collab-member-name">{currentUser?.name || 'You'} (Owner)</div>
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
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <Avatar name={c.name} src={c.avatarUrl} size={40} style={{ border: '2px solid var(--border)' }} />
                  </div>
                  <div className="collab-member-info">
                    <div className="collab-member-name">{c.name}</div>
                    <div className="collab-member-email">{c.email}</div>
                  </div>
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
                          <button key={key} className={`role-option ${memberRole === key ? 'active' : ''}`} onClick={() => changeRole(c.id, key)}>
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
              Invite by email
            </div>

            <div className="modal-field">
              <label>Email address</label>
              <input
                type="email"
                placeholder="colleague@email.com"
                value={emailInput}
                onChange={e => { setEmailInput(e.target.value); setInviteMsg(''); }}
                onKeyDown={e => e.key === 'Enter' && submit()}
              />
            </div>

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

            <button className="btn-save" style={{ width: '100%', marginBottom: '8px' }} onClick={submit} disabled={!emailInput.trim()}>
              Send Invite
            </button>
            {inviteMsg && (
              <div style={{ fontSize: '13px', color: inviteMsg.startsWith('✓') ? '#10b981' : '#ef4444', marginBottom: '4px', textAlign: 'center' }}>{inviteMsg}</div>
            )}

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '20px 0 16px' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>or share a link</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '6px', fontWeight: '600' }}>Role for link joiners</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {Object.entries(ROLE_LABELS).map(([key, info]) => (
                  <button
                    key={key}
                    onClick={() => setLinkRole(key)}
                    style={{
                      padding: '5px 10px', borderRadius: '8px', border: '1px solid',
                      borderColor: linkRole === key ? info.color : 'var(--border)',
                      background: linkRole === key ? `${info.color}18` : 'transparent',
                      color: linkRole === key ? info.color : 'var(--muted)',
                      fontSize: '12px', fontWeight: '700', cursor: 'pointer',
                    }}
                  >{info.icon} {info.label}</button>
                ))}
              </div>
            </div>

            {inviteLink ? (
              <>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    readOnly
                    value={inviteLink}
                    style={{ flex: 1, fontSize: '11px', padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--muted)', cursor: 'text' }}
                    onClick={e => e.target.select()}
                  />
                  <button
                    onClick={copyLink}
                    style={{ padding: '8px 14px', borderRadius: '8px', background: linkCopied ? '#10b981' : 'var(--accent)', color: '#000', border: 'none', fontSize: '12px', fontWeight: '800', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {linkCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <button
                  onClick={generateLink}
                  disabled={linkLoading}
                  style={{ marginTop: '8px', background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '12px', fontWeight: '700', cursor: linkLoading ? 'default' : 'pointer', padding: 0 }}
                >
                  {linkLoading ? '…' : '↻ Regenerate link'}
                </button>
              </>
            ) : (
              <button
                onClick={generateLink}
                disabled={linkLoading}
                className="btn-save"
                style={{ width: '100%' }}
              >
                {linkLoading ? 'Generating…' : 'Generate Invite Link'}
              </button>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
