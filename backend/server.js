require('dotenv').config();
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
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) throw new Error('SESSION_SECRET environment variable is required');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/brainjot';

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true }
});
app.set('io', io);
app.set('trust proxy', 1); // Railway sits behind a proxy

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

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true);
    else callback(new Error('CORS not allowed'));
  },
  credentials: true,
  exposedHeaders: ['X-Request-ID'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers for all responses (covers Railway single-container path where nginx isn't involved)
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' wss: https:; frame-ancestors 'self';");
  next();
});

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'brainjot_session',
  store: MongoStore.create({ mongoUrl: MONGODB_URI }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});
app.use(sessionMiddleware);
// Share session with Socket.IO so socket.request.session.userId is available
io.engine.use(sessionMiddleware);

// ── Health check — real DB ping, version, uptime ──────────────────
app.get('/api/health', async (_req, res) => {
  const checks = {};
  try {
    await mongoose.connection.db.admin().ping();
    checks.db = 'ok';
  } catch (err) {
    checks.db = 'down';
    checks.dbError = err.message;
  }
  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) || 'dev',
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    checks,
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

// Serve the built React frontend (production)
const FRONTEND_DIST = path.join(__dirname, 'public');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
}

// ── Global error handler — must be last middleware ────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error({ err, requestId: req.requestId, userId: req.session?.userId, action: req.query?.action }, '[error] unhandled');
  // Hook point: Sentry.captureException(err, { extra: { requestId: req.requestId } });
  res.status(err.status || 500).json({ error: 'Internal server error', requestId: req.requestId });
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, '[unhandledRejection]');
  // Hook point: Sentry.captureException(reason);
});

// ── Socket.IO — connection lifecycle observability ────────────────
const activeConnections = new Map();

io.on('connection', (socket) => {
  const userId = socket.request.session?.userId || 'anonymous';
  activeConnections.set(socket.id, { userId, connectedAt: Date.now() });
  logger.info({ socketId: socket.id, userId, totalConnections: activeConnections.size }, '[socket] connected');

  socket.on('join_room', (room) => {
    if (!socket.request.session?.userId) return;
    if (typeof room === 'string' && /^(project|space):[a-zA-Z0-9_]+$/.test(room)) {
      socket.join(room);
      logger.info({ socketId: socket.id, room }, '[socket] join_room');
    }
  });

  socket.on('leave_room', (room) => socket.leave(room));

  socket.on('disconnect', (reason) => {
    const conn = activeConnections.get(socket.id);
    activeConnections.delete(socket.id);
    const durationMs = Date.now() - (conn?.connectedAt || Date.now());
    logger.info({ socketId: socket.id, userId: conn?.userId, reason, durationMs }, '[socket] disconnected');
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
  // Force exit after 15 s if drain hangs — Railway will SIGKILL anyway
  setTimeout(() => {
    logger.warn('[shutdown] drain timeout — forcing exit');
    process.exit(1);
  }, 15000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  await mongoose.connect(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  // Mongoose connection event listeners
  mongoose.connection.on('error',        (err) => logger.error({ err }, '[mongoose] error'));
  mongoose.connection.on('disconnected', ()    => logger.warn('[mongoose] disconnected'));
  mongoose.connection.on('reconnected',  ()    => logger.info('[mongoose] reconnected'));

  // Startup configuration report
  logger.info({
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) || 'dev',
    env:     process.env.NODE_ENV || 'development',
    port:    PORT,
    resend:  !!process.env.RESEND_API_KEY,
    r2:      !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID),
    appUrl:  process.env.APP_URL || '(default)',
  }, '[startup] config');

  if (!process.env.RESEND_API_KEY) logger.warn('[startup] RESEND_API_KEY not set — email invites disabled');
  if (!process.env.R2_ACCOUNT_ID)  logger.warn('[startup] R2 credentials not set — using local disk storage');

  server.listen(PORT, () => {
    logger.info({ port: PORT }, '[startup] listening');
  });
}

boot();
