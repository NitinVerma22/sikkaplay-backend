import { Request, Response, NextFunction } from 'express';
import { getCachedAppConfig } from '../services/config.service';

/**
 * In-memory cache for VPN check results per IP.
 * Key: IP address, Value: { isVpn: boolean, expiresAt: number }
 * TTL: 30 minutes — balances security with performance.
 * First earn/claim request checks proxycheck.io, result reused for 30 min.
 */
const vpnCache = new Map<string, { isVpn: boolean; expiresAt: number }>();
const VPN_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Express middleware to detect VPN and Proxy traffic.
 * Result is cached per IP for 30 minutes — proxycheck.io is NOT
 * called on every request, only on first earn/claim per IP per session.
 */
export const vpnGuard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = await getCachedAppConfig();
    if (!config || !config.vpnDetectionEnabled) {
      next();
      return;
    }

    // Retrieve client IP
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    let ip = '';
    if (typeof rawIp === 'string') {
      ip = rawIp.split(',')[0].trim();
    } else if (Array.isArray(rawIp)) {
      ip = rawIp[0].trim();
    }

    // Bypass loopback and private subnets
    if (!ip || isLocalIp(ip)) {
      next();
      return;
    }

    // --- Check cache first ---
    const now = Date.now();
    const cached = vpnCache.get(ip);
    if (cached && now < cached.expiresAt) {
      // Cached result available — no API call needed
      if (cached.isVpn) {
        res.status(403).json({
          isVpnBlocked: true,
          message: 'VPN or Proxy connections are not allowed on SikkaPlay.'
        });
        return;
      }
      next();
      return;
    }

    // --- Cache miss — call proxycheck.io (only once per 30 min per IP) ---
    const apiKey = config.vpnApiKey || '';
    const url = apiKey
      ? `https://proxycheck.io/v2/${ip}?key=${apiKey}&vpn=1`
      : `https://proxycheck.io/v2/${ip}?vpn=1`;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); // 3s timeout
      if (!response.ok) {
        console.error(`VPN detection API returned status: ${response.status}`);
        // Fail-open on API error — don't block user, don't cache
        next();
        return;
      }

      const data = await response.json();
      const isVpn = !!(data && data.status === 'ok' && data[ip]?.proxy === 'yes');

      // Cache result for 30 minutes
      vpnCache.set(ip, { isVpn, expiresAt: now + VPN_CACHE_TTL_MS });

      if (isVpn) {
        console.warn(`[VPN BLOCKED] IP: ${ip}`);
        res.status(403).json({
          isVpnBlocked: true,
          message: 'VPN or Proxy connections are not allowed on SikkaPlay.'
        });
        return;
      }
    } catch (apiError) {
      console.error('Error querying VPN detection API (fail-open):', apiError);
      // Fail-open: allow request, don't cache on error
    }

    next();
  } catch (error) {
    console.error('VPN Guard middleware error (fail-open):', error);
    next();
  }
};

/**
 * Checks if the IP is local or on a private subnet.
 */
function isLocalIp(ip: string): boolean {
  let cleanIp = ip;
  if (ip.startsWith('::ffff:')) {
    cleanIp = ip.substring(7);
  }
  return (
    cleanIp === '127.0.0.1' ||
    cleanIp === '::1' ||
    cleanIp === 'localhost' ||
    cleanIp.startsWith('10.') ||
    cleanIp.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanIp)
  );
}
