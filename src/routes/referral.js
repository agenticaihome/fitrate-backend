import express from 'express';
import { addReferral, getReferralStats } from '../middleware/referralStore.js';

const router = express.Router();

/**
 * Claim a referral (User B arrives via link)
 * POST /api/referral/claim
 * Body: { referrerId: "..." }
 */
router.post('/claim', async (req, res) => {
    const { referrerId } = req.body;
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    if (!referrerId) {
        return res.status(400).json({ success: false, error: 'Referrer ID required' });
    }

    const success = await addReferral(referrerId, ip);

    res.json({
        success: true,
        newReferral: success,
        message: success ? 'Referral counted!' : 'Referral already counted or invalid'
    });
});

/**
 * Get stats for a user (Bonus scans)
 * GET /api/referral/stats?userId=...
 */
router.get('/stats', async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID required' });
    }

    const stats = await getReferralStats(userId);
    res.json({
        success: true,
        ...stats
    });
});

export default router;
