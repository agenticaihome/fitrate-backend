/**
 * Device Fingerprint Generator
 * Creates a stable fingerprint from request headers to prevent userId spoofing
 * Used for rate limiting and abuse prevention
 * SECURITY: Enhanced with multiple signals for harder spoofing
 */

import crypto from 'crypto';
import { redis, isRedisAvailable } from '../services/redisClient.js';

// Track suspicious fingerprints
const SUSPICIOUS_KEY_PREFIX = 'fitrate:suspicious:';
const FINGERPRINT_USERS_PREFIX = 'fitrate:fp:users:';

/**
 * Generate a device fingerprint from request headers
 * Combines multiple signals for harder spoofing
 */
export function generateFingerprint(req) {
    const ip = getClientIP(req);
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';
    const acceptEncoding = req.headers['accept-encoding'] || '';
    // Additional signals that are harder to spoof
    const accept = req.headers['accept'] || '';
    const connection = req.headers['connection'] || '';
    const cacheControl = req.headers['cache-control'] || '';
    const secFetchMode = req.headers['sec-fetch-mode'] || '';
    const secFetchSite = req.headers['sec-fetch-site'] || '';

    // Create a stable hash from these values
    const raw = `${ip}|${userAgent}|${acceptLanguage}|${acceptEncoding}|${accept}|${connection}|${cacheControl}|${secFetchMode}|${secFetchSite}`;

    return crypto.createHash('sha256')
        .update(raw)
        .digest('hex')
        .slice(0, 32); // 32 char fingerprint for better uniqueness
}

/**
 * Get client IP, handling proxies correctly
 */
export function getClientIP(req) {
    // Railway/Cloudflare set these headers
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        // Take the first IP (original client)
        return forwarded.split(',')[0].trim();
    }

    const realIp = req.headers['x-real-ip'];
    if (realIp) {
        return realIp;
    }

    return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * Get a tracking key for rate limiting
 * Priority: userId (if trusted) > fingerprint > IP
 */
export function getTrackingKey(req, userId) {
    const fingerprint = generateFingerprint(req);

    // If userId is provided, combine with fingerprint for extra security
    if (userId) {
        return `${fingerprint}:${userId.slice(0, 16)}`;
    }

    return fingerprint;
}

/**
 * Check if request shows suspicious behavior
 * Returns { suspicious: boolean, reason: string }
 */
export async function checkSuspiciousBehavior(req, claimedUserId) {
    const fingerprint = generateFingerprint(req);
    const ip = getClientIP(req);

    // Check 1: Same fingerprint claiming many different userIds (account switching abuse)
    if (isRedisAvailable() && claimedUserId) {
        const fpUsersKey = `${FINGERPRINT_USERS_PREFIX}${fingerprint}`;

        // Add this userId to the set of userIds from this fingerprint
        await redis.sadd(fpUsersKey, claimedUserId);
        await redis.expire(fpUsersKey, 86400); // 24 hour TTL

        // Count how many different userIds this fingerprint has claimed
        const userCount = await redis.scard(fpUsersKey);

        if (userCount > 5) {
            // Same device claiming more than 5 different user IDs in 24h = suspicious
            console.warn(`⚠️ ABUSE: Fingerprint ${fingerprint.slice(0, 12)} claimed ${userCount} different userIds`);

            // Mark as suspicious
            await redis.setex(`${SUSPICIOUS_KEY_PREFIX}${fingerprint}`, 3600, 'multi_account');

            return { suspicious: true, reason: 'multi_account', userCount };
        }
    }

    // Check 2: Known suspicious fingerprint
    if (isRedisAvailable()) {
        const suspiciousReason = await redis.get(`${SUSPICIOUS_KEY_PREFIX}${fingerprint}`);
        if (suspiciousReason) {
            return { suspicious: true, reason: suspiciousReason, blocked: true };
        }
    }

    // Check 3: Missing critical headers (likely a script/bot)
    const userAgent = req.headers['user-agent'] || '';
    if (!userAgent || userAgent.length < 20) {
        return { suspicious: true, reason: 'missing_ua' };
    }

    // Check 4: Known bot/scraper user agents
    const botPatterns = [
        /curl/i, /wget/i, /python/i, /scrapy/i, /httpclient/i,
        /bot/i, /spider/i, /crawl/i, /libwww/i, /java\//i
    ];

    if (botPatterns.some(pattern => pattern.test(userAgent))) {
        console.warn(`⚠️ BOT: Detected bot user-agent from ${ip}: ${userAgent.slice(0, 50)}`);
        return { suspicious: true, reason: 'bot_ua' };
    }

    return { suspicious: false };
}

/**
 * Mark a fingerprint as suspicious (call when abuse detected)
 */
export async function markSuspicious(req, reason, duration = 3600) {
    const fingerprint = generateFingerprint(req);

    if (isRedisAvailable()) {
        await redis.setex(`${SUSPICIOUS_KEY_PREFIX}${fingerprint}`, duration, reason);
        console.warn(`🚫 Marked fingerprint ${fingerprint.slice(0, 12)} as suspicious: ${reason}`);
    }
}

/**
 * Legacy: Check if two fingerprints are suspiciously similar
 */
export function isSuspiciousRequest(req, claimedUserId, storedFingerprint) {
    const currentFingerprint = generateFingerprint(req);
    return currentFingerprint === storedFingerprint && claimedUserId !== storedFingerprint;
}

