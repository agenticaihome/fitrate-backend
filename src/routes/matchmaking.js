/**
 * Matchmaking Routes - Global Arena
 * 
 * Endpoints for real-time global matchmaking
 * 
 * POST /api/arena/join   - Join queue with score + photo
 * GET  /api/arena/poll   - Poll for match status
 * POST /api/arena/leave  - Leave queue
 * GET  /api/arena/stats  - Get online count
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { joinQueue, pollForMatch, leaveQueue, getQueueStats } from '../services/matchmakingService.js';

const router = express.Router();

// Rate limiters (per spec)
const joinLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5, // 5 joins per minute per user
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests. Please wait.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const pollLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60, // 60 polls per minute per user (polling every 2s = 30 per minute typical)
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const statsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // 30 per minute per IP
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const leaveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10, // 10 per minute per user
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * POST /api/arena/join
 * Join the matchmaking queue
 */
router.post('/join', joinLimiter, async (req, res) => {
    const requestId = `arena_join_${Date.now()}`;

    try {
        console.log(`[${requestId}] POST /api/arena/join`);
        const { userId, score, thumb, mode } = req.body;

        // Validate required fields
        if (!userId || typeof userId !== 'string') {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        if (score === undefined || typeof score !== 'number' || score < 0 || score > 100) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_SCORE',
                message: 'Score must be between 0 and 100'
            });
        }

        const result = await joinQueue(userId, score, thumb || null, mode || 'nice');
        console.log(`[${requestId}] ✅ User ${userId} joined queue: ${result.status}`);

        return res.status(200).json(result);

    } catch (error) {
        console.error(`[${requestId}] Error joining queue:`, error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to join queue'
        });
    }
});

/**
 * GET /api/arena/poll
 * Poll for match status
 */
router.get('/poll', pollLimiter, async (req, res) => {
    const requestId = `arena_poll_${Date.now()}`;

    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        const result = await pollForMatch(userId);

        // Only log matches, not every poll
        if (result.status === 'matched') {
            console.log(`[${requestId}] 🎯 Match found for ${userId}: ${result.battleId}`);
        }

        return res.status(200).json(result);

    } catch (error) {
        console.error(`[${requestId}] Error polling:`, error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to poll for match'
        });
    }
});

/**
 * POST /api/arena/leave
 * Leave the queue
 */
router.post('/leave', leaveLimiter, async (req, res) => {
    const requestId = `arena_leave_${Date.now()}`;

    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        const result = await leaveQueue(userId);
        console.log(`[${requestId}] User ${userId} left queue`);

        return res.status(200).json(result);

    } catch (error) {
        console.error(`[${requestId}] Error leaving queue:`, error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to leave queue'
        });
    }
});

/**
 * GET /api/arena/stats
 * Get queue statistics (online count, battles today, avg wait time)
 */
router.get('/stats', statsLimiter, async (req, res) => {
    try {
        const stats = await getQueueStats();
        // Add cache headers for 5 seconds
        res.set('Cache-Control', 'public, max-age=5');
        return res.status(200).json(stats);
    } catch (error) {
        console.error('Error getting arena stats:', error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to get stats'
        });
    }
});

// ============================================
// LEADERBOARD & PROFILE ENDPOINTS
// ============================================

import {
    getWeeklyLeaderboard,
    getUserProfile,
    setUserProfile,
    recordArenaScore
} from '../services/arenaLeaderboardService.js';

const profileLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10, // 10 per minute per user
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const leaderboardLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // 30 per minute per IP
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * GET /api/arena/leaderboard
 * Get weekly arena leaderboard (top 50 + user's rank)
 */
router.get('/leaderboard', leaderboardLimiter, async (req, res) => {
    try {
        const { userId } = req.query;

        // Cache for 60 seconds
        res.set('Cache-Control', 'public, max-age=60');

        const result = await getWeeklyLeaderboard(userId, 50);
        return res.status(200).json(result);

    } catch (error) {
        console.error('Error getting arena leaderboard:', error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to get leaderboard'
        });
    }
});

/**
 * GET /api/arena/profile
 * Get user's display name and profile
 */
router.get('/profile', profileLimiter, async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        const profile = await getUserProfile(userId);
        return res.status(200).json({ success: true, ...profile });

    } catch (error) {
        console.error('Error getting profile:', error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to get profile'
        });
    }
});

/**
 * POST /api/arena/profile
 * Set user's display name
 */
router.post('/profile', profileLimiter, async (req, res) => {
    try {
        const { userId, displayName } = req.body;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        if (!displayName || typeof displayName !== 'string') {
            return res.status(400).json({
                error: true,
                code: 'INVALID_DISPLAY_NAME',
                message: 'displayName is required'
            });
        }

        // Validate display name
        const cleaned = displayName.replace(/<[^>]*>/g, '').trim();
        if (cleaned.length < 3 || cleaned.length > 15) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_DISPLAY_NAME',
                message: 'Display name must be 3-15 characters'
            });
        }

        const result = await setUserProfile(userId, cleaned);
        console.log(`[ARENA] User ${userId.slice(0, 8)} set display name: ${cleaned}`);
        return res.status(200).json({ success: true, ...result });

    } catch (error) {
        console.error('Error setting profile:', error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to set profile'
        });
    }
});

export default router;
