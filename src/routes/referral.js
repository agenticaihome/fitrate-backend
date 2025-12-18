import express from 'express';
import { addReferral, getReferralStats, getPurchasedScans } from '../middleware/referralStore.js';
import { generateFingerprint } from '../utils/fingerprint.js';

const router = express.Router();

/**
 * Claim a referral (User B arrives via link)
 * POST /api/referral/claim
 * Body: { referrerId: "...", userId: "..." }
 * SECURITY: Uses fingerprint to prevent VPN abuse
 */
router.post('/claim', async (req, res) => {
    const { referrerId, userId } = req.body;
    const fingerprint = generateFingerprint(req);

    if (!referrerId) {
        return res.status(400).json({ success: false, error: 'Referrer ID required' });
    }

    const result = await addReferral(referrerId, fingerprint, userId);

    res.json({
        success: result.success,
        newReferral: result.success,
        message: result.success
            ? 'Referral counted!'
            : result.reason === 'self_referral'
                ? 'Nice try! You can\'t refer yourself 😉'
                : 'Referral already counted or invalid'
    });
});

/**
 * Get stats for a user (Bonus scans + purchased scans)
 * GET /api/referral/stats?userId=...
 */
router.get('/stats', async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID required' });
    }

    const [stats, purchasedScans] = await Promise.all([
        getReferralStats(userId),
        getPurchasedScans(userId)
    ]);

    res.json({
        success: true,
        ...stats,
        purchasedScans // Add purchased scans to response
    });
});

export default router;
