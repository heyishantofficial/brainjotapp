// Task deadlines are date-only 'YYYY-MM-DD' strings. Always parse and format
// them in local time — round-tripping through UTC shifts the date for users
// west of Greenwich.

export const formatDeadline = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

// Returns { type: 'overdue', days } | { type: 'today' } | { type: 'tomorrow' } | null.
// Never flags completed tasks.
export const deadlineStatus = (task) => {
  if (!task.deadline || task.done) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(task.deadline + 'T00:00:00');
  const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { type: 'overdue', days: Math.abs(diffDays) };
  if (diffDays === 0) return { type: 'today' };
  if (diffDays === 1) return { type: 'tomorrow' };
  return null;
};

// 'YYYY-MM-DD' key for a Date, in local time.
export const localDateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
