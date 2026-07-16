import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { prisma } from './config/db';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import configRoutes from './routes/config.routes';
import notificationRoutes from './routes/notification.routes';
import supportRoutes from './routes/support.routes';
import adminRoutes from './routes/admin.routes';
import callbackRoutes from './routes/callback.routes';
import gameRoutes from './routes/game.routes';
import playgroundRoutes from './routes/playground.routes';
import { startCronJobs } from './services/cron.service';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

const app = express();
const PORT = process.env.PORT || 3000;

startCronJobs();

// Middleware
app.use(helmet());
app.use(compression());

const allowedOrigins = [
  'http://localhost:5173', // Admin local dev
  'http://localhost:3000', // API local dev
  'https://sikkaplay-admin.web.app', // Admin production web app
  'https://sikkaplay.web.app' // Frontend production web app
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, native devices)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// API Request/Response Logger
app.use((req, res, next) => {
  console.log(`[API REQUEST] ${req.method} ${req.url}`);
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      console.log(`[API ERROR RESPONSE] ${req.method} ${req.url} -> ${res.statusCode}`);
    } else {
      console.log(`[API RESPONSE] ${req.method} ${req.url} -> ${res.statusCode}`);
    }
  });
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/config', configRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/callbacks', callbackRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/playground', playgroundRoutes);

// Basic health check route
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'SikkaPlay API is running' });
});

// Test DB Connection
app.get('/api/test-db', async (req: Request, res: Response) => {
  try {
    const usersCount = await prisma.user.count();
    res.status(200).json({ status: 'success', message: 'Database connected successfully!', usersCount });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Database connection failed', error });
  }
});

// Global error handler middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// Socket.io and Redis Adapter Setup
const httpServer = createServer(app);
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const pubClient = new Redis(redisUrl);
const subClient = pubClient.duplicate();

export const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});
io.adapter(createAdapter(pubClient, subClient));

// Socket Authentication Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication error: Missing token'));
  }
  // TODO: Verify Firebase JWT token here
  next();
});

io.on('connection', (socket) => {
  console.log(`[Socket] User connected: ${socket.id}`);
  
  socket.on('join_room', (channelName) => {
    socket.join(channelName);
    console.log(`[Socket] ${socket.id} joined room ${channelName}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] User disconnected: ${socket.id}`);
  });
});

// Start the server
httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
