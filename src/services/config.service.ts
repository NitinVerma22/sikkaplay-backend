import { prisma } from '../config/db';
import { AppConfig } from '@prisma/client';

let cachedConfig: AppConfig | null = null;
let cacheExpiry: number = 0;
const CACHE_DURATION_MS = 2 * 60 * 1000; // 2 minutes cache duration

/**
 * Retrieves the AppConfig, using the in-memory cache if it is still valid.
 * Fail-safe: returns the last cached config if database queries fail.
 */
export const getCachedAppConfig = async (forceRefresh = false): Promise<AppConfig | null> => {
  const now = Date.now();
  if (!forceRefresh && cachedConfig && now < cacheExpiry) {
    return cachedConfig;
  }

  try {
    const config = await prisma.appConfig.findFirst();
    if (config) {
      cachedConfig = config;
      cacheExpiry = now + CACHE_DURATION_MS;
      return cachedConfig;
    }
  } catch (error) {
    console.error('Error fetching AppConfig for cache (falling back to last cached):', error);
  }

  return cachedConfig;
};

/**
 * Invalidates the current cache, forcing the next call to fetch from database.
 */
export const invalidateConfigCache = (): void => {
  cachedConfig = null;
  cacheExpiry = 0;
  console.log('[CACHE] AppConfig cache invalidated.');
};
