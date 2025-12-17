/**
 * Daily Scan Rate Limiter
 * - Free users: 2 scans/day
 * - Pro users: 25 scans/day
 * Uses Redis with in-memory fallback for local dev
 */

import { redis, isRedisAvailable } from '../services/redisClient.js';
import { consumeBonusScan } from './referralStore.js';

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

// Get tracking key
function getTrackingKey(userId, ip) {
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

export async function getScanCount(userId, ip) {
    const key = getTrackingKey(userId, ip);
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

export async function incrementScanCount(userId, ip) {
    const key = getTrackingKey(userId, ip);
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

export async function setProStatus(userId, ip, isPro) {
    const key = getTrackingKey(userId, ip);

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
    const key = getTrackingKey(userId, ip);

    if (isRedisAvailable()) {
        const status = await redis.get(`${PRO_STATUS_PREFIX}${key}`);
        return status === '1';
    } else {
        const data = scanStoreFallback.get(key);
        return data?.isPro || false;
    }
}

export async function scanLimiter(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userId = req.body?.userId || req.query?.userId;

    const isPro = await getProStatus(userId, ip);
    const limit = isPro ? LIMITS.pro : LIMITS.free;
    const currentCount = await getScanCount(userId, ip);

    if (currentCount >= limit) {
        // Try to use a bonus scan if available
        const usedBonus = await consumeBonusScan(userId);
        if (usedBonus) {
            req.scanInfo = { userId, ip, currentCount, limit, isPro, usedBonus: true };
            return next();
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
            upgradeUrl: isPro ? null : 'https://buy.stripe.com/4gM00l2SI7wT7LpfztfYY00',
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
