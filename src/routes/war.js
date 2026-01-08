/**
 * Fashion Wars Routes
 * API endpoints for global alliance competition
 * 
 * Endpoints:
 * - POST /api/war/join         - Join an alliance
 * - POST /api/war/contribute   - Record score contribution
 * - GET  /api/war/standings    - Get current standings
 * - GET  /api/war/daily/:date  - Get daily battle results
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    joinAlliance,
    getUserAlliance,
    recordContribution,
    getStandings,
    getDailyResults,
    ALLIANCES
} from '../services/warService.js';

const router = express.Router();

// Rate limiters
const joinLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5, // 5 join attempts per minute
    message: { error: 'Too many requests. Please wait a moment.' }
});

const contributeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // 30 contributions per minute (generous for rapid scans)
    message: { error: 'Too many requests. Please wait a moment.' }
});

const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60, // 60 reads per minute
    message: { error: 'Too many requests. Please wait a moment.' }
});

/**
 * POST /api/war/join
 * Join an alliance (locked for current war season)
 */
router.post('/join', joinLimiter, async (req, res) => {
    const requestId = `war_join_${Date.now()}`;

    try {
        const { userId, allianceId } = req.body;

        console.log(`[${requestId}] POST /api/war/join - userId: ${userId?.slice(0, 12)}..., alliance: ${allianceId}`);

        // Validate inputs
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (!allianceId || !ALLIANCES.includes(allianceId)) {
            return res.status(400).json({
                error: 'Invalid allianceId',
                validAlliances: ALLIANCES
            });
        }

        // Check if already in alliance
        const existing = await getUserAlliance(userId);
        if (existing) {
            console.log(`[${requestId}] User already in alliance: ${existing.allianceId}`);
            return res.status(200).json({
                success: true,
                message: 'Already in alliance',
                alliance: existing.allianceId,
                warId: existing.warId,
                joinedAt: existing.joinedAt
            });
        }

        // Join alliance
        const result = await joinAlliance(userId, allianceId);

        console.log(`[${requestId}] ✅ Joined alliance: ${allianceId}`);
        return res.status(200).json({
            success: true,
            alliance: result.allianceId,
            warId: result.warId,
            joinedAt: result.joinedAt
        });

    } catch (error) {
        console.error(`[${requestId}] Error:`, error.message);

        if (error.message === 'Already joined an alliance this war') {
            return res.status(409).json({ error: error.message });
        }

        return res.status(500).json({ error: 'Failed to join alliance' });
    }
});

/**
 * POST /api/war/contribute
 * Record a score contribution to user's alliance
 */
router.post('/contribute', contributeLimiter, async (req, res) => {
    const requestId = `war_contrib_${Date.now()}`;

    try {
        const { userId, allianceId, score, mode } = req.body;

        console.log(`[${requestId}] POST /api/war/contribute - userId: ${userId?.slice(0, 12)}..., score: ${score}`);

        // Validate inputs
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (!allianceId || !ALLIANCES.includes(allianceId)) {
            return res.status(400).json({ error: 'Invalid allianceId' });
        }

        if (typeof score !== 'number' || score < 0 || score > 100) {
            return res.status(400).json({ error: 'Score must be between 0 and 100' });
        }

        // Verify user is in this alliance
        const membership = await getUserAlliance(userId);
        if (!membership) {
            return res.status(400).json({ error: 'User has not joined an alliance' });
        }

        if (membership.allianceId !== allianceId) {
            return res.status(400).json({
                error: 'User is in a different alliance',
                userAlliance: membership.allianceId
            });
        }

        // Record contribution
        const result = await recordContribution(userId, allianceId, Math.round(score), mode);

        console.log(`[${requestId}] ✅ Contribution recorded: +${result.contribution}pts (total today: ${result.totalToday})`);
        return res.status(200).json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error(`[${requestId}] Error:`, error.message);
        return res.status(500).json({ error: 'Failed to record contribution' });
    }
});

/**
 * GET /api/war/standings
 * Get current war status, daily battles, and season standings
 */
router.get('/standings', readLimiter, async (req, res) => {
    const requestId = `war_standings_${Date.now()}`;

    try {
        const { userId } = req.query;

        console.log(`[${requestId}] GET /api/war/standings - userId: ${userId?.slice(0, 12) || 'none'}...`);

        const standings = await getStandings(userId || null);

        console.log(`[${requestId}] ✅ Standings returned - day ${standings.dayNumber}/${standings.totalDays}`);
        return res.status(200).json(standings);

    } catch (error) {
        console.error(`[${requestId}] Error:`, error.message);
        return res.status(500).json({ error: 'Failed to get standings' });
    }
});

/**
 * GET /api/war/daily/:date
 * Get results for a specific day's battles
 */
router.get('/daily/:date', readLimiter, async (req, res) => {
    const requestId = `war_daily_${Date.now()}`;

    try {
        const { date } = req.params;

        // Validate date format (YYYY-MM-DD)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }

        console.log(`[${requestId}] GET /api/war/daily/${date}`);

        const results = await getDailyResults(date);

        if (!results) {
            return res.status(404).json({ error: 'No results for this date' });
        }

        console.log(`[${requestId}] ✅ Daily results returned for ${date}`);
        return res.status(200).json({
            date,
            battles: results
        });

    } catch (error) {
        console.error(`[${requestId}] Error:`, error.message);
        return res.status(500).json({ error: 'Failed to get daily results' });
    }
});

/**
 * GET /api/war/alliance/:userId
 * Get user's current alliance
 */
router.get('/alliance/:userId', readLimiter, async (req, res) => {
    const requestId = `war_alliance_${Date.now()}`;

    try {
        const { userId } = req.params;

        console.log(`[${requestId}] GET /api/war/alliance/${userId.slice(0, 12)}...`);

        const membership = await getUserAlliance(userId);

        if (!membership) {
            return res.status(200).json({ alliance: null });
        }

        console.log(`[${requestId}] ✅ Found alliance: ${membership.allianceId}`);
        return res.status(200).json({
            alliance: membership.allianceId,
            warId: membership.warId,
            joinedAt: membership.joinedAt
        });

    } catch (error) {
        console.error(`[${requestId}] Error:`, error.message);
        return res.status(500).json({ error: 'Failed to get user alliance' });
    }
});

export default router;
