require('dotenv').config();

// Sentry must be initialized before anything else so it can instrument all modules.
// Set SENTRY_DSN in the server environment to enable. Safe no-op when not set.
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const pinoHttp = require('pino-http');
const { randomUUID } = require('crypto');
const logger = require('./utils/logger');

const apiRouter = require('./routes/api');
const adminRouter = require('./routes/admin');

const PORT = process.env.PORT || 3001;
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('[startup] SESSION_SECRET is required in production — set the environment variable and restart.');
    process.exit(1);
  }
  SESSION_SECRET = require('crypto').randomBytes(32).toString('hex');
  logger.warn('[startup] SESSION_SECRET not set — generated a temporary secret. Sessions will invalidate on restart.');
}
// Support zero-downtime secret rotation: express-session signs new cookies with secrets[0]
// and validates against all entries. To rotate: set SESSION_SECRET_PREVIOUS = old value,
// SESSION_SECRET = new value. Old sessions stay valid for their remaining 7-day TTL.
const SESSION_SECRETS = [SESSION_SECRET, process.env.SESSION_SECRET_PREVIOUS].filter(Boolean);
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/brainjot';

function normalizeOrigin(origin) {
  return origin?.trim().replace(/\/+$/, '');
}

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',         // community frontend (dev)
  'http://127.0.0.1:5174',
  'https://brainjot.space',
  'https://www.brainjot.space',
  'https://app.brainjot.space',
  'https://community.brainjot.space', // community app calls /api/community/sso-token
];

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ? [...defaultAllowedOrigins, ...process.env.ALLOWED_ORIGINS.split(',').map(normalizeOrigin).filter(Boolean)]
  : [...defaultAllowedOrigins];

['APP_URL', 'FRONTEND_URL', 'CLIENT_URL', 'PUBLIC_APP_URL'].forEach((key) => {
  if (process.env[key]) configuredOrigins.push(normalizeOrigin(process.env[key]));
});

const ALLOWED_ORIGINS = [...new Set(configuredOrigins)];
const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL === 'true';
if (CORS_ALLOW_ALL && process.env.NODE_ENV === 'production') {
  logger.fatal('[startup] CORS_ALLOW_ALL=true is set in production — this disables all CORS protection. Unset it and restart.');
  process.exit(1);
}
const ALLOWED_ORIGIN_PATTERNS = (process.env.ALLOWED_ORIGIN_PATTERNS || '')
  .split(',')
  .map(pattern => pattern.trim())
  .filter(Boolean)
  .map(pattern => new RegExp(pattern));

function matchesAllowedPattern(origin) {
  return ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(origin));
}

function isOriginAllowed(origin, host) {
  const normalizedOrigin = normalizeOrigin(origin);
  const sameOrigin = normalizedOrigin && (
    normalizedOrigin === `https://${host}` ||
    normalizedOrigin === `http://${host}`
  );
  return !normalizedOrigin ||
    CORS_ALLOW_ALL ||
    ALLOWED_ORIGINS.includes(normalizedOrigin) ||
    sameOrigin ||
    matchesAllowedPattern(normalizedOrigin);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, isOriginAllowed(origin, null)),
    credentials: true,
  }
});
app.set('io', io);
app.set('trust proxy', 1); // behind Dokploy's reverse proxy (Traefik)

// ── Structured request logging ────────────────────────────────────
app.use(pinoHttp({
  logger,
  customLogLevel: (_req, res) => {
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.query?.action || req.path} ${res.statusCode}`,
  serializers: {
    req: (req) => ({ method: req.method, action: req.query?.action, path: req.path, userId: req.session?.userId }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  redact: ['req.headers.cookie', 'req.headers.authorization'],
}));

// ── Correlation IDs ───────────────────────────────────────────────
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  const host = req.headers.host;
  callback(null, {
    origin: isOriginAllowed(origin, host) ? true : false,
    credentials: true,
    exposedHeaders: ['X-Request-ID'],
  });
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers for all responses (covers requests that don't pass through nginx)
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  // F21: HSTS — 1-year max-age, include subdomains
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // 'sha256-...' covers the one inline theme-detection script in index.html.
  // All other scripts are external modules — unsafe-inline is no longer needed in script-src.
  // style-src keeps unsafe-inline because React's CSS-in-JS emits inline <style> tags.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'sha256-ewqMvVQUaHXMsUBgLyvLLkarT9ybz5nbsiioiDY7AJc=' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; frame-src 'self' https://accounts.google.com; connect-src 'self' wss: https:; frame-ancestors 'self';");
  next();
});

// F11: Idle session timeout — 4 hours of inactivity logs out authenticated users.
// Public auth actions are exempt so login/OTP flows are never blocked.
const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const AUTH_ACTIONS = new Set(['login', 'register', 'google_auth', 'send_otp', 'verify_otp', 'register_otp', 'reset_password_via_otp', 'logout', 'logout_all']);
app.use((req, res, next) => {
  if (!req.session?.userId) return next();
  if (AUTH_ACTIONS.has(req.query?.action)) return next();
  const last = req.session.lastActivity;
  if (last && Date.now() - last > IDLE_TIMEOUT_MS) {
    return req.session.destroy(() => res.status(401).json({ error: 'Session expired due to inactivity. Please sign in again.' }));
  }
  // L-1: throttle the touch — persist lastActivity at most once per minute so we
  // don't trigger a MongoStore write on every single authenticated request.
  if (!last || Date.now() - last > 60 * 1000) {
    req.session.lastActivity = Date.now();
  }
  next();
});

const FRONTEND_DIST = path.join(__dirname, 'public');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
}

const sessionStore = MongoStore.create({
  clientPromise: mongoose.connection.asPromise().then(conn => conn.getClient()),
});

sessionStore.on('error', (err) => {
  logger.error({ err }, '[session-store] error');
});

const sessionMiddleware = session({
  secret: SESSION_SECRETS,
  resave: false,
  saveUninitialized: false,
  name: 'brainjot_session',
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});
app.use(sessionMiddleware);
// Share session with Socket.IO so socket.request.session.userId is available
io.engine.use(sessionMiddleware);

// ── Health check — minimal public response; no version/env fingerprinting ────
app.get('/api/health', (_req, res) => {
  const readyState = mongoose.connection ? mongoose.connection.readyState : 0;
  const dbStatus = readyState === 1 ? 'ok' : (readyState === 2 ? 'connecting' : 'down');
  const allOk = dbStatus === 'ok' || dbStatus === 'connecting';
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    checks: { db: dbStatus },
  });
});

app.use('/api/admin', adminRouter);
app.use('/api', apiRouter.router);

// Serve user-uploaded files (avatars, project/task attachments) — local disk only
// When R2 is configured, files are served directly from the R2 public URL
const { UPLOADS_DIR } = require('./utils/storage');
if (!process.env.R2_ACCOUNT_ID) {
  app.use('/uploads', express.static(UPLOADS_DIR));
}

// Serve the built React frontend (production) - catch-all fallback for SPA routing
if (fs.existsSync(FRONTEND_DIST)) {
  app.get('*any', (_req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
}

// ── Global error handler — must be last middleware ────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error({ err, requestId: req.requestId, userId: req.session?.userId, action: req.query?.action }, '[error] unhandled');
  if (process.env.SENTRY_DSN) Sentry.captureException(err, { extra: { requestId: req.requestId, userId: req.session?.userId } });
  res.status(err.status || 500).json({ error: 'Internal server error', requestId: req.requestId });
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, '[unhandledRejection]');
  if (process.env.SENTRY_DSN) Sentry.captureException(reason);
});

// ── Socket.IO — connection lifecycle observability ────────────────
const activeConnections = new Map();
const { livekitEnabled, ActiveCall, generateToken, LIVEKIT_URL } = require('./utils/livekit');
const Project = require('./models/Project');
const Space   = require('./models/Space');

io.on('connection', (socket) => {
  const userId = socket.request.session?.userId;

  // Reject unauthenticated connections immediately — prevents anonymous connection flooding
  if (!userId) {
    socket.disconnect(true);
    return;
  }

  activeConnections.set(socket.id, { userId, connectedAt: Date.now() });
  logger.info({ socketId: socket.id, userId, totalConnections: activeConnections.size }, '[socket] connected');

  // Each authenticated user auto-joins a personal room so we can send directed messages
  socket.join(`user:${userId}`);

  socket.on('join_room', async (room) => {
    if (!socket.request.session?.userId) return;
    if (typeof room !== 'string' || !/^(project|space):[a-zA-Z0-9_]+$/.test(room)) return;

    const [entityType, entityId] = room.split(':');
    try {
      let hasAccess = false;
      if (entityType === 'project') {
        hasAccess = !!(await Project.exists({
          id: entityId,
          $or: [{ ownerId: userId }, { 'collaborators.userId': userId }],
        }));
      } else {
        hasAccess = !!(await Space.exists({
          id: entityId,
          $or: [{ ownerId: userId }, { 'collaborators.userId': userId }],
        }));
      }
      if (!hasAccess) {
        logger.warn({ socketId: socket.id, userId, room }, '[socket] join_room denied — not a member');
        return;
      }
      socket.join(room);
      logger.info({ socketId: socket.id, room }, '[socket] join_room');
    } catch (err) {
      logger.error({ err, room }, '[socket] join_room error');
    }
  });

  socket.on('leave_room', (room) => socket.leave(room));

  // ── Call signalling (only wired when LiveKit env vars are present) ──
  if (livekitEnabled) {
    // Collaborator requests to join the host's call
    socket.on('call:join_request', async ({ callId, requesterName }) => {
      const requesterId = socket.request.session?.userId;
      if (!requesterId) return;
      const call = await ActiveCall.findOne({ callId }).lean();
      if (!call) return;
      io.to(`user:${call.hostUserId}`).emit('call:join_requested', { callId, requesterId, requesterName });
    });

    // Host accepts a join request — verify membership then generate token for the requester
    socket.on('call:accept_join', async ({ callId, requesterId, requesterName }) => {
      const hostId = socket.request.session?.userId;
      const call = await ActiveCall.findOne({ callId, hostUserId: hostId }).lean();
      if (!call) return;
      // Prevent a non-member from receiving a LiveKit token even if the host accidentally accepts
      const isMember = !!(
        await Project.exists({ id: callId, $or: [{ ownerId: requesterId }, { 'collaborators.userId': requesterId }] }) ||
        await Space.exists({ id: callId, $or: [{ ownerId: requesterId }, { 'collaborators.userId': requesterId }] })
      );
      if (!isMember) {
        logger.warn({ callId, requesterId, hostId }, '[call] accept_join denied — requester not a member');
        return;
      }
      try {
        const token = await generateToken(requesterId, requesterName || 'Guest', call.roomName);
        io.to(`user:${requesterId}`).emit('call:join_accepted', {
          callId, token, roomName: call.roomName, livekitUrl: LIVEKIT_URL, callType: call.callType,
        });
      } catch (err) {
        logger.error({ err }, '[call] accept_join token error');
      }
    });

    // Host rejects a join request
    socket.on('call:reject_join', async ({ callId, requesterId }) => {
      const hostId = socket.request.session?.userId;
      const call = await ActiveCall.findOne({ callId, hostUserId: hostId }).lean();
      if (!call) return;
      io.to(`user:${requesterId}`).emit('call:join_rejected', { callId });
    });

    // Host invites a specific collaborator
    socket.on('call:invite', async ({ callId, inviteeId }) => {
      const hostId = socket.request.session?.userId;
      const call = await ActiveCall.findOne({ callId, hostUserId: hostId }).lean();
      if (!call) return;
      io.to(`user:${inviteeId}`).emit('call:invited', { callId, hostName: call.hostName, callType: call.callType, entityType: call.entityType || 'project' });
    });

    // Host ends the call for everyone
    socket.on('call:end', async ({ callId }) => {
      const hostId = socket.request.session?.userId;
      const call = await ActiveCall.findOneAndDelete({ callId, hostUserId: hostId }).lean();
      if (!call) return;
      io.to(`project:${callId}`).to(`space:${callId}`).emit('call:ended', { callId });
      logger.info({ callId, hostId }, '[call] ended');
    });
  }

  socket.on('disconnect', async (reason) => {
    const conn = activeConnections.get(socket.id);
    activeConnections.delete(socket.id);
    const durationMs = Date.now() - (conn?.connectedAt || Date.now());
    logger.info({ socketId: socket.id, userId: conn?.userId, reason, durationMs }, '[socket] disconnected');

    // If the host disconnects, end all their active calls
    if (livekitEnabled && userId) {
      try {
        const hostedCalls = await ActiveCall.find({ hostUserId: userId }).lean();
        if (hostedCalls.length) {
          await ActiveCall.deleteMany({ hostUserId: userId });
          for (const call of hostedCalls) {
            io.to(`project:${call.callId}`).to(`space:${call.callId}`).emit('call:ended', { callId: call.callId });
            logger.info({ callId: call.callId, userId }, '[call] ended on host disconnect');
          }
        }
      } catch (err) {
        logger.error({ err, userId }, '[call] error cleaning up calls on disconnect');
      }
    }
  });
});

// ── Graceful shutdown ─────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, '[shutdown] draining connections');
  server.close(async () => {
    try {
      await mongoose.connection.close();
      logger.info('[shutdown] MongoDB closed — exiting cleanly');
    } catch (err) {
      logger.error({ err }, '[shutdown] MongoDB close error');
    }
    process.exit(0);
  });
  // Force exit after 15 s if drain hangs — the container runtime will SIGKILL anyway
  setTimeout(() => {
    logger.warn('[shutdown] drain timeout — forcing exit');
    process.exit(1);
  }, 15000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  // Listen immediately so health checks succeed even if DB is still starting up
  server.listen(PORT, () => {
    logger.info({ port: PORT }, '[startup] listening');
  });

  // Connect in the background
  mongoose.connect(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  }).then(async () => {
    logger.info('[mongoose] connected successfully');
    // Ensure audit_log auto-expires after 1 year via TTL index on expireAt field
    try {
      await mongoose.connection.db.collection('audit_log')
        .createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, background: true });
    } catch (err) {
      logger.warn({ err }, '[startup] audit_log TTL index creation failed (non-fatal)');
    }
    // C-7: reap expired auth rate-limit docs so the collection doesn't grow unbounded
    // and stale windows can't linger. TTL fires on resetTime (already in the past once expired).
    try {
      await mongoose.connection.db.collection('rate_limits_auth')
        .createIndex({ resetTime: 1 }, { expireAfterSeconds: 0, background: true });
    } catch (err) {
      logger.warn({ err }, '[startup] rate_limits_auth TTL index creation failed (non-fatal)');
    }
  }).catch((err) => {
    logger.error({ err }, '[mongoose] initial connection failure');
  });

  // Mongoose connection event listeners
  mongoose.connection.on('error',        (err) => logger.error({ err }, '[mongoose] error'));
  mongoose.connection.on('disconnected', ()    => logger.warn('[mongoose] disconnected'));
  mongoose.connection.on('reconnected',  ()    => logger.info('[mongoose] reconnected'));

  // Startup configuration report
  logger.info({
    version:  process.env.GIT_COMMIT_SHA?.slice(0, 8) || 'dev',
    env:      process.env.NODE_ENV || 'development',
    port:     PORT,
    resend:   !!process.env.RESEND_API_KEY,
    r2:       !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID),
    livekit:  livekitEnabled,
    appUrl:   process.env.APP_URL || '(default)',
  }, '[startup] config');

  if (!process.env.RESEND_API_KEY)  logger.warn('[startup] RESEND_API_KEY not set — email invites disabled');
  if (!process.env.R2_ACCOUNT_ID)   logger.warn('[startup] R2 credentials not set — using local disk storage');
  if (!livekitEnabled)              logger.warn('[startup] LIVEKIT_* env vars not set — call feature disabled');
}

boot();
