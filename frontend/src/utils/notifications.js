/**
 * BrainJot — Deadline Reminder Notifications
 * Requests browser notification permission and schedules reminders
 * for tasks due today or tomorrow.
 *
 * TODO: Also call POST /api/send-reminder to trigger email notifications
 *       when real backend + email service (Resend/Nodemailer) is connected.
 */

const REMINDER_INTERVAL_MS = 60 * 60 * 1000; // Check every 60 minutes
let reminderTimer = null;

/**
 * Request browser notification permission from the user.
 * Should be called once after login.
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('[BrainJot] This browser does not support notifications.');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

/**
 * Fire a single browser notification.
 */
function fireNotification(title, body, icon = '/icons/icon-192.png') {
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon, badge: icon });
    // Auto-close after 8 seconds
    setTimeout(() => n.close(), 8000);
  } catch (e) {
    console.warn('[BrainJot] Notification failed:', e);
  }
}

/**
 * Check all tasks across all projects for upcoming deadlines.
 * Fires a notification for tasks due today or tomorrow.
 *
 * @param {Array} projects — array of project objects from appData
 */
export function checkDeadlines(projects) {
  if (!projects || projects.length === 0) return;

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const overdue = [];
  const dueToday = [];
  const dueTomorrow = [];

  projects.forEach(project => {
    (project.tasks || []).forEach(task => {
      if (task.done || !task.deadline) return;
      const dl = task.deadline; // format: YYYY-MM-DD
      if (dl < todayStr) overdue.push({ task, project });
      else if (dl === todayStr) dueToday.push({ task, project });
      else if (dl === tomorrowStr) dueTomorrow.push({ task, project });
    });
  });

  if (overdue.length > 0) {
    fireNotification(
      `⚠️ ${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`,
      overdue.slice(0, 3).map(({ task, project }) => `"${task.text}" in ${project.title}`).join('\n')
    );
  }

  if (dueToday.length > 0) {
    fireNotification(
      `⏰ ${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today`,
      dueToday.slice(0, 3).map(({ task, project }) => `"${task.text}" in ${project.title}`).join('\n')
    );
  }

  if (dueTomorrow.length > 0) {
    fireNotification(
      `📅 ${dueTomorrow.length} task${dueTomorrow.length > 1 ? 's' : ''} due tomorrow`,
      dueTomorrow.slice(0, 3).map(({ task, project }) => `"${task.text}" in ${project.title}`).join('\n')
    );
  }

  // TODO: POST /api/send-reminder with { overdue, dueToday, dueTomorrow }
  // to send email notifications via Nodemailer/Resend
}

/**
 * Start the recurring deadline reminder scheduler.
 * Runs immediately, then every REMINDER_INTERVAL_MS.
 *
 * @param {Function} getProjects — function that returns the current projects array
 */
export function scheduleDeadlineReminders(getProjects) {
  // Clear any existing timer
  if (reminderTimer) clearInterval(reminderTimer);

  // Run immediately on call
  checkDeadlines(getProjects());

  // Then run on interval
  reminderTimer = setInterval(() => {
    checkDeadlines(getProjects());
  }, REMINDER_INTERVAL_MS);
}

/**
 * Stop the reminder scheduler (call on logout).
 */
export function stopDeadlineReminders() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}
