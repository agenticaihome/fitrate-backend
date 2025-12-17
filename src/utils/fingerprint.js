/**
 * Device Fingerprint Generator
 * Creates a stable fingerprint from request headers to prevent userId spoofing
 * Used for rate limiting and abuse prevention
 */

import crypto from 'crypto';

/**
 * Generate a device fingerprint from request headers
 * Combines IP + User-Agent + Accept-Language + other stable headers
 */
export function generateFingerprint(req) {
    const ip = getClientIP(req);
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';
    const acceptEncoding = req.headers['accept-encoding'] || '';

    // Create a stable hash from these values
    const raw = `${ip}|${userAgent}|${acceptLanguage}|${acceptEncoding}`;

    return crypto.createHash('sha256')
        .update(raw)
        .digest('hex')
        .slice(0, 24); // 24 char fingerprint
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
 * Check if two fingerprints are suspiciously similar
 * (Same device claiming to be different users)
 */
export function isSuspiciousRequest(req, claimedUserId, storedFingerprint) {
    const currentFingerprint = generateFingerprint(req);
    return currentFingerprint === storedFingerprint && claimedUserId !== storedFingerprint;
}
