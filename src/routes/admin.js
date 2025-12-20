import express from 'express';
import { redis, isRedisAvailable } from '../services/redisClient.js';

const router = express.Router();

// ADMIN: Reset all tracking (for testing/debugging)
// URL: /api/admin/reset-tracking?key=YOUR_ADMIN_KEY
router.post('/reset-tracking', async (req, res) => {
    const { key } = req.query;

    // Require admin key
    if (!key || key !== process.env.ADMIN_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        if (isRedisAvailable()) {
            // Clear Redis keys
            const patterns = [
                'fitrate:scans:*',
                'fitrate:invalid:*',
                'fitrate:banned:*',
                'fitrate:suspicious:*',
                'fitrate:fp:users:*'
            ];

            for (const pattern of patterns) {
                const keys = await redis.keys(pattern);
                if (keys.length > 0) {
                    await redis.del(...keys);
                }
            }

            return res.json({
                success: true,
                message: 'Redis tracking data cleared',
                cleared: 'All scan counts, invalid attempts, and blocks reset'
            });
        } else {
            // Clear in-memory stores (import them dynamically)
            const { scanStoreFallback } = await import('../middleware/scanLimiter.js');
            const { fingerprintStore } = await import('../utils/fingerprint.js');

            scanStoreFallback.clear();
            if (fingerprintStore) fingerprintStore.clear();

            return res.json({
                success: true,
                message: 'In-memory tracking data cleared',
                cleared: 'All scan counts, invalid attempts, and blocks reset'
            });
        }
    } catch (error) {
        console.error('Reset tracking error:', error);
        return res.status(500).json({ error: 'Failed to reset tracking' });
    }
});

export default router;
