import express from 'express';
import rateLimit from 'express-rate-limit';
import { isProEmail, addProEmail } from '../middleware/proEmailStore.js';
import { setProStatus } from '../middleware/scanLimiter.js';

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
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            error: 'Email required'
        });
    }

    // SECURITY: Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid email format'
        });
    }

    const isPro = await isProEmail(email);

    // Also set Pro status for this IP/userId so rate limiter knows
    if (isPro) {
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const userId = req.body?.userId || req.query?.userId;
        await setProStatus(userId, ip, true);
    }

    res.json({
        success: true,
        email: email.toLowerCase().trim(),
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

    await addProEmail(email);
    res.json({ success: true, email: email.toLowerCase().trim() });
});

export default router;
