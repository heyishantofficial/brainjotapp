import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { api } from '../api';

const TYPE_CONFIG = {
  bug:     { icon: '🐛', label: 'Bug',     color: '#ef4444' },
  idea:    { icon: '💡', label: 'Idea',    color: '#f59e0b' },
  general: { icon: '💬', label: 'General', color: '#6366f1' },
};

const BTN = { background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' };

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

export default function FeedbackPanel({ isOpen, onClose }) {
  const [items, setItems]       = useState([]);
  const [filter, setFilter]     = useState('all');
  const [message, setMessage]   = useState('');
  const [type, setType]         = useState('general');
  const [loading, setLoading]   = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    api('get_feedback', null, 'GET').then(r => {
      if (r?.items) setItems(r.items);
      setLoading(false);
    });
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    const r = await api('post_feedback', { message: message.trim(), type });
    if (r?.ok) {
      setItems(prev => [r.item, ...prev]);
      setMessage('');
    }
    setSubmitting(false);
  };

  const handleUpvote = async (id) => {
    const r = await api('upvote_feedback', { feedbackId: id });
    if (r?.ok) {
      setItems(prev => prev.map(it =>
        it.id !== id ? it : { ...it, hasUpvoted: r.hasUpvoted, upvoteCount: r.upvoteCount }
      ));
    }
  };

  const handleToggleStatus = async (id) => {
    const r = await api('toggle_feedback_status', { feedbackId: id });
    if (r?.ok) {
      setItems(prev => prev.map(it => it.id !== id ? it : { ...it, status: r.status }));
    }
  };

  const filters = [
    { key: 'all',     label: 'All' },
    { key: 'bug',     label: '🐛 Bugs' },
    { key: 'idea',    label: '💡 Ideas' },
    { key: 'general', label: '💬 General' },
    { key: 'open',    label: '🔴 Open' },
    { key: 'fixed',   label: '✅ Fixed' },
  ];

  const filtered = items.filter(it => {
    if (filter === 'all')   return true;
    if (filter === 'open')  return it.status === 'open';
    if (filter === 'fixed') return it.status === 'fixed';
    return it.type === filter;
  });

  const openCount = items.filter(i => i.status === 'open').length;

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'transparent' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: '70px', right: '20px',
              width: '420px', maxWidth: '92vw',
              maxHeight: '82vh', display: 'flex', flexDirection: 'column',
              borderRadius: '24px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
              overflow: 'hidden',
            }}
          >
            {/* ── Header ── */}
            <div style={{ padding: '20px 22px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>🧪 Beta Feedback</h2>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '3px' }}>
                    {openCount} open · {items.length} total — share bugs, ideas or issues
                  </div>
                </div>
                <button onClick={onClose} style={{ ...BTN, color: 'var(--muted)', fontSize: '20px', lineHeight: 1, padding: '2px 6px' }}>×</button>
              </div>

              {/* Filter tabs */}
              <div style={{ display: 'flex', gap: '5px', marginTop: '12px', flexWrap: 'wrap' }}>
                {filters.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    style={{
                      ...BTN,
                      padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700',
                      border: filter === f.key ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: filter === f.key ? 'var(--accent)' : 'transparent',
                      color: filter === f.key ? '#000' : 'var(--muted)',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── List ── */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>Loading…</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <div style={{ fontSize: '36px', marginBottom: '8px' }}>📭</div>
                  <div style={{ color: 'var(--muted)', fontSize: '13px' }}>Nothing here yet.</div>
                </div>
              ) : filtered.map((item, idx) => {
                const tc = TYPE_CONFIG[item.type] || TYPE_CONFIG.general;
                return (
                  <div
                    key={item.id}
                    style={{
                      padding: '14px 20px',
                      borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                      opacity: item.status === 'fixed' ? 0.6 : 1,
                      transition: 'opacity 0.2s',
                    }}
                  >
                    {/* Row 1: avatar + name + badges */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
                      <div style={{
                        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                        background: hashColor(item.userName), color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '10px', fontWeight: '800',
                      }}>
                        {initials(item.userName)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '13px', fontWeight: '700' }}>{item.userName}</span>
                        <span style={{ fontSize: '11px', color: 'var(--faint)', marginLeft: '6px' }}>{timeAgo(item.createdAt)}</span>
                      </div>
                      <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: `${tc.color}22`, color: tc.color, flexShrink: 0 }}>
                        {tc.icon} {tc.label}
                      </span>
                      <span style={{
                        fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', flexShrink: 0,
                        background: item.status === 'fixed' ? '#10b98122' : '#ef444422',
                        color:      item.status === 'fixed' ? '#10b981'   : '#ef4444',
                      }}>
                        {item.status === 'fixed' ? '✅ Fixed' : '🔴 Open'}
                      </span>
                    </div>

                    {/* Message */}
                    <p style={{ margin: '0 0 10px 36px', fontSize: '13px', lineHeight: '1.55', color: 'var(--text)', wordBreak: 'break-word' }}>
                      {item.message}
                    </p>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '6px', marginLeft: '36px' }}>
                      <button
                        onClick={() => handleUpvote(item.id)}
                        style={{
                          ...BTN,
                          display: 'flex', alignItems: 'center', gap: '4px',
                          padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700',
                          border: item.hasUpvoted ? '1px solid var(--accent)' : '1px solid var(--border)',
                          background: item.hasUpvoted ? 'var(--accent)' : 'transparent',
                          color: item.hasUpvoted ? '#000' : 'var(--muted)',
                          transition: 'all 0.15s',
                        }}
                      >
                        👍 {item.upvoteCount}
                      </button>
                      <button
                        onClick={() => handleToggleStatus(item.id)}
                        style={{
                          ...BTN,
                          padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700',
                          border: '1px solid var(--border)', color: 'var(--muted)',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                      >
                        {item.status === 'fixed' ? '↩ Reopen' : '✓ Mark Fixed'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Post form ── */}
            <div style={{ padding: '14px 18px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
              {/* Type selector */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => setType(key)}
                    style={{
                      ...BTN,
                      flex: 1, padding: '6px 4px', borderRadius: '10px', fontSize: '12px', fontWeight: '700',
                      border: type === key ? `1px solid ${cfg.color}` : '1px solid var(--border)',
                      background: type === key ? `${cfg.color}22` : 'transparent',
                      color: type === key ? cfg.color : 'var(--muted)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {cfg.icon} {cfg.label}
                  </button>
                ))}
              </div>

              {/* Textarea + send */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Describe your feedback or issue…"
                  maxLength={500}
                  rows={2}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: '12px',
                    border: '1px solid var(--border)', background: 'var(--surface2)',
                    color: 'var(--text)', fontSize: '13px', resize: 'none',
                    fontFamily: 'inherit', outline: 'none', lineHeight: '1.5',
                  }}
                />
                <button
                  onClick={handleSubmit}
                  disabled={!message.trim() || submitting}
                  style={{
                    ...BTN,
                    padding: '10px 16px', borderRadius: '12px', fontWeight: '800', fontSize: '13px',
                    background: message.trim() ? 'var(--accent)' : 'var(--surface3)',
                    color:      message.trim() ? '#000'         : 'var(--muted)',
                    cursor:     message.trim() ? 'pointer'      : 'default',
                    flexShrink: 0, transition: 'all 0.15s',
                  }}
                >
                  {submitting ? '…' : 'Send →'}
                </button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--faint)', marginTop: '5px' }}>⌘+Enter to send</div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
