/**
 * Daily Scan Rate Limiter
 * - Free users: 2 scans/day
 * - Pro users: 25 scans/day
 * Uses Redis with in-memory fallback for local dev
 * SECURITY: Uses device fingerprint to prevent userId spoofing
 */

import { redis, isRedisAvailable } from '../services/redisClient.js';
import { consumeBonusScan } from './referralStore.js';
import { generateFingerprint, getClientIP } from '../utils/fingerprint.js';

// In-memory fallback for local dev
const scanStoreFallback = new Map();

const LIMITS = {
    free: 2,
    pro: 25
};

// Redis key patterns
const SCAN_KEY_PREFIX = 'fitrate:scans:';
const PRO_STATUS_PREFIX = 'fitrate:pro:status:';

// Get today's date string for key
function getTodayKey() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Generate secure tracking key from request
 * SECURITY: Uses fingerprint as primary identifier to prevent userId spoofing
 */
function getSecureKey(req) {
    const fingerprint = generateFingerprint(req);
    const userId = req?.body?.userId || req?.query?.userId;
    // Fingerprint is the anchor, userId is secondary
    return userId ? `${fingerprint}:${userId.slice(0, 12)}` : fingerprint;
}

// Legacy key generation for backward compatibility with status endpoints
function getLegacyKey(userId, ip) {
    return userId || ip || 'unknown';
}

// Clean up old entries every hour (only for in-memory fallback)
setInterval(() => {
    if (!isRedisAvailable()) {
        const today = new Date().toDateString();
        for (const [key, data] of scanStoreFallback.entries()) {
            if (data.date !== today) {
                scanStoreFallback.delete(key);
            }
        }
    }
}, 60 * 60 * 1000);

// Get scan count using secure key from request
export async function getScanCountSecure(req) {
    const key = getSecureKey(req);
    const today = getTodayKey();

    if (isRedisAvailable()) {
        const count = await redis.get(`${SCAN_KEY_PREFIX}${key}:${today}`);
        return parseInt(count) || 0;
    } else {
        const data = scanStoreFallback.get(key);
        if (!data || data.date !== new Date().toDateString()) {
            return 0;
        }
        return data.count;
    }
}

// Legacy version for status endpoint (uses userId/IP, not fingerprint)
export async function getScanCount(userId, ip) {
    const key = getLegacyKey(userId, ip);
    const today = getTodayKey();

    if (isRedisAvailable()) {
        const count = await redis.get(`${SCAN_KEY_PREFIX}${key}:${today}`);
        return parseInt(count) || 0;
    } else {
        const data = scanStoreFallback.get(key);
        if (!data || data.date !== new Date().toDateString()) {
            return 0;
        }
        return data.count;
    }
}

// Increment scan count using secure key from request
export async function incrementScanCountSecure(req) {
    const key = getSecureKey(req);
    const today = getTodayKey();

    if (isRedisAvailable()) {
        const redisKey = `${SCAN_KEY_PREFIX}${key}:${today}`;
        const newCount = await redis.incr(redisKey);
        // Set 24h TTL on first increment
        if (newCount === 1) {
            await redis.expire(redisKey, 86400); // 24 hours
        }
        return newCount;
    } else {
        const todayStr = new Date().toDateString();
        const data = scanStoreFallback.get(key);

        if (!data || data.date !== todayStr) {
            scanStoreFallback.set(key, { date: todayStr, count: 1, isPro: false });
            return 1;
        }

        data.count += 1;
        scanStoreFallback.set(key, data);
        return data.count;
    }
}

// Legacy version for backward compatibility
export async function incrementScanCount(userId, ip) {
    const key = getLegacyKey(userId, ip);
    const today = getTodayKey();

    if (isRedisAvailable()) {
        const redisKey = `${SCAN_KEY_PREFIX}${key}:${today}`;
        const newCount = await redis.incr(redisKey);
        if (newCount === 1) {
            await redis.expire(redisKey, 86400);
        }
        return newCount;
    } else {
        const todayStr = new Date().toDateString();
        const data = scanStoreFallback.get(key);
        if (!data || data.date !== todayStr) {
            scanStoreFallback.set(key, { date: todayStr, count: 1, isPro: false });
            return 1;
        }
        data.count += 1;
        scanStoreFallback.set(key, data);
        return data.count;
    }
}

export async function setProStatus(userId, ip, isPro) {
    const key = getLegacyKey(userId, ip);

    if (isRedisAvailable()) {
        const redisKey = `${PRO_STATUS_PREFIX}${key}`;
        if (isPro) {
            await redis.set(redisKey, '1');
        } else {
            await redis.del(redisKey);
        }
    } else {
        const today = new Date().toDateString();
        const data = scanStoreFallback.get(key) || { date: today, count: 0 };
        data.isPro = isPro;
        scanStoreFallback.set(key, data);
    }
}

export async function getProStatus(userId, ip) {
    const key = getLegacyKey(userId, ip);

    if (isRedisAvailable()) {
        const status = await redis.get(`${PRO_STATUS_PREFIX}${key}`);
        return status === '1';
    } else {
        const data = scanStoreFallback.get(key);
        return data?.isPro || false;
    }
}

/**
 * Main scan limiter middleware
 * SECURITY: Uses fingerprint-based tracking to prevent userId spoofing
 * SECURITY: Checks for suspicious behavior before processing
 */
export async function scanLimiter(req, res, next) {
    const ip = getClientIP(req);
    const userId = req.body?.userId || req.query?.userId;
    const fingerprint = generateFingerprint(req);

    // SECURITY: Check for suspicious behavior first (bots, multi-account abuse)
    const { checkSuspiciousBehavior } = await import('../utils/fingerprint.js');
    const suspiciousCheck = await checkSuspiciousBehavior(req, userId);

    if (suspiciousCheck.suspicious) {
        console.warn(`🚫 BLOCKED: ${suspiciousCheck.reason} | fp:${fingerprint.slice(0, 12)} | ip:${ip?.slice(-8)}`);

        // Different responses based on reason
        if (suspiciousCheck.reason === 'bot_ua' || suspiciousCheck.reason === 'missing_ua') {
            return res.status(403).json({
                success: false,
                error: 'Request blocked. Please use a web browser.',
                code: 'BOT_DETECTED'
            });
        }

        if (suspiciousCheck.reason === 'multi_account') {
            return res.status(429).json({
                success: false,
                error: 'Too many accounts from this device. Try again later.',
                code: 'ABUSE_DETECTED'
            });
        }

        if (suspiciousCheck.blocked) {
            return res.status(403).json({
                success: false,
                error: 'Access temporarily restricted.',
                code: 'TEMPORARILY_BLOCKED'
            });
        }
    }

    // Use fingerprint-based count for actual limiting
    const isPro = await getProStatus(userId, ip);
    const limit = isPro ? LIMITS.pro : LIMITS.free;
    const currentCount = await getScanCountSecure(req);

    if (currentCount >= limit) {
        // Try to use a bonus scan if available
        const usedBonus = await consumeBonusScan(userId);
        if (usedBonus) {
            req.scanInfo = { userId, ip, fingerprint, currentCount, limit, isPro, usedBonus: true };
            return next();
        }

        // Log potential abuse
        if (currentCount > limit * 2) {
            console.warn(`⚠️ ABUSE: fingerprint=${fingerprint.slice(0, 12)} exceeded ${currentCount}/${limit} scans`);
        }

        return res.status(429).json({
            success: false,
            error: isPro
                ? `You've hit your ${LIMITS.pro} scans for today! Come back tomorrow 🔥`
                : `You've used your free scan for today! Share with friends to earn more.`,
            limitReached: true,
            isPro,
            scansUsed: currentCount,
            scansLimit: limit,
            resetTime: getResetTime()
        });
    }

    req.scanInfo = { userId, ip, fingerprint, currentCount, limit, isPro };
    next();
}

function getResetTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.toISOString();
}

export { LIMITS };
