import express from 'express';
import { isProEmail, addProEmail } from '../middleware/proEmailStore.js';
import { setProStatus } from '../middleware/scanLimiter.js';

const router = express.Router();

/**
 * Check if an email has Pro status
 * POST /api/pro/check
 * Body: { email: "user@example.com" }
 */
router.post('/check', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            error: 'Email required'
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
 */
router.post('/add', async (req, res) => {
    // Block in production unless DEV_API_KEY is provided and matches
    const devKey = req.headers['x-dev-key'] || req.body?.devKey;
    const expectedKey = process.env.DEV_API_KEY;

    if (process.env.NODE_ENV === 'production' && !expectedKey) {
        return res.status(403).json({ error: 'Not allowed in production' });
    }

    if (expectedKey && devKey !== expectedKey) {
        return res.status(401).json({ error: 'Invalid dev key' });
    }

    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    await addProEmail(email);
    res.json({ success: true, email });
});

export default router;
