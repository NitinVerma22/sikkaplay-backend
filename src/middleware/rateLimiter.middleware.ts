import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
// Only use Redis if a non-localhost URL is provided
const useRedis = redisUrl && !redisUrl.includes('localhost') && !redisUrl.includes('127.0.0.1');

let authStore: any = undefined;
let earnStore: any = undefined;
let withdrawStore: any = undefined;

if (useRedis) {
  console.log('[RATE LIMITER] Redis configured. Connecting to:', redisUrl);
  const redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  redisClient.on('error', (err) => {
    console.error('[RATE LIMITER] Redis connection error:', err);
  });

  authStore = new RedisStore({
    sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as Promise<any>,
    prefix: 'rl:auth:',
  });

  earnStore = new RedisStore({
    sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as Promise<any>,
    prefix: 'rl:earn:',
  });

  withdrawStore = new RedisStore({
    sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as Promise<any>,
    prefix: 'rl:withdraw:',
  });
} else {
  console.log('[RATE LIMITER] No external Redis URL found or set to localhost. Falling back to default in-memory store.');
}

/**
 * 1. Authentication Rate Limiter (IP-based)
 * Limits registration, login, and Google signup attempts to prevent brute-force attacks.
 */
export const authLimiter = rateLimit({
  store: authStore,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: {
    error: 'Too many authentication attempts. Please try again after 15 minutes.'
  }
});

/**
 * 2. Earning Rate Limiter (User-based with IP fallback)
 * Limits coin claiming and task logs to prevent rapid automated scripting abuse.
 */
export const earnLimiter = rateLimit({
  store: earnStore,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // Limit each user to 60 requests per window (avg 4 claims/min)
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => {
    return (req as any).user?.userId || req.ip || req.socket.remoteAddress || 'unknown-ip';
  },
  message: {
    error: 'Too many earning requests. Please slow down and try again later.'
  }
});

/**
 * 3. Withdrawal Rate Limiter (User-based with IP fallback)
 * Limits withdrawal requests to prevent transaction spamming or double-claiming.
 */
export const withdrawLimiter = rateLimit({
  store: withdrawStore,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each user to 3 requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req: Request) => {
    return (req as any).user?.userId || req.ip || req.socket.remoteAddress || 'unknown-ip';
  },
  message: {
    error: 'Too many withdrawal requests. You can only request withdrawals up to 3 times per hour.'
  }
});


