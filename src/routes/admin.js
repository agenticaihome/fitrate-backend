import express from 'express';
import { redis, isRedisAvailable } from '../services/redisClient.js';
import { ensureCurrentEvent, getWeekId } from '../services/eventService.js';

const router = express.Router();

// ADMIN: Reset event cache (force theme recalculation)
// URL: /api/admin/reset-event?key=YOUR_ADMIN_KEY
router.post('/reset-event', async (req, res) => {
    const { key } = req.query;

    // Require admin key
    if (!key || key !== process.env.ADMIN_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        if (!isRedisAvailable()) {
            return res.status(500).json({ error: 'Redis not available' });
        }

        // Get current state for logging
        const currentEventJson = await redis.get('fitrate:event:current');
        const currentEvent = currentEventJson ? JSON.parse(currentEventJson) : null;

        // Delete the current event key
        await redis.del('fitrate:event:current');

        // Force regeneration of event
        const newEvent = await ensureCurrentEvent();
        const currentWeekId = getWeekId();

        return res.json({
            success: true,
            message: 'Event cache reset successfully',
            before: currentEvent ? { weekId: currentEvent.weekId, theme: currentEvent.theme } : null,
            after: { weekId: newEvent.weekId, theme: newEvent.theme },
            currentWeekId,
            note: 'Theme recalculated based on current week'
        });
    } catch (error) {
        console.error('Reset event error:', error);
        return res.status(500).json({ error: 'Failed to reset event' });
    }
});

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
