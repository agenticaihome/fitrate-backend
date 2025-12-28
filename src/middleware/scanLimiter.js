/**
 * Daily Scan Rate Limiter
 * - Free users: 2 scans/day
 * - Pro users: 25 scans/day
 * Uses Redis with in-memory fallback for local dev
 * SECURITY: Uses device fingerprint to prevent userId spoofing
 */

import { redis, isRedisAvailable } from '../services/redisClient.js';
import { consumeBonusScan, getReferralStats, getPurchasedScans, consumePurchasedScan } from './referralStore.js';
import { generateFingerprint, getClientIP } from '../utils/fingerprint.js';
import { EntitlementService } from '../services/entitlements.js';
import { ERROR_MESSAGES, SCAN_LIMITS } from '../config/systemPrompt.js';

// In-memory fallback for local dev
const scanStoreFallback = new Map();
const proPreviewStoreFallback = new Map(); // Track Pro Preview usage per user per day

// NEW: 1 Pro Preview (GPT-4o) + 1 Free (Gemini) = 2 total per day
const LIMITS = {
    free: 2,   // Total scans (1 Pro Preview + 1 Free)
    pro: 25
};

// Redis key patterns
const SCAN_KEY_PREFIX = 'fitrate:scans:';
const PRO_PREVIEW_PREFIX = 'fitrate:propreview:'; // NEW: Track Pro Preview usage
const PRO_STATUS_PREFIX = 'fitrate:pro:status:';
const INVALID_ATTEMPTS_PREFIX = 'fitrate:invalid:';
const REPEAT_OFFENDER_PREFIX = 'fitrate:banned:';

// Limits - RELAXED for early-stage UX
const MAX_INVALID_ATTEMPTS = 20;
const INVALID_BLOCK_DURATION = 3600;
const PERMANENT_BAN_DURATION = 604800;

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
 * PERSISTENT increment - uses Redis with userId:date key
 * Survives backend restarts/deploys (48h TTL for auto-cleanup)
 */
export async function incrementScanSimple(userId) {
    if (!userId) return 0;
    const today = getTodayKey();
    const redisKey = `${SCAN_KEY_PREFIX}simple:${userId}:${today}`;

    if (isRedisAvailable()) {
        const newCount = await redis.incr(redisKey);
        // Set 48h TTL on first increment (covers timezone edge cases)
        if (newCount === 1) {
            await redis.expire(redisKey, 172800); // 48 hours
        }
        console.log(`[SCAN] Incremented ${userId.slice(0, 12)} to ${newCount} (Redis)`);
        return newCount;
    } else {
        // Fallback to in-memory for local dev
        const key = `${userId}:${today}`;
        const data = scanStoreFallback.get(key) || { count: 0 };
        data.count += 1;
        scanStoreFallback.set(key, data);
        console.log(`[SCAN] Incremented ${userId.slice(0, 12)} to ${data.count} (in-memory)`);
        return data.count;
    }
}

/**
 * Decrement scan count (for rollback on failed analysis)
 * Used when AI call fails to prevent counting failed attempts
 */
export async function decrementScanSimple(userId) {
    if (!userId) return 0;
    const today = getTodayKey();
    const redisKey = `${SCAN_KEY_PREFIX}simple:${userId}:${today}`;

    if (isRedisAvailable()) {
        const newCount = await redis.decr(redisKey);
        // Ensure we don't go negative
        if (newCount < 0) {
            await redis.set(redisKey, 0);
            console.log(`[SCAN] Decremented ${userId.slice(0, 12)} to 0 (clamped, Redis)`);
            return 0;
        }
        console.log(`[SCAN] Decremented ${userId.slice(0, 12)} to ${newCount} (Redis)`);
        return newCount;
    } else {
        // Fallback to in-memory for local dev
        const key = `${userId}:${today}`;
        const data = scanStoreFallback.get(key);
        if (data && data.count > 0) {
            data.count -= 1;
            scanStoreFallback.set(key, data);
            console.log(`[SCAN] Decremented ${userId.slice(0, 12)} to ${data.count} (in-memory)`);
            return data.count;
        }
        return 0;
    }
}

/**
 * PRO PREVIEW SYSTEM - First scan of day uses GPT-4o for "taste"
 * Check if user has used their daily Pro Preview
 */
export async function hasUsedProPreview(userId) {
    if (!userId) return false;
    const today = getTodayKey();
    const key = `${userId}:${today}`;

    if (isRedisAvailable()) {
        const used = await redis.get(`${PRO_PREVIEW_PREFIX}${key}`);
        return used === '1';
    } else {
        return proPreviewStoreFallback.get(key) === true;
    }
}

/**
 * Mark Pro Preview as used for today
 */
export async function markProPreviewUsed(userId) {
    if (!userId) return;
    const today = getTodayKey();
    const key = `${userId}:${today}`;

    if (isRedisAvailable()) {
        await redis.set(`${PRO_PREVIEW_PREFIX}${key}`, '1');
        await redis.expire(`${PRO_PREVIEW_PREFIX}${key}`, 86400); // 24h TTL
    } else {
        proPreviewStoreFallback.set(key, true);
    }
    console.log(`[PRO_PREVIEW] Marked used for ${userId.slice(0, 12)}`);
}

/**
 * Check if next scan should use Pro Preview (GPT-4o)
 * Returns true if Pro Preview is available (not yet used today)
 */
export async function shouldUseProPreview(userId) {
    const used = await hasUsedProPreview(userId);
    return !used; // First scan of day = Pro Preview
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
        // Also clean proPreviewStoreFallback
        const todayKey = getTodayKey();
        for (const key of proPreviewStoreFallback.keys()) {
            if (!key.includes(todayKey)) {
                proPreviewStoreFallback.delete(key);
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
    // SIMPLIFIED: No Pro tier - everyone is free tier
    // Pro subscriptions removed, only scan packs remain for monetization
    return false;
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
 * HYBRID MODEL: Free users get 1 Pro Preview (GPT-4o) + 1 Free (Gemini) = 2/day
 * Pro users: 25 scans/day (all GPT-4o)
 * 
 * NEW: Frontend can send useProScan to let user CONSCIOUSLY choose:
 *   - useProScan: true  → Use Pro Preview (GPT-4o) for this scan
 *   - useProScan: false → Skip Pro Preview, use Free (Gemini)
 *   - useProScan: undefined → Auto behavior (use Pro if available)
 */
export async function scanLimiter(req, res, next) {
    const ip = getClientIP(req);
    const userId = req.body?.userId || req.query?.userId;

    // ARENA MODE: Free to play all day, skip scan counting
    if (req.body?.arenaMode === true) {
        console.log(`[SCAN] Arena mode - free scan for ${userId?.slice(0, 12) || 'unknown'}`);
        req.scanInfo = {
            userId,
            ip,
            currentCount: 0,
            limit: 999,
            isPro: false,
            arenaMode: true,
            scanIncremented: false  // Don't rollback on failure since we never incremented
        };
        return next();
    }

    // Must have userId
    if (!userId) {
        console.log(`[SCAN] No userId provided, allowing through`);
        req.scanInfo = { userId: null, ip, currentCount: 0, limit: LIMITS.free, isPro: false, useProPreview: false };
        return next();
    }

    // PERSISTENT tracking by userId + today's date (Redis with in-memory fallback)
    const today = getTodayKey();
    const redisKey = `${SCAN_KEY_PREFIX}simple:${userId}:${today}`;

    // Get current count from Redis (or in-memory fallback)
    let currentCount = 0;
    if (isRedisAvailable()) {
        const count = await redis.get(redisKey);
        currentCount = parseInt(count) || 0;
    } else {
        const key = `${userId}:${today}`;
        const data = scanStoreFallback.get(key) || { count: 0 };
        currentCount = data.count;
    }

    // Check Pro status
    const isPro = await getProStatus(userId, ip);
    const limit = isPro ? LIMITS.pro : LIMITS.free;

    // SIMPLIFIED: No more Pro Preview - just 2 free Gemini scans/day
    // Pro scans are earned via referrals (handled by proRoasts in analyze route)

    console.log(`[SCAN] userId:${userId.slice(0, 12)} count:${currentCount}/${limit} isPro:${isPro}`);

    // Check if daily limit reached
    if (currentCount >= limit) {
        // OVERFLOW MODEL: Check if user has purchased scans before blocking
        const purchasedScans = await getPurchasedScans(userId);

        if (purchasedScans > 0) {
            // User has purchased scans - allow through and mark for consumption
            console.log(`[SCAN] Daily limit reached but user has ${purchasedScans} purchased scans - allowing overflow`);
            req.scanInfo = {
                userId,
                ip,
                currentCount,
                limit,
                isPro,
                useProPreview: false,
                usePurchasedScan: true,  // Flag to consume purchased scan in analyze.js
                purchasedScansRemaining: purchasedScans
            };
            return next();
        }

        // No purchased scans - block the request
        console.log(`[SCAN] BLOCKED - limit reached, no purchased scans`);
        return res.status(429).json({
            success: false,
            error: isPro
                ? 'Daily Pro limit reached. Buy a scan pack or come back tomorrow!'
                : `You've used your 2 free daily scans. Buy a scan pack or upgrade for more!`,
            code: 'LIMIT_REACHED',
            limitReached: true,
            isPro,
            scansUsed: currentCount,
            scansLimit: limit,
            purchasedScansRemaining: 0,
            resetTime: getResetTime()
        });
    }

    // ATOMIC INCREMENT: Increment count NOW, before AI call
    // If AI fails, analyze.js will decrement using decrementScanSimple()
    const newCount = await incrementScanSimple(userId);
    console.log(`[SCAN] ATOMIC increment userId:${userId.slice(0, 12)} to ${newCount}/${limit}`);

    // Attach info for route handler
    const purchasedScans = await getPurchasedScans(userId);
    req.scanInfo = {
        userId,
        ip,
        currentCount: newCount, // Now reflects the NEW count after increment
        limit,
        isPro,
        useProPreview: false,
        usePurchasedScan: false,
        purchasedScansRemaining: purchasedScans,
        scanIncremented: true // Flag for analyze.js to know it should decrement on failure
    };
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
