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

// Rate limiters
const joinLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10, // 10 joins per minute
    message: { error: 'Too many requests. Please wait.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const pollLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 30, // 30 polls per 10 seconds (polling every 2s = 5 per 10s, with room for retries)
    message: { error: 'Too many requests.' },
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
            return res.status(400).json({ error: 'userId is required' });
        }

        if (score === undefined || typeof score !== 'number' || score < 0 || score > 100) {
            return res.status(400).json({ error: 'score must be between 0 and 100' });
        }

        const result = await joinQueue(userId, score, thumb || null, mode || 'nice');
        console.log(`[${requestId}] ✅ User ${userId} joined queue: ${result.status}`);

        return res.status(200).json(result);

    } catch (error) {
        console.error(`[${requestId}] Error joining queue:`, error.message);
        return res.status(500).json({ error: 'Failed to join queue' });
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
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await pollForMatch(userId);

        // Only log matches, not every poll
        if (result.status === 'matched') {
            console.log(`[${requestId}] 🎯 Match found for ${userId}: ${result.battleId}`);
        }

        return res.status(200).json(result);

    } catch (error) {
        console.error(`[${requestId}] Error polling:`, error.message);
        return res.status(500).json({ error: 'Failed to poll for match' });
    }
});

/**
 * POST /api/arena/leave
 * Leave the queue
 */
router.post('/leave', async (req, res) => {
    const requestId = `arena_leave_${Date.now()}`;

    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await leaveQueue(userId);
        console.log(`[${requestId}] User ${userId} left queue`);

        return res.status(200).json(result);

    } catch (error) {
        console.error(`[${requestId}] Error leaving queue:`, error.message);
        return res.status(500).json({ error: 'Failed to leave queue' });
    }
});

/**
 * GET /api/arena/stats
 * Get queue statistics (online count, matches today)
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await getQueueStats();
        return res.status(200).json(stats);
    } catch (error) {
        console.error('Error getting arena stats:', error.message);
        return res.status(500).json({ error: 'Failed to get stats' });
    }
});

export default router;
