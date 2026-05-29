import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { getContrastColor } from '../utils/colors';

export function CountUp({ value }) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValueRef = useRef(0);

  useEffect(() => {
    let raf;
    const start = prevValueRef.current;
    const end = value;
    const duration = 1200;
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayValue(Math.floor(start + (end - start) * easeProgress));
      if (progress < 1) { raf = requestAnimationFrame(animate); }
      else { prevValueRef.current = end; }
    };

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{displayValue}</>;
}

export default function ProjectCard({ p, onOpenProject, onReorder, projectProgress }) {
  const [quickTaskText, setQuickTaskText] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const pct  = projectProgress(p);
  const done  = (p.tasks || []).filter(t => t.done).length;
  const total = (p.tasks || []).length;

  const handleQuickAdd = async (e) => {
    if (e) e.stopPropagation();
    if (!quickTaskText.trim()) return;
    setIsAdding(true);
    try {
      if (p.sharedBy) { setQuickTaskText(''); onReorder(); return; }
      await api('add_task', { projectId: p.id, text: quickTaskText });
      setQuickTaskText('');
      onReorder();
    } catch (err) {
      console.error('Failed to quick add task:', err);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDragStart = (e) => {
    e.stopPropagation();
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.setData('projectId', p.id);
  };

  const handleDragEnd = (e) => {
    e.currentTarget.classList.remove('dragging');
  };

  return (
    <div
      className="proj-card"
      onClick={() => onOpenProject(p.id)}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{
        background: p.color,
        color: getContrastColor(p.color),
        border: 'none',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: '100%',
      }}
    >
      <div className="liquid-wave-container">
        <div className="liquid-wave" style={{ height: `${pct}%` }}></div>
      </div>

      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div className="proj-card-top" style={{ padding: '24px 24px 16px' }}>
          <div className="proj-info">
            <div className="proj-name" style={{ fontSize: 'max(24px, min(2.5vw, 32px))', fontWeight: '800', lineHeight: '1.1', letterSpacing: '-1px' }}>{p.title}</div>
            <div className="proj-sub" style={{ color: `${getContrastColor(p.color)}a6`, marginTop: '6px', fontSize: '14px', fontWeight: '600' }}>{p.subtitle}</div>
            <div className="proj-tag" style={{ borderColor: `${getContrastColor(p.color)}26`, color: `${getContrastColor(p.color)}cc`, backgroundColor: `${getContrastColor(p.color)}26`, fontSize: '11px', padding: '3px 8px', marginTop: '10px', fontWeight: '600', display: 'inline-block' }}>{p.tag}</div>
          </div>
        </div>

        <div className="quick-add-section" onClick={e => e.stopPropagation()} style={{ padding: '0 24px', position: 'relative', zIndex: 10 }}>
          <div className="quick-add-box" style={{ display: 'flex', alignItems: 'center', background: `${getContrastColor(p.color)}1a`, padding: '8px 12px', borderRadius: '14px', backdropFilter: 'blur(10px)', border: `1px solid ${getContrastColor(p.color)}33`, transition: 'all 0.3s ease', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <input
              type="text"
              className="quick-task-input"
              placeholder="+ Quick Task..."
              value={quickTaskText}
              onChange={e => setQuickTaskText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleQuickAdd(e)}
              disabled={isAdding}
              style={{ '--placeholder-color': getContrastColor(p.color), background: 'transparent', border: 'none', width: '100%', fontSize: '13px', fontWeight: '700', color: getContrastColor(p.color), outline: 'none', padding: 0 }}
            />
            {quickTaskText.trim() && (
              <button onClick={handleQuickAdd} style={{ background: getContrastColor(p.color), color: p.color, border: 'none', borderRadius: '8px', padding: '4px 10px', fontSize: '10px', fontWeight: '900', cursor: 'pointer', letterSpacing: '1px' }}>ADD</button>
            )}
          </div>
        </div>

        <div className="proj-card-foot" style={{ padding: '16px 24px 24px', borderTopColor: `${getContrastColor(p.color)}14` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span className="proj-counts" style={{ color: `${getContrastColor(p.color)}99`, fontWeight: '700', fontSize: '12px' }}>{done}/{total} tasks</span>
            <span className="bar-pct" style={{ color: getContrastColor(p.color), fontWeight: '900', fontSize: '12px' }}><CountUp value={pct} />%</span>
          </div>
          <div className="bar-bg" style={{ background: `${getContrastColor(p.color)}26`, height: '5px', borderRadius: '8px', overflow: 'hidden' }}>
            <div className="bar-fill" style={{ background: getContrastColor(p.color), width: `${pct}%`, height: '100%', borderRadius: '8px', transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}></div>
          </div>
        </div>
      </div>

    </div>
  );
}
