"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateConfigCache = exports.getCachedAppConfig = void 0;
const db_1 = require("../config/db");
let cachedConfig = null;
let cacheExpiry = 0;
const CACHE_DURATION_MS = 2 * 60 * 1000; // 2 minutes cache duration
/**
 * Retrieves the AppConfig, using the in-memory cache if it is still valid.
 * Fail-safe: returns the last cached config if database queries fail.
 */
const getCachedAppConfig = async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && cachedConfig && now < cacheExpiry) {
        return cachedConfig;
    }
    try {
        const config = await db_1.prisma.appConfig.findFirst();
        if (config) {
            cachedConfig = config;
            cacheExpiry = now + CACHE_DURATION_MS;
            return cachedConfig;
        }
    }
    catch (error) {
        console.error('Error fetching AppConfig for cache (falling back to last cached):', error);
    }
    return cachedConfig;
};
exports.getCachedAppConfig = getCachedAppConfig;
/**
 * Invalidates the current cache, forcing the next call to fetch from database.
 */
const invalidateConfigCache = () => {
    cachedConfig = null;
    cacheExpiry = 0;
    console.log('[CACHE] AppConfig cache invalidated.');
};
exports.invalidateConfigCache = invalidateConfigCache;
