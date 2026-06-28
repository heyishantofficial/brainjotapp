const LIVEKIT_API_KEY    = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL        = process.env.LIVEKIT_URL;
const logger             = require('./logger');
const ActiveCall         = require('../models/ActiveCall');

const livekitEnabled = !!(LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_URL);

async function generateToken(userId, userName, roomName) {
  const { AccessToken } = require('livekit-server-sdk');
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: userId,
    name: userName,
    ttl: '2h',
  });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  return await at.toJwt();
}

// Forcibly evict a participant from a LiveKit room (e.g. on collaborator removal).
// Silently ignores "not found" — the participant may have already left.
async function removeParticipant(roomName, participantIdentity) {
  if (!livekitEnabled) return;
  try {
    const { RoomServiceClient } = require('livekit-server-sdk');
    const svc = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    await svc.removeParticipant(roomName, participantIdentity);
    logger.info({ roomName, participantIdentity }, '[livekit] participant evicted');
  } catch (err) {
    const code = err?.code ?? err?.status;
    if (code !== 404 && !err?.message?.toLowerCase().includes('not found')) {
      logger.error({ err, roomName, participantIdentity }, '[livekit] removeParticipant error');
    }
  }
}

module.exports = { livekitEnabled, ActiveCall, generateToken, removeParticipant, LIVEKIT_URL };
