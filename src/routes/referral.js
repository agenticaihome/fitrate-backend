import express from 'express';
import { addReferral, getReferralStats, getPurchasedScans, hasUnlockedViaReferrals, trackShare, getShareStats, setReferralNotification, checkReferralNotifications } from '../middleware/referralStore.js';
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

    // If successful, set notification flag for referrer
    if (result.success) {
        await setReferralNotification(referrerId, {
            type: 'referral_claimed',
            timestamp: Date.now(),
            newRoastEarned: result.newRoastEarned,
            totalReferrals: result.totalReferrals,
            sharesUntilNext: result.sharesUntilNext
        });
    }

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
 * Get stats for a user (Bonus scans + purchased scans + unlock status)
 * GET /api/referral/stats?userId=...
 */
router.get('/stats', async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID required' });
    }

    const [stats, purchasedScans, unlockedViaReferrals, shareStats] = await Promise.all([
        getReferralStats(userId),
        getPurchasedScans(userId),
        hasUnlockedViaReferrals(userId),
        getShareStats(userId)
    ]);

    res.json({
        success: true,
        ...stats,
        purchasedScans,
        unlockedViaReferrals, // true if 3+ successful referrals
        referralsNeeded: Math.max(0, 3 - (stats.totalReferrals || 0)), // X more needed
        shareStats // { totalShares, clicks, conversions }
    });
});

/**
 * Track a share event (when user copies/shares their link)
 * POST /api/referral/share
 * Body: { userId: "..." }
 */
router.post('/share', async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID required' });
    }

    await trackShare(userId);
    res.json({ success: true });
});

/**
 * Check for notifications (polling endpoint)
 * GET /api/referral/notifications?userId=...
 * Returns any pending notifications and clears them
 */
router.get('/notifications', async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID required' });
    }

    const notifications = await checkReferralNotifications(userId);
    res.json({
        success: true,
        notifications
    });
});

export default router;
