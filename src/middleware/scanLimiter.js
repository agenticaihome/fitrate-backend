/**
 * Daily Scan Rate Limiter
 * - Free users: 1 scan/day
 * - Pro users: 25 scans/day
 * Uses userId-based tracking (not IP) to allow multiple users on same network
 */

// In-memory store (replace with Redis for production at scale)
const scanStore = new Map();

const LIMITS = {
    free: 1,
    pro: 25
};

// Clean up old entries every hour
setInterval(() => {
    const today = new Date().toDateString();
    for (const [key, data] of scanStore.entries()) {
        if (data.date !== today) {
            scanStore.delete(key);
        }
    }
}, 60 * 60 * 1000);

// Get tracking key - prefer userId over IP for accurate per-user tracking
function getTrackingKey(userId, ip) {
    // If userId provided, use that (unique per browser)
    // Otherwise fall back to IP (less accurate but still works)
    return userId || ip || 'unknown';
}

export function getScanCount(userId, ip) {
    const key = getTrackingKey(userId, ip);
    const today = new Date().toDateString();
    const data = scanStore.get(key);

    if (!data || data.date !== today) {
        return 0;
    }
    return data.count;
}

export function incrementScanCount(userId, ip) {
    const key = getTrackingKey(userId, ip);
    const today = new Date().toDateString();
    const data = scanStore.get(key);

    if (!data || data.date !== today) {
        scanStore.set(key, { date: today, count: 1, isPro: false });
        return 1;
    }

    data.count += 1;
    scanStore.set(key, data);
    return data.count;
}

export function setProStatus(userId, ip, isPro) {
    const key = getTrackingKey(userId, ip);
    const today = new Date().toDateString();
    const data = scanStore.get(key) || { date: today, count: 0 };
    data.isPro = isPro;
    scanStore.set(key, data);
}

export function getProStatus(userId, ip) {
    const key = getTrackingKey(userId, ip);
    const data = scanStore.get(key);
    return data?.isPro || false;
}

import { consumeBonusScan } from './referralStore.js';

export function scanLimiter(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    // Get userId from body or query - this is the unique browser fingerprint
    const userId = req.body?.userId || req.query?.userId;

    const isPro = getProStatus(userId, ip);
    const limit = isPro ? LIMITS.pro : LIMITS.free;
    const currentCount = getScanCount(userId, ip);

    if (currentCount >= limit) {
        // Try to use a bonus scan if available
        if (consumeBonusScan(userId)) {
            // Attach info and allow
            req.scanInfo = { userId, ip, currentCount, limit, isPro, usedBonus: true };
            return next();
        }

        const limitType = isPro ? 'daily Pro' : 'free';
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

    // Attach info to request for use after successful scan
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

