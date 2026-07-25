import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Shared Redis client for data operations
const actualRedis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => {
    return Math.min(times * 1000, 3000);
  }
});

actualRedis.on('error', (err) => {
  // Silent catch to prevent console flooding when offline
});

actualRedis.on('connect', () => {
  console.log('[Redis Client] Connected to Redis for Data Operations');
});

// In-memory fallback storage for when Redis is offline or unreachable (e.g. Google Cloud Run serverless)
const memoryStore = {
  kv: new Map<string, string>(),
  queues: new Map<string, string[]>(),

  isReady(): boolean {
    return actualRedis.status === 'ready';
  },

  async get(key: string): Promise<string | null> {
    if (this.isReady()) {
      try { return await actualRedis.get(key); } catch (e) {}
    }
    return this.kv.get(key) || null;
  },
  async set(key: string, val: string): Promise<any> {
    if (this.isReady()) {
      try { return await actualRedis.set(key, val); } catch (e) {}
    }
    this.kv.set(key, val);
    return 'OK';
  },
  async del(...keys: string[]): Promise<number> {
    if (this.isReady()) {
      try { return await actualRedis.del(...keys); } catch (e) {}
    }
    let count = 0;
    for (const k of keys) {
      if (this.kv.has(k)) {
        this.kv.delete(k);
        count++;
      }
      if (this.queues.has(k)) {
        this.queues.delete(k);
        count++;
      }
    }
    return count;
  },
  async rpush(key: string, ...vals: string[]): Promise<number> {
    if (this.isReady()) {
      try { return await actualRedis.rpush(key, ...vals); } catch (e) {}
    }
    const q = this.queues.get(key) || [];
    q.push(...vals);
    this.queues.set(key, q);
    return q.length;
  },
  async lrange(key: string, start: number, end: number): Promise<string[]> {
    if (this.isReady()) {
      try { return await actualRedis.lrange(key, start, end); } catch (e) {}
    }
    const q = this.queues.get(key) || [];
    if (end === -1 || end >= q.length) return q.slice(start);
    return q.slice(start, end + 1);
  },
  async lrem(key: string, count: number, val: string): Promise<number> {
    if (this.isReady()) {
      try { return await actualRedis.lrem(key, count, val); } catch (e) {}
    }
    const q = this.queues.get(key) || [];
    const initialLen = q.length;
    const filtered = q.filter(item => item !== val);
    this.queues.set(key, filtered);
    return initialLen - filtered.length;
  },
  async keys(pattern: string): Promise<string[]> {
    if (this.isReady()) {
      try { return await actualRedis.keys(pattern); } catch (e) {}
    }
    const prefix = pattern.replace('*', '');
    return Array.from(this.kv.keys()).filter(k => k.startsWith(prefix));
  }
};

export const redisClient = memoryStore as any;
