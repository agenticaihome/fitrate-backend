/**
 * Streak Routes
 * 
 * GET /api/streak/status - Get current streak data
 * POST /api/streak/record - Record a scan (called by analyze after success)
 */

import express from 'express';
import { getStreakData, recordScan, getStreakDisplay, getMilestoneInfo } from '../middleware/streakStore.js';

const router = express.Router();

/**
 * GET /api/streak/status
 * Get current streak info for a user
 */
router.get('/status', async (req, res) => {
    try {
        const userId = req.query.userId;

        if (!userId) {
            return res.status(400).json({ error: 'userId required' });
        }

        const streakData = await getStreakData(userId);
        const display = getStreakDisplay(streakData.currentStreak);

        res.json({
            success: true,
            streak: {
                current: streakData.currentStreak,
                max: streakData.maxStreak,
                total: streakData.totalScans,
                lastScan: streakData.lastScanDate,
                ...display
            }
        });
    } catch (error) {
        console.error('[STREAK] Error getting status:', error);
        res.status(500).json({ error: 'Failed to get streak status' });
    }
});

/**
 * POST /api/streak/record
 * Record a successful scan (internal use)
 * This is also called automatically from analyze route
 */
router.post('/record', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId required' });
        }

        const result = await recordScan(userId);
        const display = getStreakDisplay(result.currentStreak);
        const milestone = result.isMilestone ? getMilestoneInfo(result.currentStreak) : null;

        res.json({
            success: true,
            streak: {
                current: result.currentStreak,
                max: result.maxStreak,
                total: result.totalScans,
                lastScan: result.lastScanDate,
                isNewStreak: result.isNewStreak,
                isMilestone: result.isMilestone,
                milestone,
                ...display
            }
        });
    } catch (error) {
        console.error('[STREAK] Error recording:', error);
        res.status(500).json({ error: 'Failed to record streak' });
    }
});

export default router;
