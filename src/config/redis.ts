import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Shared Redis client for data operations
export const redisClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

redisClient.on('error', (err) => {
  console.error('[Redis Client] Error:', err.message);
});

redisClient.on('connect', () => {
  console.log('[Redis Client] Connected to Redis for Data Operations');
});
