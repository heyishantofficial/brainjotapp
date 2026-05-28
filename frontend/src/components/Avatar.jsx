import React, { useState } from 'react';

function hashColor(str) {
  const c = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return c[Math.abs(h) % c.length];
}

export default function Avatar({ name = '', src = '', size = 36, style = {} }) {
  const [err, setErr] = useState(false);
  const showImg = src && !err;
  const initials = (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2);

  if (showImg) return (
    <img
      src={src}
      alt={name}
      onError={() => setErr(true)}
      style={{
        width: size, height: size, borderRadius: '50%',
        objectFit: 'cover', flexShrink: 0, display: 'block', ...style,
      }}
    />
  );
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: hashColor(name), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.36) + 'px', fontWeight: '800',
      flexShrink: 0, userSelect: 'none', ...style,
    }}>
      {initials}
    </div>
  );
}
