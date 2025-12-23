/**
 * FitRate Fashion Show Routes
 * 
 * API endpoints for Fashion Show group experiences
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    createShow,
    getShow,
    joinShow,
    getScoreboard,
    recordWalk,
    getActivity,
    getParticipantCount,
    VIBES,
    WALKS_FREE,
    WALKS_PRO
} from '../services/fashionShowService.js';
import { getProStatus } from '../middleware/scanLimiter.js';

const router = express.Router();

// ============================================
// RATE LIMITERS
// ============================================

// Limit show creation to prevent abuse
const createLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 5, // 5 shows per day per IP
    message: { error: 'Too many Fashion Shows created. Try again tomorrow!' }
});

// Moderate limit for join requests
const joinLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 joins per minute
    message: { error: 'Too many requests. Please wait a moment.' }
});

// ============================================
// ENDPOINTS
// ============================================

/**
 * GET /api/show/vibes
 * Get available vibes/modes for Fashion Shows
 */
router.get('/vibes', (req, res) => {
    const vibes = Object.entries(VIBES).map(([key, val]) => ({
        id: key,
        label: val.label,
        proOnly: val.proOnly
    }));
    res.json({ vibes });
});

/**
 * POST /api/show/create
 * Create a new Fashion Show
 */
router.post('/create', createLimiter, async (req, res) => {
    try {
        const { name, vibe, familySafe, durationHours, entriesPerPerson, userId } = req.body;

        // Check Pro status for Pro-only vibes
        if (VIBES[vibe]?.proOnly) {
            const isPro = await getProStatus(userId);
            if (!isPro) {
                return res.status(403).json({
                    error: `${VIBES[vibe].label} mode requires Pro subscription`
                });
            }
        }

        const show = await createShow({
            name,
            vibe: vibe || 'nice',
            familySafe: familySafe !== false, // Default ON
            durationHours: durationHours || 24,
            entriesPerPerson: entriesPerPerson || 1,
            hostId: userId
        });

        res.json({
            success: true,
            ...show
        });
    } catch (error) {
        console.error('[FashionShow] Create error:', error.message);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/show/:showId
 * Get show details including scoreboard
 */
router.get('/:showId', async (req, res) => {
    try {
        const { showId } = req.params;
        const { userId } = req.query;

        const show = await getShow(showId);
        if (!show) {
            return res.status(404).json({ error: 'Fashion Show not found' });
        }

        const scoreboard = await getScoreboard(showId);
        const participantCount = await getParticipantCount(showId);
        const activity = await getActivity(showId, 10);

        // Calculate time remaining
        const expiresAt = new Date(show.expiresAt).getTime();
        const now = Date.now();
        const timeRemaining = Math.max(0, expiresAt - now);

        res.json({
            ...show,
            scoreboard,
            participantCount,
            activity,
            timeRemaining,
            timeRemainingFormatted: formatTimeRemaining(timeRemaining)
        });
    } catch (error) {
        console.error('[FashionShow] Get error:', error.message);
        res.status(500).json({ error: 'Failed to load Fashion Show' });
    }
});

/**
 * POST /api/show/:showId/join
 * Join a Fashion Show
 */
router.post('/:showId/join', joinLimiter, async (req, res) => {
    try {
        const { showId } = req.params;
        const { userId, nickname, emoji } = req.body;

        if (!nickname || nickname.length < 1) {
            return res.status(400).json({ error: 'Nickname is required' });
        }

        const result = await joinShow(
            showId,
            userId || `guest_${Date.now()}`,
            nickname,
            emoji || '😎'
        );

        // Check Pro status for walks allowed
        const isPro = userId ? await getProStatus(userId) : false;

        res.json({
            ...result,
            walksAllowed: isPro ? WALKS_PRO : WALKS_FREE,
            isPro
        });
    } catch (error) {
        console.error('[FashionShow] Join error:', error.message);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/show/:showId/scoreboard
 * Get real-time scoreboard
 */
router.get('/:showId/scoreboard', async (req, res) => {
    try {
        const { showId } = req.params;

        const show = await getShow(showId);
        if (!show) {
            return res.status(404).json({ error: 'Fashion Show not found' });
        }

        const scoreboard = await getScoreboard(showId);
        const activity = await getActivity(showId, 5);

        res.json({
            showId,
            showName: show.name,
            status: show.status,
            scoreboard,
            activity,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error('[FashionShow] Scoreboard error:', error.message);
        res.status(500).json({ error: 'Failed to load scoreboard' });
    }
});

/**
 * GET /api/show/:showId/activity
 * Get activity feed
 */
router.get('/:showId/activity', async (req, res) => {
    try {
        const { showId } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);

        const activity = await getActivity(showId, limit);
        res.json({ activity });
    } catch (error) {
        console.error('[FashionShow] Activity error:', error.message);
        res.status(500).json({ error: 'Failed to load activity' });
    }
});

/**
 * POST /api/show/:showId/walk
 * Record a "walk" (outfit submission) result in the show
 * Called AFTER analyze returns the score
 */
router.post('/:showId/walk', async (req, res) => {
    try {
        const { showId } = req.params;
        const { userId, nickname, emoji, score, verdict, imageThumb } = req.body;

        if (!userId || !nickname || score === undefined) {
            return res.status(400).json({
                error: 'Missing required fields: userId, nickname, score'
            });
        }

        // Validate imageThumb size (max 70KB base64 = ~50KB actual)
        let validatedThumb = null;
        if (imageThumb && typeof imageThumb === 'string') {
            if (imageThumb.length > 70000) {
                console.warn(`[FashionShow] Image too large (${Math.round(imageThumb.length / 1024)}KB), skipping`);
            } else if (imageThumb.startsWith('data:image/')) {
                validatedThumb = imageThumb;
            }
        }

        // Check Pro status
        const isPro = await getProStatus(userId);

        // Record the walk with optional thumbnail
        const result = await recordWalk(showId, {
            userId,
            nickname,
            emoji: emoji || '😎',
            score: parseFloat(score),
            verdict: verdict || '',
            isPro,
            imageThumb: validatedThumb
        });

        res.json({
            success: true,
            ...result,
            isPro
        });
    } catch (error) {
        console.error('[FashionShow] Walk error:', error.message);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// HELPERS
// ============================================

function formatTimeRemaining(ms) {
    if (ms <= 0) return 'Ended';

    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);

    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    }

    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default router;
