/**
 * Wardrobe Routes - Wardrobe Wars
 *
 * POST /api/wardrobe/save     - Save user's 5-outfit wardrobe
 * GET  /api/wardrobe/get      - Get user's wardrobe
 * POST /api/wardrobe/join     - Join matchmaking queue
 * GET  /api/wardrobe/poll     - Poll for match status
 * POST /api/wardrobe/leave    - Leave queue
 * GET  /api/wardrobe/stats    - Get queue statistics
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    saveWardrobe,
    getWardrobe,
    joinWardrobeQueue,
    pollWardrobeMatch,
    leaveWardrobeQueue,
    getWardrobeStats
} from '../services/wardrobeService.js';
import { recordAction } from '../services/dailyLimitsService.js';
import { FREE_TIER_LIMITS } from '../config/systemPrompt.js';

const router = express.Router();

// Rate limiters
const saveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many wardrobe saves. Please wait.' }
});

const joinLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests. Please wait.' }
});

const pollLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests.' }
});

const statsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests.' }
});

/**
 * POST /api/wardrobe/save
 * Save user's wardrobe (5 outfits)
 */
router.post('/save', saveLimiter, async (req, res) => {
    const requestId = `wardrobe_save_${Date.now()}`;

    try {
        const { userId, outfits, displayName } = req.body;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        if (!outfits || !Array.isArray(outfits)) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_OUTFITS',
                message: 'outfits array is required'
            });
        }

        const result = await saveWardrobe(userId, outfits, displayName);

        if (!result.success) {
            return res.status(400).json({
                error: true,
                code: 'INSUFFICIENT_OUTFITS',
                message: result.message
            });
        }

        console.log(`[${requestId}] ✅ Wardrobe saved for ${userId.slice(0, 12)}: ${result.outfitCount} outfits`);
        return res.status(200).json(result);

    } catch (error) {
        console.error(`[${requestId}] Error saving wardrobe:`, error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to save wardrobe'
        });
    }
});

/**
 * GET /api/wardrobe/get
 * Get user's wardrobe
 */
router.get('/get', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        const wardrobe = await getWardrobe(userId);

        if (!wardrobe) {
            return res.status(200).json({
                success: true,
                hasWardrobe: false,
                outfits: []
            });
        }

        return res.status(200).json({
            success: true,
            hasWardrobe: true,
            ...wardrobe
        });

    } catch (error) {
        console.error('Error getting wardrobe:', error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to get wardrobe'
        });
    }
});

/**
 * POST /api/wardrobe/join
 * Join Wardrobe Wars matchmaking queue
 */
router.post('/join', joinLimiter, async (req, res) => {
    const requestId = `wardrobe_join_${Date.now()}`;

    try {
        const { userId, displayName } = req.body;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        // Check daily wardrobe battle limit for free users
        const limitCheck = await recordAction('wardrobe', userId);
        if (!limitCheck.allowed) {
            console.log(`[${requestId}] ⛔ User ${userId.slice(0, 12)} hit wardrobe daily limit: ${limitCheck.used}/${limitCheck.limit}`);
            return res.status(403).json({
                error: true,
                code: 'DAILY_LIMIT_REACHED',
                message: `You've used your ${FREE_TIER_LIMITS.WARDROBE_BATTLES_DAILY} free Wardrobe War today. Upgrade to Pro for unlimited battles!`,
                used: limitCheck.used,
                limit: limitCheck.limit,
                isPro: false
            });
        }

        const result = await joinWardrobeQueue(userId, displayName);

        if (result.status === 'error') {
            return res.status(400).json({
                error: true,
                code: 'QUEUE_ERROR',
                message: result.message
            });
        }

        // Include limit info in response
        result.dailyLimits = {
            wardrobe: {
                used: limitCheck.used,
                limit: limitCheck.isPro ? 'unlimited' : limitCheck.limit,
                remaining: limitCheck.isPro ? 'unlimited' : limitCheck.remaining
            }
        };

        console.log(`[${requestId}] User ${userId.slice(0, 12)} joined Wardrobe Wars queue: ${result.status} (battles: ${limitCheck.used}/${limitCheck.limit})`);
        return res.status(200).json(result);

    } catch (error) {
        console.error(`[${requestId}] Error joining wardrobe queue:`, error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to join queue'
        });
    }
});

/**
 * GET /api/wardrobe/poll
 * Poll for match status
 */
router.get('/poll', pollLimiter, async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        const result = await pollWardrobeMatch(userId);
        return res.status(200).json(result);

    } catch (error) {
        console.error('Error polling wardrobe match:', error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to poll for match'
        });
    }
});

/**
 * POST /api/wardrobe/leave
 * Leave the queue
 */
router.post('/leave', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        const result = await leaveWardrobeQueue(userId);
        return res.status(200).json(result);

    } catch (error) {
        console.error('Error leaving wardrobe queue:', error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to leave queue'
        });
    }
});

/**
 * GET /api/wardrobe/stats
 * Get queue statistics
 */
router.get('/stats', statsLimiter, async (req, res) => {
    try {
        res.set('Cache-Control', 'public, max-age=10');
        const stats = await getWardrobeStats();
        return res.status(200).json(stats);
    } catch (error) {
        console.error('Error getting wardrobe stats:', error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to get stats'
        });
    }
});

export default router;
