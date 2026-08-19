// ── Guided app tours ──────────────────────────────────────────────
// Step definitions for the first-run walkthrough plus the tiny bit of
// localStorage bookkeeping that decides who has already seen it.
//
// A step is:
//   id        stable key (also the analytics label)
//   target    CSS selector for the element to spotlight; omit for a
//             centered card with no highlight (welcome / sign-off)
//   before    optional selector to click before resolving the target, for
//             things that live behind a disclosure (an expanded task panel).
//             Only fires when the target isn't already showing.
//   title     short headline: WHAT the thing is
//   body      one or two sentences: WHAT it does / WHERE it lives
//   points    optional bullet list for steps that cover a cluster of controls
//   hint      optional keyboard-shortcut chip
//   placement preferred side for the card; it flips automatically when
//             there isn't room (default 'auto': bottom, top, right, left)
//   sidebar   true when the target lives in the sidebar, so the host can
//             un-collapse it (desktop) or slide it open (mobile) first
//   padding   extra px of breathing room around the spotlight (default 8)
//   radius    spotlight corner radius (default 14)
//
// Steps whose target isn't on screen are dropped when the tour starts, so
// an empty account never sees a card pointing at nothing.
//
// House style for the copy: no em dashes. Use a comma, a colon or a full
// stop instead. Keep sentences short enough to read at a glance.

// Bump when the steps change enough that returning users should see the
// guide again. The version is part of the storage key.
export const TOUR_VERSION = 2;

export const MAIN_TOUR = [
  {
    id: 'welcome',
    title: 'Welcome to BrainJot 👋',
    body: "Quick tour of what everything does and where it lives. It takes about a minute, and you can leave any time.",
  },
  {
    id: 'structure',
    title: 'Three levels, that is it',
    body: 'Everything in BrainJot nests the same way, so once you get this the whole app makes sense:',
    points: [
      { icon: '🗂', text: 'Spaces are the big buckets: Work, Studies, Side hustle' },
      { icon: '📁', text: 'Projects live inside a space: one piece of work each' },
      { icon: '✓', text: 'Tasks live inside a project: the actual things to do' },
    ],
  },
  {
    id: 'brainview',
    target: '[data-tour="nav-brainview"]',
    placement: 'right',
    sidebar: true,
    title: 'Brainview is home',
    body: "Your dashboard. Today's priorities, every space you own, and your overall progress in one screen. Click here whenever you want to get back.",
  },
  {
    id: 'spaces',
    target: '[data-tour="nav-spaces"]',
    placement: 'right',
    sidebar: true,
    title: 'Your spaces and projects',
    body: 'Every space you own is listed here. Click a space to fold it open and see the projects inside it, then click a project to work on it.',
    points: [
      { icon: '＋', text: 'New space: the + next to "Spaces"' },
      { icon: '▸', text: 'Click a space name to show its projects' },
      { icon: '⠿', text: 'Drag the handle to reorder' },
      { icon: '⋯', text: 'Right-click a space or project to edit, share, archive or delete it' },
    ],
  },
  {
    id: 'shared',
    target: '[data-tour="nav-shared"]',
    placement: 'right',
    sidebar: true,
    title: 'Shared with me',
    body: 'Spaces and projects other people invited you to land here. Right-click one to open it or leave it.',
  },
  {
    id: 'stats',
    target: '[data-tour="dash-stats"]',
    placement: 'bottom',
    title: 'Your numbers, live',
    body: 'Spaces, tasks done, tasks total and overall completion. These recalculate as you tick things off.',
  },
  {
    id: 'focus',
    target: '[data-tour="dash-focus"]',
    placement: 'bottom',
    title: "Today's Focus",
    body: 'The handful of tasks that actually need you today, ranked by deadline and priority. Tick one off right from the card, or click it to jump into its project.',
  },
  {
    id: 'space-cards',
    target: '[data-tour="dash-spaces"]',
    placement: 'top',
    title: 'Your spaces at a glance',
    body: 'Each card fills up like a glass as its tasks get completed. Click one to open the space and see the projects inside it.',
  },
  {
    id: 'topbar',
    target: '[data-tour="top-actions"]',
    placement: 'bottom',
    padding: 10,
    title: 'The toolbar, top right',
    body: 'Four controls that follow you into every screen:',
    points: [
      { icon: '🔍', text: 'Search: find any project or task by name' },
      { icon: '🔔', text: 'Notifications: invites, mentions and assignments' },
      { icon: '💬', text: 'Feedback: tell us what is broken or missing' },
      { icon: '◐', text: 'Theme: switch between dark and light' },
    ],
    hint: 'Search is ⌘F / Ctrl+F from anywhere',
  },
  {
    id: 'community',
    target: '[data-tour="nav-community"]',
    placement: 'right',
    sidebar: true,
    title: 'BJ Community',
    body: 'The social side of BrainJot: posts, collab requests and DMs with other builders. Same login, opens in the same tab.',
  },
  {
    id: 'profile',
    target: '[data-tour="nav-profile"]',
    placement: 'right',
    sidebar: true,
    title: 'Your profile and settings',
    body: 'Name, avatar, username, password, storage usage and a full export of your data. This guide can be replayed from here too.',
  },
  {
    id: 'done',
    title: 'That is the map 🎉',
    body: 'Now open any project. A second short guide will point out the task tools in there: deadlines, priorities, assignees, files and more.',
  },
];

export const PROJECT_TOUR = [
  {
    id: 'header',
    target: '[data-tour="proj-header"]',
    placement: 'bottom',
    padding: 6,
    radius: 32,
    title: 'Inside a project',
    body: 'A project is one piece of work, and it holds your tasks, notes and files. The banner shows its colour and completion, and the wave behind it rises as tasks get done.',
  },
  {
    id: 'tasks',
    target: '[data-tour="proj-tasks"]',
    placement: 'right',
    title: 'Your tasks',
    body: 'The heart of a project. Every task sits in this list:',
    points: [
      { icon: '○', text: 'Tick the circle to mark it done' },
      { icon: '✎', text: 'Double-click the text to rename it' },
      { icon: '▾', text: 'Click anywhere else on a task to open it up' },
      { icon: '🏷', text: 'The "+ label" button tags it, so you can filter by label later' },
    ],
  },
  {
    id: 'task-detail',
    target: '[data-tour="proj-tasks"] .task-panel.open',
    before: '[data-tour="proj-tasks"] .task-row',
    placement: 'right',
    title: 'Everything a task can hold',
    body: 'This is what opens up inside a task. All of it is optional, so use only what you need:',
    points: [
      { icon: '🔥', text: "Priority: Urgent, Important or Later. Drives Today's Focus" },
      { icon: '📅', text: 'Deadline: shows up as Due soon or Overdue, and can send you a reminder' },
      { icon: '👤', text: 'Assignees: hand the task to a collaborator' },
      { icon: '📝', text: 'Notes: the detail, links and context behind the task' },
      { icon: '📎', text: 'Files: attachments for this one task, separate from project files' },
      { icon: '💬', text: 'Task Discussion: comment back and forth, and @mention people' },
    ],
  },
  {
    id: 'add-task',
    target: '[data-tour="proj-add-task"]',
    placement: 'top',
    title: 'Add a task',
    body: 'Type and hit Enter. Open the task afterwards to give it a deadline, priority, assignee and the rest.',
    hint: "Press N anywhere in a project to jump to this box",
  },
  {
    id: 'views',
    target: '[data-tour="proj-views"]',
    placement: 'bottom',
    title: 'Three ways to see tasks',
    body: 'Same tasks, different angles. Your choice is remembered per project.',
    points: [
      { icon: '☰', text: 'List: fast top-to-bottom checklist' },
      { icon: '▤', text: 'Board: drag tasks between To do, Doing and Done' },
      { icon: '▦', text: 'Calendar: everything laid out by deadline' },
    ],
  },
  {
    id: 'filters',
    target: '[data-tour="proj-filters"]',
    placement: 'bottom',
    title: 'Filter and sort',
    body: 'Narrow the list down by assignee or label, sort by priority or deadline, and hide what is already finished.',
  },
  {
    id: 'collab',
    target: '[data-tour="proj-collab"]',
    placement: 'bottom',
    radius: 24,
    title: 'Invite collaborators',
    body: 'Add people by email or username, as an editor who can change things or a viewer who can only read. Once they are in, you can assign them tasks and @mention them.',
  },
  {
    id: 'call',
    target: '[data-tour="proj-call"]',
    placement: 'bottom',
    title: 'Jump on a call',
    body: 'Start an audio or video huddle with the people on this project. Everyone else gets a banner they can join from.',
  },
  {
    id: 'notes',
    target: '[data-tour="proj-notes"]',
    placement: 'top',
    title: 'Project notes',
    body: 'A scratchpad for the whole project that saves as you type: strategy, links, references. The ⤢ button opens it in the full rich editor.',
  },
  {
    id: 'files',
    target: '[data-tour="proj-files"]',
    placement: 'left',
    title: 'Project files',
    body: 'Drag files in or click to browse. Images, PDFs, docs and video, up to 50 MB each. Images get a preview grid.',
  },
  {
    id: 'activity',
    target: '[data-tour="proj-activity"]',
    placement: 'left',
    title: 'Activity',
    body: 'Who changed what, newest first. Handy on shared projects. Click the header to collapse it.',
  },
  {
    id: 'settings',
    target: '[data-tour="proj-settings"]',
    placement: 'left',
    radius: 40,
    title: 'Project settings',
    body: 'Rename the project, change its colour, manage labels, or archive and delete it.',
  },
  {
    id: 'done',
    title: 'You know your way around 🎉',
    body: 'Replay either guide any time from Profile, then Preferences, then App guide.',
  },
];

export const TOURS = { main: MAIN_TOUR, project: PROJECT_TOUR };

const key = (tourId, userId) => `bj_tour_${tourId}_v${TOUR_VERSION}_${userId || 'anon'}`;

// Defaults to "seen" when storage is unavailable, because replaying the tour
// on every single load would be worse than skipping it.
export function hasSeenTour(tourId, userId) {
  try { return localStorage.getItem(key(tourId, userId)) === '1'; }
  catch { return true; }
}

export function markTourSeen(tourId, userId) {
  try { localStorage.setItem(key(tourId, userId), '1'); } catch { /* storage unavailable */ }
}

// Used by the "Replay app guide" button in Preferences.
export function resetTours(userId) {
  try {
    Object.keys(TOURS).forEach(id => localStorage.removeItem(key(id, userId)));
  } catch { /* storage unavailable */ }
}
