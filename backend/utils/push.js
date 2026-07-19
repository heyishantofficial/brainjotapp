const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const logger = require('./logger');

// Web Push (VAPID). Disabled gracefully when keys are missing — get_push_key
// returns null and the frontend never subscribes.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:verify@brainjot.space';

const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  logger.warn('[push] VAPID keys not configured — web push disabled');
}

// Human-readable push text for each notification type. Mirrors what the
// in-app NotificationModal renders.
function pushPayloadFor(n) {
  const who = n.fromName || 'Someone';
  const task = n.meta?.taskTitle ? `"${n.meta.taskTitle}"` : '';
  const entity = n.meta?.entityTitle ? `"${n.meta.entityTitle}"` : 'a project';
  let title; let body;
  switch (n.type) {
    case 'collab_invite':
      title = `${who} invited you to collaborate`;
      body = `Join ${entity} as ${n.meta?.role || 'editor'}`;
      break;
    case 'invite_response':
      title = `${who} ${n.meta?.accepted ? 'accepted' : 'declined'} your invite`;
      body = entity;
      break;
    case 'mention':
      title = `${who} mentioned you`;
      body = n.meta?.commentText || task;
      break;
    case 'task_comment':
      title = `${who} commented on ${task || 'a task'}`;
      body = n.meta?.commentText || '';
      break;
    case 'task_assigned':
      title = `${who} assigned you a task`;
      body = task || entity;
      break;
    case 'collab_left':
      title = `${who} left ${entity}`;
      body = `They no longer have access to your ${n.meta?.entityType || 'project'}`;
      break;
    default:
      title = 'BrainJot';
      body = `${who} sent you a notification`;
  }
  return { title, body, url: '/', icon: '/icons/icon-192.png', tag: n.id };
}

// Send a payload to every subscription a user has. 404/410 from the push
// service means the subscription is dead (browser reset, permission revoked)
// — delete it so we stop paying for it. Never throws.
async function sendPushToUser(userId, payload) {
  if (!pushEnabled || !userId) return;
  try {
    const subs = await PushSubscription.find({ userId }).lean();
    if (!subs.length) return;
    const json = JSON.stringify(payload);
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, json, { TTL: 24 * 60 * 60 });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ endpoint: sub.endpoint });
        } else {
          logger.warn({ statusCode: err.statusCode, userId }, '[push] send failed (non-fatal)');
        }
      }
    }));
  } catch (err) {
    logger.warn({ err }, '[push] sendPushToUser failed (non-fatal)');
  }
}

module.exports = { pushEnabled, VAPID_PUBLIC_KEY, pushPayloadFor, sendPushToUser };
