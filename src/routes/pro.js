import express from 'express';
import { isProEmail, addProEmail } from '../middleware/proEmailStore.js';
import { setProStatus } from '../middleware/scanLimiter.js';

const router = express.Router();

/**
 * Check if an email has Pro status
 * POST /api/pro/check
 * Body: { email: "user@example.com" }
 */
router.post('/check', (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            error: 'Email required'
        });
    }

    const isPro = isProEmail(email);

    // Also set Pro status for this IP so rate limiter knows
    if (isPro) {
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        setProStatus(ip, true);
    }

    res.json({
        success: true,
        email: email.toLowerCase().trim(),
        isPro
    });
});

/**
 * Dev only: manually add a Pro email (remove in production)
 * POST /api/pro/add
 */
router.post('/add', (req, res) => {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Not allowed in production' });
    }

    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    addProEmail(email);
    res.json({ success: true, email });
});

export default router;
