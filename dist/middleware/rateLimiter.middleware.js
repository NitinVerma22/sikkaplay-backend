"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withdrawLimiter = exports.earnLimiter = exports.authLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const rate_limit_redis_1 = __importDefault(require("rate-limit-redis"));
const ioredis_1 = __importDefault(require("ioredis"));
// Create a Redis client.
const redisClient = new ioredis_1.default(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});
redisClient.on('error', (err) => {
    console.error('Redis error:', err);
});
/**
 * 1. Authentication Rate Limiter (IP-based)
 * Limits registration, login, and Google signup attempts to prevent brute-force attacks.
 */
exports.authLimiter = (0, express_rate_limit_1.default)({
    store: new rate_limit_redis_1.default({
        sendCommand: (...args) => redisClient.call(args[0], ...args.slice(1)),
        prefix: 'rl:auth:',
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many authentication attempts. Please try again after 15 minutes.'
    }
});
/**
 * 2. Earning Rate Limiter (User-based with IP fallback)
 * Limits coin claiming and task logs to prevent rapid automated scripting abuse.
 */
exports.earnLimiter = (0, express_rate_limit_1.default)({
    store: new rate_limit_redis_1.default({
        sendCommand: (...args) => redisClient.call(args[0], ...args.slice(1)),
        prefix: 'rl:earn:',
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 60, // Limit each user to 60 requests per window (avg 4 claims/min)
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.user?.userId || req.ip || '';
    },
    message: {
        error: 'Too many earning requests. Please slow down and try again later.'
    }
});
/**
 * 3. Withdrawal Rate Limiter (User-based with IP fallback)
 * Limits withdrawal requests to prevent transaction spamming or double-claiming.
 */
exports.withdrawLimiter = (0, express_rate_limit_1.default)({
    store: new rate_limit_redis_1.default({
        sendCommand: (...args) => redisClient.call(args[0], ...args.slice(1)),
        prefix: 'rl:withdraw:',
    }),
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // Limit each user to 3 requests per hour
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.user?.userId || req.ip || '';
    },
    message: {
        error: 'Too many withdrawal requests. You can only request withdrawals up to 3 times per hour.'
    }
});
