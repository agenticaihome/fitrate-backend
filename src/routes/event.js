/**
 * Event Routes
 * API endpoints for Weekly Event Mode + Leaderboard
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    getActiveEvent,
    getUpcomingEvent,
    getAllThemes,
    getLeaderboard,
    getUserEventStatus,
    getArchivedEvent,
    getWeekId,
    canFreeUserSubmit,
    canProUserSubmit
} from '../services/eventService.js';
import { getProStatus } from '../middleware/scanLimiter.js';
import { castVote, getVotingStatus, getVotableEntries } from '../services/challengeVotingService.js';

const router = express.Router();

// Rate limiter for event endpoints
const eventLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: { success: false, error: 'Too many requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * GET /api/event
 * Get current active event info
 */
router.get('/', eventLimiter, async (req, res) => {
    try {
        const event = await getActiveEvent();
        const upcoming = getUpcomingEvent();

        res.json({
            success: true,
            event: {
                weekId: event.weekId,
                theme: event.theme,
                themeDescription: event.themeDescription,
                themeEmoji: event.themeEmoji,
                startDate: event.startDate,
                endDate: event.endDate,
                totalParticipants: event.totalParticipants || 0
            },
            upcoming: {
                weekId: upcoming.weekId,
                theme: upcoming.theme,
                themeDescription: upcoming.themeDescription,
                themeEmoji: upcoming.themeEmoji,
                startDate: upcoming.startDate,
                startsIn: upcoming.startsIn
            }
        });
    } catch (error) {
        console.error('Error getting active event:', error);
        res.status(500).json({ success: false, error: 'Failed to get event info' });
    }
});

/**
 * GET /api/event/upcoming
 * Get next week's event for preview (creates anticipation!)
 */
router.get('/upcoming', eventLimiter, (req, res) => {
    try {
        const upcoming = getUpcomingEvent();

        res.json({
            success: true,
            upcoming
        });
    } catch (error) {
        console.error('Error getting upcoming event:', error);
        res.status(500).json({ success: false, error: 'Failed to get upcoming event' });
    }
});

/**
 * GET /api/event/themes
 * Get all available themes (for admin/preview)
 */
router.get('/themes', eventLimiter, (req, res) => {
    try {
        const themes = getAllThemes();

        res.json({
            success: true,
            themes,
            totalThemes: themes.length
        });
    } catch (error) {
        console.error('Error getting themes:', error);
        res.status(500).json({ success: false, error: 'Failed to get themes' });
    }
});

/**
 * GET /api/event/leaderboard
 * Get Top 5 leaderboard for current event
 */
router.get('/leaderboard', eventLimiter, async (req, res) => {
    try {
        const event = await getActiveEvent();
        const leaderboard = await getLeaderboard(event.weekId, 5);

        res.json({
            success: true,
            event: {
                weekId: event.weekId,
                theme: event.theme,
                themeEmoji: event.themeEmoji,
                endsAt: event.endDate
            },
            leaderboard,
            totalParticipants: event.totalParticipants || 0
        });
    } catch (error) {
        console.error('Error getting leaderboard:', error);
        res.status(500).json({ success: false, error: 'Failed to get leaderboard' });
    }
});

/**
 * GET /api/event/status
 * Get user's event status (rank, score, entries used/remaining)
 * Query params: userId (required)
 */
router.get('/status', eventLimiter, async (req, res) => {
    try {
        const { userId } = req.query;
        const ip = req.ip || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || 'unknown';

        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId required' });
        }

        const event = await getActiveEvent();
        const status = await getUserEventStatus(event.weekId, userId);

        // Get Pro status and entry limits
        const isPro = await getProStatus(userId, ip);
        let entryStatus;

        if (isPro) {
            entryStatus = await canProUserSubmit(userId);
        } else {
            entryStatus = await canFreeUserSubmit(userId);
        }

        res.json({
            success: true,
            weekId: event.weekId,
            theme: event.theme,
            ...status,
            // Entry limit info
            entriesUsed: entryStatus.entriesUsed,
            entriesRemaining: entryStatus.entriesRemaining,
            maxEntries: entryStatus.entriesLimit,
            canSubmit: entryStatus.canSubmit,
            isPro
        });
    } catch (error) {
        console.error('Error getting user event status:', error);
        res.status(500).json({ success: false, error: 'Failed to get status' });
    }
});

/**
 * GET /api/event/archive/:weekId
 * Get archived leaderboard from a past week
 * Only available to Pro users (checked in frontend)
 */
router.get('/archive/:weekId', eventLimiter, async (req, res) => {
    try {
        const { weekId } = req.params;

        // Validate weekId format (YYYY-Www)
        if (!/^\d{4}-W\d{2}$/.test(weekId)) {
            return res.status(400).json({ success: false, error: 'Invalid weekId format' });
        }

        const archive = await getArchivedEvent(weekId);

        if (!archive) {
            return res.status(404).json({ success: false, error: 'Archive not found' });
        }

        res.json({
            success: true,
            archive
        });
    } catch (error) {
        console.error('Error getting archived event:', error);
        res.status(500).json({ success: false, error: 'Failed to get archive' });
    }
});

/**
 * GET /api/event/stats
 * Get participation statistics for the current event
 * Used to measure if Weekly Challenge should be kept (Founders Council mandate)
 * Query params: adminKey (required)
 */
router.get('/stats', async (req, res) => {
    try {
        const { adminKey } = req.query;

        // Admin key check
        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const event = await getActiveEvent();
        const leaderboard = await getLeaderboard(event.weekId, 100); // Get all participants

        // Calculate stats
        const totalParticipants = leaderboard.length;
        const avgScore = totalParticipants > 0
            ? Math.round(leaderboard.reduce((sum, p) => sum + p.score, 0) / totalParticipants)
            : 0;
        const topScore = totalParticipants > 0 ? leaderboard[0]?.score || 0 : 0;

        res.json({
            success: true,
            weekId: event.weekId,
            theme: event.theme,
            stats: {
                totalParticipants,
                avgScore,
                topScore,
                endsAt: event.endDate
            },
            // Founders Council mandate: if participation < 5% of active users, consider killing feature
            recommendation: totalParticipants < 50
                ? '⚠️ Low participation - consider reviewing feature'
                : '✅ Healthy participation'
        });
    } catch (error) {
        console.error('Error getting event stats:', error);
        res.status(500).json({ success: false, error: 'Failed to get stats' });
    }
});

// =====================================================
// VOTING ENDPOINTS - "Judge Others, Get Judged"
// =====================================================

/**
 * POST /api/event/vote
 * Cast a 🔥 Fire vote on an entry
 * Body: { voterId, entryId, type: 'daily' | 'weekly' }
 */
router.post('/vote', eventLimiter, async (req, res) => {
    try {
        const { voterId, entryId, type = 'daily' } = req.body;

        if (!voterId || !entryId) {
            return res.status(400).json({
                success: false,
                error: 'voterId and entryId required'
            });
        }

        const result = await castVote(voterId, entryId, type);

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (error) {
        console.error('Error casting vote:', error);
        res.status(500).json({ success: false, error: 'Failed to cast vote' });
    }
});

/**
 * GET /api/event/vote/status
 * Get user's voting status (votes remaining, entries voted for)
 * Query: userId, type
 */
router.get('/vote/status', eventLimiter, async (req, res) => {
    try {
        const { userId, type = 'daily' } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId required'
            });
        }

        const status = await getVotingStatus(userId, type);
        res.json({ success: true, ...status });
    } catch (error) {
        console.error('Error getting vote status:', error);
        res.status(500).json({ success: false, error: 'Failed to get vote status' });
    }
});

/**
 * GET /api/event/vote/entries
 * Get entries available to vote on (randomized, excludes own + already voted)
 * Query: userId, type, limit
 */
router.get('/vote/entries', eventLimiter, async (req, res) => {
    try {
        const { userId, type = 'daily', limit = 5 } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId required'
            });
        }

        const result = await getVotableEntries(userId, type, parseInt(limit));
        res.json(result);
    } catch (error) {
        console.error('Error getting votable entries:', error);
        res.status(500).json({ success: false, error: 'Failed to get entries' });
    }
});

export default router;
