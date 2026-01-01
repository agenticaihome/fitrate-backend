import express from 'express';
import rateLimit from 'express-rate-limit';
import { EntitlementService } from '../services/entitlements.js';
import { setProStatus, LIMITS } from '../middleware/scanLimiter.js';
import { redis, isRedisAvailable } from '../services/redisClient.js';
import { getPurchasedScans } from '../middleware/referralStore.js';

const router = express.Router();

// SECURITY: Strict rate limit on pro check to prevent email enumeration
const proCheckLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 requests per minute
    message: { success: false, error: 'Too many requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

// SECURITY: Very strict rate limit on admin endpoint
const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3, // 3 attempts per minute
    message: { success: false, error: 'Too many attempts.' },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Check if an email has Pro status
 * POST /api/pro/check
 * Body: { email: "user@example.com" }
 * SECURITY: Rate limited to prevent enumeration
 */
router.post('/check', proCheckLimiter, async (req, res) => {
    const { email, userId } = req.body;

    if (!email && !userId) {
        return res.status(400).json({
            success: false,
            error: 'Email or userId required'
        });
    }

    // SECURITY: Basic email validation if provided
    if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }
    }

    // Use EntitlementService to check status
    const isPro = await EntitlementService.isPro(userId, email);

    // Also set Pro status for this IP/userId so rate limiter knows (legacy sync)
    if (isPro) {
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        await setProStatus(userId, ip, true);

        // CRITICAL: Ensure this userId is permanently linked to Pro status
        // This allows scanLimiter to verify them independently of email (e.g. after server restart)
        if (userId) {
            await EntitlementService.grantPro(userId, email, 'verification_link');
        }
    }

    res.json({
        success: true,
        email: email ? email.toLowerCase().trim() : undefined,
        isPro
    });
});

/**
 * Dev/Admin: manually add a Pro email (secured with API key)
 * POST /api/pro/add
 * SECURITY: Rate limited, header-only key, blocked in production without key
 */
router.post('/add', adminLimiter, async (req, res) => {
    // SECURITY: Only accept key from header (not body - could be logged)
    const devKey = req.headers['x-dev-key'];
    const expectedKey = process.env.DEV_API_KEY;

    // Block in production if no DEV_API_KEY is configured
    if (process.env.NODE_ENV === 'production' && !expectedKey) {
        return res.status(403).json({ error: 'Not allowed in production' });
    }

    // Require valid key if one is configured
    if (expectedKey && devKey !== expectedKey) {
        return res.status(401).json({ error: 'Invalid dev key' });
    }

    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    // SECURITY: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    await EntitlementService.grantPro(null, email, 'admin_add');
    res.json({ success: true, email: email.toLowerCase().trim() });
});

/**
 * Get server-side scan status (prevents cache bypass)
 * GET /api/pro/scan-status?userId=xxx
 * Returns: { scansUsed, scansLimit, purchasedScans, resetsAt }
 * SECURITY: Returns counts only, no sensitive data
 */
router.get('/scan-status', async (req, res) => {
    const { userId } = req.query;

    if (!userId || userId.length < 16) {
        return res.status(400).json({
            success: false,
            error: 'Valid userId required'
        });
    }

    try {
        // Get today's date for Redis key
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const redisKey = `fitrate:scans:simple:${userId}:${today}`;

        let scansUsed = 0;

        if (isRedisAvailable()) {
            const count = await redis.get(redisKey);
            scansUsed = parseInt(count) || 0;
        }

        // Get purchased scans
        const purchasedScans = await getPurchasedScans(userId);

        // Calculate reset time (midnight UTC)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        res.json({
            success: true,
            scansUsed,
            scansLimit: LIMITS.free, // 2 for free users
            purchasedScans: purchasedScans || 0,
            resetsAt: tomorrow.toISOString(),
            // Derived fields for frontend convenience
            scansRemaining: Math.max(0, LIMITS.free - scansUsed),
            canScan: scansUsed < LIMITS.free || purchasedScans > 0
        });
    } catch (err) {
        console.error('[scan-status] Error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get scan status'
        });
    }
});

export default router;
