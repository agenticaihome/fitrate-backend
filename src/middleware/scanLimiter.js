/**
 * Daily Scan Rate Limiter
 * - Free users: 2 scans/day
 * - Pro users: 25 scans/day
 * Uses Redis with in-memory fallback for local dev
 * SECURITY: Uses device fingerprint to prevent userId spoofing
 */

import { redis, isRedisAvailable } from '../services/redisClient.js';
import { consumeBonusScan, getReferralStats } from './referralStore.js';
import { generateFingerprint, getClientIP } from '../utils/fingerprint.js';
import { EntitlementService } from '../services/entitlements.js';
import { ERROR_MESSAGES, SCAN_LIMITS } from '../config/systemPrompt.js';

// In-memory fallback for local dev
const scanStoreFallback = new Map();

const LIMITS = {
    free: 2,
    pro: 25
};

// Redis key patterns
const SCAN_KEY_PREFIX = 'fitrate:scans:';
const PRO_STATUS_PREFIX = 'fitrate:pro:status:';
const INVALID_ATTEMPTS_PREFIX = 'fitrate:invalid:'; // Track failed/invalid image submissions
const REPEAT_OFFENDER_PREFIX = 'fitrate:banned:'; // Permanently banned repeat offenders

// Limits - RELAXED for early-stage UX (can tighten later)
const MAX_INVALID_ATTEMPTS = 20; // Was 5 - more forgiving for legitimate users
const INVALID_BLOCK_DURATION = 3600; // 1 hour block (was 24 hours)
const PERMANENT_BAN_DURATION = 604800; // 7 days "permanent" ban (was 30 days)

// Get today's date string for key
function getTodayKey() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Generate secure tracking key from request
 * FIXED: Uses userId as PRIMARY identifier to prevent identity collisions.
 * Fingerprint is now secondary (for abuse detection of multi-account switching).
 * 
 * RATIONALE: userId is a crypto-random UUID stored in client localStorage.
 * It's stable per device. Fingerprint (IP+headers) collides for users on:
 * - Same mobile carrier (NAT)
 * - Same corporate proxy
 * - Same VPN server
 * - Behind Cloudflare (if cf-connecting-ip not trusted)
 */
function getSecureKey(req) {
    const userId = req?.body?.userId || req?.query?.userId;
    // userId is PRIMARY - fingerprint only used if no userId (anonymous)
    if (userId && userId.length >= 16) {
        const key = `user:${userId}`;
        console.log(`[IDENTITY] Using userId key: ${key.slice(0, 30)}...`);
        return key;
    }
    // Fallback: fingerprint for anonymous users
    const fingerprint = generateFingerprint(req);
    const key = `fp:${fingerprint}`;
    console.log(`[IDENTITY] Using fingerprint key: ${key} (no userId in request)`);
    return key;
}

// Legacy key generation for backward compatibility with status endpoints
function getLegacyKey(userId, ip) {
    return userId || ip || 'unknown';
}

/**
 * Get scan count from request object (unified identity for all endpoints)
 * Use this instead of getScanCount() for consistent behavior
 */
export async function getScanCountFromRequest(req) {
    return getScanCountSecure(req);
}

/**
 * SIMPLIFIED increment - uses in-memory Map with userId:date key
 * Resets when backend restarts/deploys
 */
export function incrementScanSimple(userId) {
    if (!userId) return 0;
    const today = getTodayKey();
    const key = `${userId}:${today}`;
    const data = scanStoreFallback.get(key) || { count: 0 };
    data.count += 1;
    scanStoreFallback.set(key, data);
    console.log(`[SCAN] Incremented ${userId.slice(0, 12)} to ${data.count}`);
    return data.count;
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

    // 1. Check legacy/redis cache (fastest)
    let status = false;
    if (isRedisAvailable()) {
        const val = await redis.get(`${PRO_STATUS_PREFIX}${key}`);
        status = val === '1';
    } else {
        const data = scanStoreFallback.get(key);
        status = data?.isPro || false;
    }

    // 2. If not found in cache, but we have a userId, consult the Authority (Entitlements)
    // This allows recovery from server restarts without explicit re-auth
    if (!status && userId) {
        const authoritativePro = await EntitlementService.isPro(userId);
        if (authoritativePro) {
            // Self-heal the cache
            await setProStatus(userId, ip, true);
            return true;
        }
    }

    return status;
}

/**
 * Track invalid image submissions to prevent abuse
 * Returns current count and whether user is blocked
 * REPEAT OFFENDERS: If blocked twice, permanently banned
 */
export async function trackInvalidAttempt(req) {
    const fingerprint = generateFingerprint(req);
    const invalidKey = `${INVALID_ATTEMPTS_PREFIX}${fingerprint}`;
    const banKey = `${REPEAT_OFFENDER_PREFIX}${fingerprint}`;

    if (isRedisAvailable()) {
        // Check if already permanently banned
        const isBanned = await redis.get(banKey);
        if (isBanned) {
            return { count: 999, blocked: true, permanentlyBanned: true };
        }

        const count = await redis.incr(invalidKey);
        if (count === 1) {
            await redis.expire(invalidKey, INVALID_BLOCK_DURATION);
        }

        const isBlocked = count > MAX_INVALID_ATTEMPTS;

        // If just hit block threshold, check if this is a repeat offense
        if (isBlocked && count === MAX_INVALID_ATTEMPTS + 1) {
            // Check if they were blocked before (repeat offender key)
            const wasBlockedBefore = await redis.get(`${invalidKey}:repeat`);
            if (wasBlockedBefore) {
                // REPEAT OFFENDER - permanent ban
                await redis.set(banKey, '1');
                await redis.expire(banKey, PERMANENT_BAN_DURATION);
                console.warn(`🚫 PERMANENT BAN: Repeat offender ${fingerprint.slice(0, 12)}`);
                return { count, blocked: true, permanentlyBanned: true };
            } else {
                // First offense - mark for repeat tracking
                await redis.set(`${invalidKey}:repeat`, '1');
                await redis.expire(`${invalidKey}:repeat`, PERMANENT_BAN_DURATION); // Remember for 30 days
            }
        }

        return { count, blocked: isBlocked, permanentlyBanned: false };
    } else {
        // In-memory fallback (simplified)
        const data = scanStoreFallback.get(invalidKey) || { count: 0, expiry: Date.now() + INVALID_BLOCK_DURATION * 1000, wasBlocked: false };
        if (Date.now() > data.expiry) {
            // Check if they were blocked before resetting
            if (data.count > MAX_INVALID_ATTEMPTS) {
                data.wasBlocked = true;
            }
            data.count = 0;
            data.expiry = Date.now() + INVALID_BLOCK_DURATION * 1000;
        }
        data.count += 1;
        scanStoreFallback.set(invalidKey, data);

        const isBlocked = data.count > MAX_INVALID_ATTEMPTS;
        const permanentlyBanned = isBlocked && data.wasBlocked;

        return { count: data.count, blocked: isBlocked, permanentlyBanned };
    }
}

/**
 * Check if user is blocked for too many invalid attempts
 * Also checks for permanent bans from repeat offenses
 */
export async function isBlockedForInvalidAttempts(req) {
    const fingerprint = generateFingerprint(req);
    const invalidKey = `${INVALID_ATTEMPTS_PREFIX}${fingerprint}`;
    const banKey = `${REPEAT_OFFENDER_PREFIX}${fingerprint}`;

    if (isRedisAvailable()) {
        // Check permanent ban first
        const isBanned = await redis.get(banKey);
        if (isBanned) return true;

        // Check temp block
        const count = await redis.get(invalidKey);
        return parseInt(count) > MAX_INVALID_ATTEMPTS;
    } else {
        const banData = scanStoreFallback.get(banKey);
        if (banData) return true;

        const data = scanStoreFallback.get(invalidKey);
        if (!data || Date.now() > data.expiry) return false;
        return data.count > MAX_INVALID_ATTEMPTS;
    }
}

/**
 * Main scan limiter middleware
 * 
 * ⚠️ TEMPORARILY DISABLED FOR TESTING - Remove this bypass before production!
 * TODO: Re-enable limits and fix Redis persistence
 */
export async function scanLimiter(req, res, next) {
    // === TEMPORARY: Bypass all limits for testing ===
    const ip = getClientIP(req);
    const userId = req.body?.userId || req.query?.userId;
    console.log(`[SCAN] ⚠️ LIMITS DISABLED - allowing scan for ${userId?.slice(0, 12) || 'anonymous'}`);
    req.scanInfo = { userId, ip, currentCount: 0, limit: 9999, isPro: true };
    return next();
    // === END TEMPORARY BYPASS ===

    // Must have userId
    if (!userId) {
        console.log(`[SCAN] No userId provided, allowing through`);
        req.scanInfo = { userId: null, ip, currentCount: 0, limit: LIMITS.free, isPro: false };
        return next();
    }

    // Simple in-memory tracking by userId + today's date
    const today = getTodayKey();
    const key = `${userId}:${today}`;

    // Get current count from in-memory store
    const data = scanStoreFallback.get(key) || { count: 0 };
    const currentCount = data.count;

    // Check Pro status
    const isPro = await getProStatus(userId, ip);
    const limit = isPro ? LIMITS.pro : LIMITS.free;

    console.log(`[SCAN] userId:${userId.slice(0, 12)} count:${currentCount}/${limit} isPro:${isPro}`);

    // Enforce limit
    if (currentCount >= limit) {
        console.log(`[SCAN] BLOCKED - limit reached`);
        return res.status(429).json({
            success: false,
            error: isPro
                ? 'Daily Pro limit reached. Come back tomorrow!'
                : `You've used your ${limit} free scans today. Upgrade to Pro for 25/day!`,
            code: 'LIMIT_REACHED',
            limitReached: true,
            isPro,
            scansUsed: currentCount,
            scansLimit: limit,
            resetTime: getResetTime()
        });
    }

    req.scanInfo = { userId, ip, currentCount, limit, isPro };
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
