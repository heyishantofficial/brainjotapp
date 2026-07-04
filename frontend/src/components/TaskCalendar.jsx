import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { localDateKey } from '../utils/deadlines';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_CHIPS = 3;

const PRIORITY_ICONS = { urgent: '🔥', important: '⚡', later: '💤' };

export default function TaskCalendar({ tasks, onUpdateMeta, onTaskClick, readOnly = false }) {
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selectedDay, setSelectedDay] = useState(null);
  const [dragOverDay, setDragOverDay] = useState(null);

  const todayKey = localDateKey();

  // Bucket tasks by their 'YYYY-MM-DD' deadline string; incoming order already
  // reflects the active sort, so within a day only push done tasks to the end.
  const buckets = new Map();
  let unscheduled = 0;
  tasks.forEach(t => {
    if (!t.deadline) { unscheduled++; return; }
    if (!buckets.has(t.deadline)) buckets.set(t.deadline, []);
    buckets.get(t.deadline).push(t);
  });
  buckets.forEach(list => list.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1)));

  // ISO date keys compare correctly as strings
  const chipClass = (t, key) => {
    if (t.done) return 'done';
    if (key < todayKey) return 'overdue';
    if (key === todayKey) return 'due-today';
    return '';
  };

  const { y, m } = view;
  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first week
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = startOffset; i > 0; i--) cells.push({ d: new Date(y, m, 1 - i), outside: true });
  for (let day = 1; day <= daysInMonth; day++) cells.push({ d: new Date(y, m, day), outside: false });
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].d;
    cells.push({ d: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), outside: true });
  }

  const monthLabel = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const shiftMonth = (delta) => {
    setSelectedDay(null);
    setView(v => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const goToday = () => {
    setView({ y: now.getFullYear(), m: now.getMonth() });
    setSelectedDay(todayKey);
  };

  const handleDrop = async (e, key) => {
    e.preventDefault();
    setDragOverDay(null);
    if (readOnly) return;
    const taskId = e.dataTransfer.getData('taskId');
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.deadline === key) return;
    await onUpdateMeta(taskId, 'deadline', key);
  };

  const selectedTasks = selectedDay ? (buckets.get(selectedDay) || []) : [];
  const selectedLabel = selectedDay
    ? new Date(selectedDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    : '';

  return (
    <div className="cal-wrap">
      <div className="cal-head">
        <button className="cal-nav-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft size={14} /></button>
        <span className="cal-title">{monthLabel}</span>
        <button className="cal-nav-btn" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight size={14} /></button>
        <button className="cal-today-btn" onClick={goToday}>Today</button>
      </div>

      <div className="cal-weekdays">
        {WEEKDAYS.map(w => <div key={w} className="cal-weekday">{w}</div>)}
      </div>

      <div className="cal-grid">
        {cells.map(({ d, outside }) => {
          const key = localDateKey(d);
          const dayTasks = buckets.get(key) || [];
          return (
            <div
              key={key}
              className={`cal-cell ${outside ? 'outside' : ''} ${key === todayKey ? 'today' : ''} ${selectedDay === key ? 'selected' : ''} ${dragOverDay === key ? 'drag-over' : ''}`}
              onClick={() => setSelectedDay(cur => (cur === key ? null : key))}
              onDragOver={e => { e.preventDefault(); setDragOverDay(key); }}
              onDragLeave={() => setDragOverDay(cur => (cur === key ? null : cur))}
              onDrop={e => handleDrop(e, key)}
            >
              <div className="cal-day-num">{d.getDate()}</div>
              <div className="cal-chips">
                {dayTasks.slice(0, MAX_CHIPS).map(t => (
                  <div
                    key={t.id}
                    className={`cal-chip ${chipClass(t, key)}`}
                    title={t.text}
                    draggable={!readOnly}
                    onDragStart={e => { e.dataTransfer.setData('taskId', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onClick={e => { e.stopPropagation(); onTaskClick(t.id); }}
                  >
                    {t.text}
                  </div>
                ))}
                {dayTasks.length > MAX_CHIPS && (
                  <button className="cal-more" onClick={e => { e.stopPropagation(); setSelectedDay(key); }}>
                    +{dayTasks.length - MAX_CHIPS} more
                  </button>
                )}
              </div>
              <div className="cal-dots">
                {dayTasks.slice(0, 4).map(t => <span key={t.id} className={`cal-dot ${chipClass(t, key)}`} />)}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDay && (
        <div className="cal-day-panel">
          <div className="cal-day-panel-title">{selectedLabel} · {selectedTasks.length} task{selectedTasks.length === 1 ? '' : 's'}</div>
          {selectedTasks.length === 0 && (
            <div style={{ fontSize: '13px', color: 'var(--faint)' }}>
              Nothing due this day{readOnly ? '' : ' — drag a task onto it to schedule'}.
            </div>
          )}
          {selectedTasks.map(t => (
            <div key={t.id} className={`cal-day-row ${t.done ? 'done' : ''}`} onClick={() => onTaskClick(t.id)}>
              <span>{t.done ? '✅' : PRIORITY_ICONS[t.priority] || '·'}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {unscheduled > 0 && (
        <div className="cal-hint">
          {unscheduled === 1 ? '1 task has' : `${unscheduled} tasks have`} no deadline and {unscheduled === 1 ? "isn't" : "aren't"} shown on the calendar.
        </div>
      )}
    </div>
  );
}
