"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vpnGuard = void 0;
const config_service_1 = require("../services/config.service");
/**
 * Express middleware to detect VPN and Proxy traffic.
 * If VPN detection is enabled and a proxy/VPN is identified,
 * returns 403 Forbidden with `{ isVpnBlocked: true }`.
 */
const vpnGuard = async (req, res, next) => {
    try {
        const config = await (0, config_service_1.getCachedAppConfig)();
        if (!config || !config.vpnDetectionEnabled) {
            next();
            return;
        }
        // Retrieve client IP
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        let ip = '';
        if (typeof rawIp === 'string') {
            ip = rawIp.split(',')[0].trim();
        }
        else if (Array.isArray(rawIp)) {
            ip = rawIp[0].trim();
        }
        // Bypass loopback and private subnets
        if (!ip || isLocalIp(ip)) {
            next();
            return;
        }
        const apiKey = config.vpnApiKey || '';
        const url = apiKey
            ? `https://proxycheck.io/v2/${ip}?key=${apiKey}&vpn=1`
            : `https://proxycheck.io/v2/${ip}?vpn=1`;
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!response.ok) {
                console.error(`VPN detection API returned status: ${response.status}`);
                next();
                return;
            }
            const data = await response.json();
            if (data && data.status === 'ok') {
                const ipInfo = data[ip];
                if (ipInfo && ipInfo.proxy === 'yes') {
                    console.warn(`[VPN BLOCKED] Request blocked for IP: ${ip}. Info: ${JSON.stringify(ipInfo)}`);
                    res.status(403).json({
                        isVpnBlocked: true,
                        message: 'VPN or Proxy connections are not allowed on SikkaPlay.'
                    });
                    return;
                }
            }
        }
        catch (apiError) {
            console.error('Error querying VPN detection API (fail-open):', apiError);
        }
        next();
    }
    catch (error) {
        console.error('VPN Guard middleware error (fail-open):', error);
        next();
    }
};
exports.vpnGuard = vpnGuard;
/**
 * Checks if the IP is local or on a private subnet.
 */
function isLocalIp(ip) {
    let cleanIp = ip;
    // Normalize IPv6 mapped IPv4 address
    if (ip.startsWith('::ffff:')) {
        cleanIp = ip.substring(7);
    }
    return (cleanIp === '127.0.0.1' ||
        cleanIp === '::1' ||
        cleanIp === 'localhost' ||
        cleanIp.startsWith('10.') ||
        cleanIp.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanIp));
}
