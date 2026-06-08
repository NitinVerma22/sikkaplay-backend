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
import { startCronJobs } from './services/cron.service';

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

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/config', configRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/callbacks', callbackRoutes);
app.use('/api/game', gameRoutes);

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

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
