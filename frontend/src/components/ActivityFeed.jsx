import React, { useState } from 'react';

/**
 * ActivityFeed — Project activity timeline
 *
 * Receives activity events (mock for now) and renders a beautiful feed.
 *
 * TODO: Replace mockEvents with real data from:
 *   GET /api/project/:id/activity
 *   Returns: Array<{ id, type, userId, userName, meta, createdAt }>
 *
 * Event types: task_added | task_completed | task_uncompleted |
 *              task_deleted | task_renamed | note_edited |
 *              collaborator_invited | collaborator_removed | file_uploaded
 */

const EVENT_CONFIG = {
  task_completed:       { icon: '✅', color: '#10b981', verb: (m) => `completed "${m.taskText}"` },
  task_uncompleted:     { icon: '↩️', color: '#f59e0b', verb: (m) => `unchecked "${m.taskText}"` },
  task_added:           { icon: '➕', color: '#6366f1', verb: (m) => `added "${m.taskText}"` },
  task_deleted:         { icon: '🗑',  color: '#ef4444', verb: (m) => `deleted "${m.taskText}"` },
  task_renamed:         { icon: '✎',  color: '#8b5cf6', verb: (m) => `renamed a task to "${m.taskText}"` },
  note_edited:          { icon: '📝', color: '#3b82f6', verb: ()  => `edited project notes` },
  collaborator_invited: { icon: '👤', color: '#ec4899', verb: (m) => `invited ${m.collaboratorName}` },
  collaborator_removed: { icon: '🚫', color: '#ef4444', verb: (m) => `removed ${m.collaboratorName}` },
  file_uploaded:        { icon: '📎', color: '#f59e0b', verb: (m) => `uploaded "${m.fileName}"` },
};

const PREVIEW_COUNT = 2;

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function hashColor(str) {
  const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export default function ActivityFeed() {
  return (
    <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--faint)', fontSize: '13px' }}>
      <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
      No activity yet. Start adding tasks!
    </div>
  );
}


/**
 * Generate realistic mock activity events from real project data.
 * This makes the feed feel populated even before the backend is connected.
 */
function generateMockEvents(project, collaborators) {
  const events = [];
  const now = Date.now();
  const tasks = project.tasks || [];
  const collabs = project.collaborators || collaborators;
  const owner = { id: 'owner', name: 'You' };

  const allActors = [owner, ...collabs.slice(0, 3).map(c => ({ id: c.id, name: c.name }))];

  tasks.forEach((task, i) => {
    const actor = allActors[i % allActors.length];
    const ageMs = (i + 1) * 3600000 + Math.random() * 1800000;

    if (task.done) {
      events.push({
        id: `ev-done-${task.id}`,
        type: 'task_completed',
        userId: actor.id,
        userName: actor.name,
        meta: { taskText: task.text },
        createdAt: new Date(now - ageMs).toISOString(),
      });
    }
    if (task.createdAt) {
      events.push({
        id: `ev-add-${task.id}`,
        type: 'task_added',
        userId: owner.id,
        userName: owner.name,
        meta: { taskText: task.text },
        createdAt: new Date(now - ageMs - 1800000).toISOString(),
      });
    }
  });

  // Collaborator invite events
  collabs.forEach((c, i) => {
    events.push({
      id: `ev-invite-${c.id}`,
      type: 'collaborator_invited',
      userId: owner.id,
      userName: owner.name,
      meta: { collaboratorName: c.name },
      createdAt: new Date(now - (tasks.length + i + 2) * 3600000).toISOString(),
    });
  });

  // If project has notes, add a note_edited event
  if (project.richNotes || project.notes) {
    events.push({
      id: 'ev-note',
      type: 'note_edited',
      userId: owner.id,
      userName: owner.name,
      meta: {},
      createdAt: new Date(now - 7200000).toISOString(),
    });
  }

  // Sort newest first
  events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return events.slice(0, 20);
}
