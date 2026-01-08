/**
 * Matchmaking Routes - Global Arena
 * 
 * Endpoints for real-time global matchmaking
 * 
 * POST /api/arena/join   - Join queue with score + photo
 * GET  /api/arena/poll   - Poll for match status
 * POST /api/arena/leave  - Leave queue
 * GET  /api/arena/stats  - Get online count
 * POST /api/arena/ghost-battle - Create async ghost battle (timeout fallback)
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { joinQueue, pollForMatch, leaveQueue, getQueueStats, updatePresence } from '../services/matchmakingService.js';
import { recordAction, canPerformAction, getAllLimitsStatus } from '../services/dailyLimitsService.js';
import { FREE_TIER_LIMITS } from '../config/systemPrompt.js';
import { getGhostOpponent, addToGhostPool } from '../services/ghostPool.js';
import { createBattle, respondToBattle, getBattle } from '../services/battleService.js';

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

        // Check daily arena battle limit for free users
        const limitCheck = await recordAction('arena', userId);
        if (!limitCheck.allowed) {
            console.log(`[${requestId}] ⛔ User ${userId.slice(0, 12)} hit arena daily limit: ${limitCheck.used}/${limitCheck.limit}`);
            return res.status(403).json({
                error: true,
                code: 'DAILY_LIMIT_REACHED',
                message: `You've used all ${FREE_TIER_LIMITS.ARENA_BATTLES_DAILY} free arena battles today. Upgrade to Pro for unlimited battles!`,
                used: limitCheck.used,
                limit: limitCheck.limit,
                isPro: false
            });
        }

        const result = await joinQueue(userId, score, thumb || null, mode || 'nice');
        console.log(`[${requestId}] ✅ User ${userId} joined queue: ${result.status} (battles: ${limitCheck.used}/${limitCheck.limit})`);

        // Include limit info in response
        result.dailyLimits = {
            arena: {
                used: limitCheck.used,
                limit: limitCheck.isPro ? 'unlimited' : limitCheck.limit,
                remaining: limitCheck.isPro ? 'unlimited' : limitCheck.remaining
            }
        };

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

const scoreLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10, // 10 per minute per user (limit abuse)
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * POST /api/arena/record-score
 * Record scores for client-side games (KOTH)
 * Trusted endpoint - rate limited to prevent abuse
 */
router.post('/record-score', scoreLimiter, async (req, res) => {
    const requestId = `arena_score_${Date.now()}`;

    try {
        const { userId, points, source } = req.body;

        if (!userId) {
            return res.status(400).json({ error: true, message: 'userId is required' });
        }

        if (!points || typeof points !== 'number' || points <= 0 || points > 100) {
            return res.status(400).json({ error: true, message: 'Points must be 1-100' });
        }

        if (!source || typeof source !== 'string') {
            return res.status(400).json({ error: true, message: 'Source is required (e.g. koth:claim)' });
        }

        // Check daily KOTH limit for free users (only for koth:claim source)
        if (source.startsWith('koth:')) {
            const limitCheck = await recordAction('koth', userId);
            if (!limitCheck.allowed) {
                console.log(`[${requestId}] ⛔ User ${userId.slice(0, 8)} hit KOTH daily limit: ${limitCheck.used}/${limitCheck.limit}`);
                return res.status(403).json({
                    error: true,
                    code: 'DAILY_LIMIT_REACHED',
                    message: `You've used all ${FREE_TIER_LIMITS.KOTH_ATTEMPTS_DAILY} free KOTH attempts today. Upgrade to Pro for unlimited plays!`,
                    used: limitCheck.used,
                    limit: limitCheck.limit,
                    isPro: false
                });
            }
        }

        console.log(`[${requestId}] 🏆 Recording score for ${userId.slice(0, 8)}: +${points}pts (${source})`);

        const result = await recordArenaScore(userId, points);
        return res.status(200).json({ success: true, ...result });

    } catch (error) {
        console.error(`[${requestId}] Error recording score:`, error.message);
        return res.status(500).json({ error: true, message: 'Failed to record score' });
    }
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

// ============================================
// SEASON REWARDS CLAIM ENDPOINT
// ============================================

// Tier reward mapping (scans granted per tier)
const TIER_REWARDS = {
    'Bronze': 1,
    'Silver': 3,
    'Gold': 5,
    'Platinum': 10,
    'Diamond': 25
};

/**
 * POST /api/arena/claim-rewards
 * Claim season rewards based on current tier
 * Grants bonus scans to user's account
 */
router.post('/claim-rewards', profileLimiter, async (req, res) => {
    const requestId = `arena_claim_${Date.now()}`;

    try {
        const { userId, tier } = req.body;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        if (!tier || !TIER_REWARDS[tier]) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_TIER',
                message: 'Valid tier is required (Bronze, Silver, Gold, Platinum, Diamond)'
            });
        }

        const scansToGrant = TIER_REWARDS[tier];

        // Check if already claimed this season
        const claimKey = `fitrate:arena:claimed:${userId}:${new Date().toISOString().slice(0, 7)}`; // Monthly key
        const { redis, isRedisAvailable } = await import('../services/redisClient.js');

        if (isRedisAvailable()) {
            const alreadyClaimed = await redis.get(claimKey);
            if (alreadyClaimed) {
                return res.status(400).json({
                    success: false,
                    error: 'already_claimed',
                    message: "You've already claimed this season's rewards!"
                });
            }

            // Grant scans by updating user's purchased scans
            const scanKey = `fitrate:user:${userId}:purchased_scans`;
            const currentScans = parseInt(await redis.get(scanKey) || '0');
            const newTotal = currentScans + scansToGrant;
            await redis.set(scanKey, newTotal.toString());

            // Mark as claimed
            await redis.set(claimKey, 'true');
            await redis.expire(claimKey, 60 * 60 * 24 * 35); // 35 days (covers season + buffer)

            console.log(`[${requestId}] 🎁 ${userId.slice(0, 12)} claimed ${tier} rewards: +${scansToGrant} scans (total: ${newTotal})`);

            return res.status(200).json({
                success: true,
                tier,
                scansGranted: scansToGrant,
                totalScans: newTotal,
                message: `🎉 +${scansToGrant} scans added to your account!`
            });
        } else {
            // Fallback: just return success for frontend (no persistence)
            console.log(`[${requestId}] ⚠️ Redis unavailable, returning mock success for claim`);
            return res.status(200).json({
                success: true,
                tier,
                scansGranted: scansToGrant,
                totalScans: scansToGrant,
                message: `🎉 +${scansToGrant} scans added!`
            });
        }

    } catch (error) {
        console.error(`[${requestId}] Error claiming rewards:`, error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to claim rewards'
        });
    }
});

/**
 * GET /api/arena/limits
 * Get daily limits status for all game modes
 */
router.get('/limits', statsLimiter, async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_USER_ID',
                message: 'userId is required'
            });
        }

        const limits = await getAllLimitsStatus(userId);

        // Add cache headers for 30 seconds
        res.set('Cache-Control', 'private, max-age=30');

        return res.status(200).json({
            success: true,
            ...limits,
            resetsAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString() // Next midnight UTC
        });

    } catch (error) {
        console.error('Error getting limits status:', error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to get limits'
        });
    }
});

// ============================================
// PRESENCE HEARTBEAT
// ============================================

/**
 * POST /api/arena/presence
 * Passive heartbeat to count user as "Online" without joining a queue.
 * Called every 30s by frontend.
 */
router.post('/presence', async (req, res) => {
    try {
        const { userId } = req.body;
        if (userId) {
            // updatePresence is fire-and-forget for speed
            updatePresence(userId).catch(err => console.error('Presence update error:', err));
        }
        return res.status(200).json({ success: true });
    } catch (error) {
        // Silent fail is fine for presence
        return res.status(200).json({ success: true });
    }
});

// ============================================
// GHOST BATTLE - Async fallback when queue times out
// ============================================

const ghostLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5, // 5 ghost battles per minute per user
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * POST /api/arena/ghost-battle
 * Create an async battle with a ghost opponent
 * Called when queue times out (15s) - user never sees "no opponents found"
 */
router.post('/ghost-battle', ghostLimiter, async (req, res) => {
    const requestId = `ghost_battle_${Date.now()}`;

    try {
        console.log(`[${requestId}] POST /api/arena/ghost-battle`);
        const { userId, score, thumb, mode, displayName } = req.body;

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

        // Get a ghost opponent from the pool
        const ghost = await getGhostOpponent({
            targetScore: score,
            excludeUserId: userId,
            preferMode: mode || 'nice'
        });

        if (!ghost) {
            console.log(`[${requestId}] ⚠️ Ghost pool empty, cannot create ghost battle`);
            return res.status(503).json({
                error: true,
                code: 'NO_GHOSTS_AVAILABLE',
                message: 'No opponents available right now. Try again!'
            });
        }

        // Create the battle with user as creator
        const battle = await createBattle(score, userId, mode || 'nice', thumb);
        const battleId = battle.challengeId;

        // Immediately respond with ghost as opponent
        const ghostUserId = `ghost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await respondToBattle(battleId, ghost.score, ghostUserId, ghost.thumb);

        // Fetch completed battle for results
        const completedBattle = await getBattle(battleId);

        // Add user's outfit to ghost pool for future matches
        addToGhostPool({
            userId,
            score,
            thumb,
            mode: mode || 'nice',
            displayName: displayName || 'Player'
        }).catch(err => console.warn('[GhostPool] Add failed:', err));

        console.log(`[${requestId}] 👻 Ghost battle created: ${battleId} (user: ${score} vs ghost: ${ghost.score})`);

        // Determine result
        const isCreator = true;
        const myScore = score;
        const opponentScore = ghost.score;
        let result = 'tie';
        if (completedBattle?.winner === 'creator') {
            result = 'win';
        } else if (completedBattle?.winner === 'opponent') {
            result = 'loss';
        }

        return res.status(200).json({
            status: 'matched',
            battleId,
            isGhostBattle: true,
            myScore,
            opponentScore,
            opponentName: ghost.displayName,
            opponentThumb: ghost.thumb,
            isCreator,
            result,
            winner: completedBattle?.winner,
            battleCommentary: completedBattle?.battleCommentary,
            winningFactor: completedBattle?.winningFactor,
            marginOfVictory: completedBattle?.marginOfVictory
        });

    } catch (error) {
        console.error(`[${requestId}] Error creating ghost battle:`, error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to create ghost battle'
        });
    }
});

// ============================================
// KING OF THE HILL (KotH) ENDPOINTS
// ============================================

import {
    getAllKings,
    getKing,
    challengeThrone
} from '../services/kingService.js';

const kothLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // 30 per minute per IP
    message: { error: true, code: 'RATE_LIMITED', message: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * GET /api/arena/koth/thrones
 * Get all current throne kings
 */
router.get('/koth/thrones', kothLimiter, async (req, res) => {
    try {
        const kings = await getAllKings();

        // Cache for 10 seconds
        res.set('Cache-Control', 'public, max-age=10');

        return res.status(200).json({
            success: true,
            kings,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Error getting KotH thrones:', error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to get thrones'
        });
    }
});

/**
 * POST /api/arena/koth/challenge
 * Challenge a throne (or claim if vacant)
 */
router.post('/koth/challenge', kothLimiter, async (req, res) => {
    const requestId = `koth_challenge_${Date.now()}`;

    try {
        const { userId, displayName, throneId, score, thumb } = req.body;

        if (!userId || !throneId) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_PARAMS',
                message: 'userId and throneId are required'
            });
        }

        if (score === undefined || typeof score !== 'number' || score < 0 || score > 100) {
            return res.status(400).json({
                error: true,
                code: 'INVALID_SCORE',
                message: 'Score must be between 0 and 100'
            });
        }

        // Check daily KotH limit
        const limitCheck = await recordAction('koth', userId);
        if (!limitCheck.allowed) {
            console.log(`[${requestId}] ⛔ User ${userId.slice(0, 8)} hit KotH daily limit`);
            return res.status(403).json({
                error: true,
                code: 'DAILY_LIMIT_REACHED',
                message: `You've used all ${FREE_TIER_LIMITS.KOTH_ATTEMPTS_DAILY} free throne attempts today!`,
                used: limitCheck.used,
                limit: limitCheck.limit
            });
        }

        console.log(`[${requestId}] 👑 ${displayName || userId.slice(0, 8)} challenging throne ${throneId} with score ${score}`);

        const result = await challengeThrone(throneId, {
            userId,
            displayName: displayName || 'Anonymous',
            score,
            thumb
        });

        if (!result.success) {
            return res.status(500).json({
                error: true,
                code: 'CHALLENGE_FAILED',
                message: result.error || 'Challenge failed'
            });
        }

        return res.status(200).json({
            success: true,
            ...result,
            dailyLimits: {
                koth: {
                    used: limitCheck.used,
                    limit: limitCheck.limit,
                    remaining: limitCheck.remaining
                }
            }
        });

    } catch (error) {
        console.error(`[${requestId}] Error in KotH challenge:`, error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to challenge throne'
        });
    }
});

export default router;
