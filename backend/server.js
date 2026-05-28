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

const apiRouter = require('./routes/api');
const adminRouter = require('./routes/admin');

const PORT = process.env.PORT || 3001;
const SESSION_SECRET = process.env.SESSION_SECRET || 'secret';
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

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true);
    else callback(new Error('CORS not allowed'));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
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
}));

app.use('/api/admin', adminRouter);
app.use('/api', apiRouter.router);

// Serve the built React frontend (production)
const FRONTEND_DIST = path.join(__dirname, 'public');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
}

io.on('connection', (socket) => {
  socket.on('join_room', (room) => {
    if (typeof room === 'string' && /^(project|space):[a-zA-Z0-9_]+$/.test(room)) {
      socket.join(room);
    }
  });
  socket.on('leave_room', (room) => socket.leave(room));
});

async function boot() {
  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB connected');

  server.listen(PORT, () => {
    console.log(`Backend running at http://localhost:${PORT}`);
  });
}

boot();
