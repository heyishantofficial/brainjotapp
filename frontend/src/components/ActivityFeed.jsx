import React, { useState } from 'react';
import { Plus, Check, RotateCcw, Pencil, Trash2, CalendarClock, CalendarX, Flag, FlagOff, UserPlus, Eraser } from 'lucide-react';
import Avatar from './Avatar';

const INITIAL_SHOWN = 8;

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDeadline(d) {
  if (!d) return '';
  const parsed = new Date(d.includes('T') ? d : d + 'T00:00');
  if (isNaN(parsed)) return d;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const EVENT_STYLES = {
  task_added:            { Icon: Plus,          color: 'var(--accent)' },
  task_completed:        { Icon: Check,         color: '#10b981' },
  task_reopened:         { Icon: RotateCcw,     color: '#f59e0b' },
  task_renamed:          { Icon: Pencil,        color: 'var(--muted)' },
  task_deleted:          { Icon: Trash2,        color: '#ef4444' },
  task_restored:         { Icon: RotateCcw,     color: '#10b981' },
  task_deadline:         { Icon: CalendarClock, color: '#3b82f6' },
  task_deadline_removed: { Icon: CalendarX,     color: 'var(--muted)' },
  task_priority:         { Icon: Flag,          color: '#f59e0b' },
  task_priority_removed: { Icon: FlagOff,       color: 'var(--muted)' },
  task_assignees:        { Icon: UserPlus,      color: '#8b5cf6' },
  tasks_cleared:         { Icon: Eraser,        color: '#ef4444' },
};

function Task({ text }) {
  return <span style={{ fontWeight: '700', color: 'var(--text)' }}>{text || 'a task'}</span>;
}

function entryBody(entry) {
  const meta = entry.meta || {};
  switch (entry.type) {
    case 'task_added':            return <>added <Task text={entry.taskText} /></>;
    case 'task_completed':        return <>completed <Task text={entry.taskText} /></>;
    case 'task_reopened':         return <>reopened <Task text={entry.taskText} /></>;
    case 'task_renamed':          return <>renamed {meta.from ? <Task text={meta.from} /> : 'a task'} to <Task text={entry.taskText} /></>;
    case 'task_deleted':          return <>deleted <Task text={entry.taskText} /></>;
    case 'task_restored':         return <>restored <Task text={entry.taskText} /></>;
    case 'task_deadline':         return <>set the deadline of <Task text={entry.taskText} /> to <span style={{ fontWeight: '700' }}>{formatDeadline(meta.deadline)}</span></>;
    case 'task_deadline_removed': return <>removed the deadline from <Task text={entry.taskText} /></>;
    case 'task_priority':         return <>marked <Task text={entry.taskText} /> as <span style={{ fontWeight: '700', textTransform: 'capitalize' }}>{meta.priority}</span></>;
    case 'task_priority_removed': return <>cleared the priority on <Task text={entry.taskText} /></>;
    case 'task_assignees':
      return meta.assignedNames?.length
        ? <>assigned <span style={{ fontWeight: '700' }}>{meta.assignedNames.join(', ')}</span> to <Task text={entry.taskText} /></>
        : <>updated assignees on <Task text={entry.taskText} /></>;
    case 'tasks_cleared':         return <>cleared all tasks{meta.count ? ` (${meta.count})` : ''}</>;
    default:                      return <>updated <Task text={entry.taskText} /></>;
  }
}

function ActivityRow({ entry, isYou }) {
  const { Icon, color } = EVENT_STYLES[entry.type] || { Icon: Pencil, color: 'var(--muted)' };
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar name={entry.userName} src={entry.userAvatarUrl} size={26} />
        <div style={{
          position: 'absolute', bottom: '-3px', right: '-3px', width: '15px', height: '15px',
          borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={9} color={color} strokeWidth={3} />
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.45', wordBreak: 'break-word' }}>
          <span style={{ fontWeight: '800', color: 'var(--text)' }}>{isYou ? 'You' : entry.userName}</span>{' '}
          {entryBody(entry)}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--faint)', marginTop: '2px', fontWeight: '600' }}>{timeAgo(entry.createdAt)}</div>
      </div>
    </div>
  );
}

export default function ActivityFeed({ project, currentUser }) {
  const [showAll, setShowAll] = useState(false);
  const entries = [...(project.activity || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (entries.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--faint)', fontSize: '13px' }}>
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
        No activity yet. Start adding tasks!
      </div>
    );
  }

  const visible = showAll ? entries : entries.slice(0, INITIAL_SHOWN);

  return (
    <div>
      {visible.map(entry => (
        <ActivityRow key={entry.id} entry={entry} isYou={entry.userId === currentUser?.id} />
      ))}
      {entries.length > INITIAL_SHOWN && (
        <button
          onClick={() => setShowAll(s => !s)}
          style={{
            display: 'block', width: '100%', padding: '10px 0 2px', background: 'none', border: 'none',
            color: 'var(--muted)', fontSize: '12px', fontWeight: '700', cursor: 'pointer', textAlign: 'center',
          }}
        >
          {showAll ? 'Show less' : `Show all (${entries.length})`}
        </button>
      )}
    </div>
  );
}
