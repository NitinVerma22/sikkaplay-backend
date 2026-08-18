import 'dotenv/config';
import path from 'path';
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
import waterSortRoutes from './routes/waterSort.routes';
import bubbleShooterRoutes from './routes/bubbleShooter.routes';
import arrowEscapeRoutes from './routes/arrowEscape.routes';
import { startCronJobs } from './services/cron.service';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { MatchmakingService } from './services/matchmaking.service';

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

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

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
app.use('/api/v1/water-sort', waterSortRoutes);
app.use('/api/water-sort', waterSortRoutes);
app.use('/api/v1/bubble-shooter', bubbleShooterRoutes);
app.use('/api/bubble-shooter', bubbleShooterRoutes);
app.use('/api/v1/arrow-escape', arrowEscapeRoutes);
app.use('/api/arrow-escape', arrowEscapeRoutes);

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
const pubClient = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 1000, 3000),
});
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => {
  // Silent error log when offline
});

subClient.on('error', (err) => {
  // Silent error log when offline
});

export const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

pubClient.on('connect', () => {
  console.log('[Redis] PubClient connected, enabling Redis adapter for Socket.io');
  io.adapter(createAdapter(pubClient, subClient));
});

const matchmakingService = new MatchmakingService(io);
matchmakingService.startWorker();

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

  socket.on('mark_seen', async (data) => {
    const { messageIds, channelName } = data;
    if (messageIds && Array.isArray(messageIds) && messageIds.length > 0 && channelName) {
      try {
        await prisma.playgroundMessage.updateMany({
          where: { id: { in: messageIds } },
          data: { isSeen: true }
        });
        // Emit to the room (except sender) that messages are seen
        socket.to(channelName).emit('message_seen', { messageIds });
        const firstMessage = await prisma.playgroundMessage.findUnique({ where: { id: messageIds[0] } });
        if (firstMessage && firstMessage.senderId) {
          socket.to(`friend-chat-${firstMessage.senderId}`).emit('message_seen', { messageIds });
        }
      } catch (err) {
        console.error('Error in mark_seen socket event:', err);
      }
    }
  });

  // Tic-Tac-Toe Game Direct Socket Signaling
  socket.on('game_signal', (data) => {
    // data should contain { channelName, signal, senderId }
    if (data && data.channelName) {
      socket.to(data.channelName).emit('game_signal', data);
    }
  });

  socket.on('game_move', (data) => {
    // data should contain { channelName, index, senderId }
    if (data && data.channelName) {
      socket.to(data.channelName).emit('game_move', data);
    }
  });

  // Matchmaking Events
  socket.on('matchmaking_search_start', async (data) => {
    try {
      let { userId, gender, preference } = data;
      
      // Fix case sensitivity
      gender = (gender || 'male').toLowerCase();
      preference = (preference || 'random').toLowerCase();
      
      // Ensure valid values
      if (!['male', 'female', 'random'].includes(gender)) gender = 'random';
      if (!['male', 'female', 'random'].includes(preference)) preference = 'random';

      // Socket authentication happens via middleware, but ensure userId is present
      if (userId) {
        socket.data.userId = userId;
        await matchmakingService.joinSearch(userId, socket.id, gender, preference);
      }
    } catch (e: any) {
      socket.emit('matchmaking_error', { message: e.message });
    }
  });

  socket.on('matchmaking_search_cancel', async (data) => {
    try {
      const { userId } = data;
      if (userId) {
        socket.data.userId = userId;
        await matchmakingService.cancelSearch(userId);
      }
    } catch (e: any) {
      console.error('Cancel search error:', e.message);
    }
  });

  socket.on('matchmaking_heartbeat', async (data) => {
    try {
      const { userId } = data;
      if (userId) {
        socket.data.userId = userId;
        await matchmakingService.updateHeartbeat(userId);
      }
    } catch (e) {}
  });

  socket.on('matchmaking_leave_chat', async (data) => {
    try {
      const { userId } = data;
      if (userId) {
        socket.data.userId = userId;
        await matchmakingService.leaveChat(userId);
      }
    } catch (e) {}
  });

  socket.on('chat_user_left', (data) => {
    try {
      const { roomId, userId, userName } = data;
      if (roomId) {
        socket.to(roomId).emit('partner_left_chat', {
          userId,
          message: `${userName || 'Partner'} left this chat`
        });
        socket.to(roomId).emit('partner_left', {
          userId,
          message: `${userName || 'Partner'} left this chat`
        });
      }
    } catch (e) {}
  });

  socket.on('disconnecting', () => {
    try {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.to(room).emit('partner_left_chat', {
            message: 'Partner left this chat'
          });
          socket.to(room).emit('partner_left', {
            message: 'Partner left this chat'
          });
        }
      }
    } catch (e) {}
  });

  socket.on('disconnect', async () => {
    console.log(`[Socket] User disconnected: ${socket.id}`);
    
    if (socket.data && socket.data.userId) {
      const userId = socket.data.userId;
      await matchmakingService.handleDisconnect(userId);
    }
    
    // Prevent memory leaks by removing listeners
    socket.removeAllListeners();
  });
});

// Start the server
httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Prevent Node.js from silently crashing due to unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  // We log it but do NOT exit the process, keeping WebSockets alive
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception thrown:', err);
  process.exit(1); // Must exit on uncaught exception to avoid undefined state
});
