/**
 * Leaderboard Routes - Today's Top Fits & Daily Challenge
 *
 * Global leaderboard showing top scores from the last 24 hours.
 * Uses Redis sorted sets for real-time rankings.
 *
 * GET /api/leaderboard/today - Get daily challenge leaderboard
 * GET /api/leaderboard/rank - Get specific user's rank
 *
 * Daily Challenge: Free for everyone, 1 try per day, for bragging rights
 */

import express from 'express';
import { redis, isRedisAvailable } from '../services/redisClient.js';
import { getTodayKeyEST } from '../utils/dateUtils.js';
import {
    getDailyLeaderboard,
    getUserDailyStatus,
    hasEnteredToday,
    recordDailyChallengeScore,
    getMidnightResetTime
} from '../services/dailyChallengeService.js';

const router = express.Router();

// Constants for regular leaderboard (non-challenge)
const LEADERBOARD_KEY_PREFIX = 'fitrate:leaderboard:';
const LEADERBOARD_TTL = 60 * 60 * 48; // 48 hours (overlap for timezone safety)

// Fun rank titles
const RANK_TITLES = {
    1: { title: '👑 UNDISPUTED', description: 'Top fit of the day!' },
    2: { title: '🥈 Podium Energy', description: 'So close to the crown' },
    3: { title: '🥉 Podium Energy', description: 'Bronze but beautiful' },
    10: { title: '🔥 Top 10 Club', description: 'Elite company' },
    50: { title: '💪 Still Dangerous', description: 'Watch out for this one' },
    100: { title: '✨ Rising Star', description: 'On the way up' }
};

/**
 * Get rank title based on position
 */
function getRankTitle(rank) {
    if (rank === 1) return RANK_TITLES[1];
    if (rank <= 3) return { ...RANK_TITLES[rank] || RANK_TITLES[2] };
    if (rank <= 10) return RANK_TITLES[10];
    if (rank <= 50) return RANK_TITLES[50];
    if (rank <= 100) return RANK_TITLES[100];
    return { title: '🎯 Main Character in Training', description: 'Keep climbing!' };
}



/**
 * Generate anonymous display name from userId
 */
function getAnonymousName(userId) {
    const adjectives = ['Stylish', 'Dripped', 'Fresh', 'Clean', 'Bold', 'Fierce', 'Sleek', 'Iconic'];
    const nouns = ['Fox', 'Tiger', 'Eagle', 'Wolf', 'Falcon', 'Phoenix', 'Panther', 'Hawk'];

    // Use userId hash to pick consistent adjective+noun
    const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const adj = adjectives[hash % adjectives.length];
    const noun = nouns[(hash * 7) % nouns.length];

    return `${adj} ${noun}`;
}

/**
 * GET /api/leaderboard/today
 * Get Daily Challenge leaderboard
 * Query params: userId (optional) - to get user's rank and entry status
 */
router.get('/today', async (req, res) => {
    try {
        const { userId } = req.query;

        // Set cache headers to allow fresh data (60 second cache)
        res.set('Cache-Control', 'public, max-age=60, must-revalidate');

        // Use the daily challenge service (already includes isCurrentUser, userRank)
        const result = await getDailyLeaderboard(userId, 10);

        res.json(result);
    } catch (error) {
        console.error('[LEADERBOARD] Error getting today:', error);
        res.status(500).json({ success: false, error: 'Failed to get leaderboard' });
    }
});

/**
 * GET /api/leaderboard/status
 * Get user's daily challenge status
 * Query params: userId (required)
 */
router.get('/status', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId required' });
        }

        const status = await getUserDailyStatus(userId);

        res.json({
            success: true,
            ...status
        });
    } catch (error) {
        console.error('[LEADERBOARD] Error getting status:', error);
        res.status(500).json({ success: false, error: 'Failed to get status' });
    }
});

/**
 * GET /api/leaderboard/rank
 * Get a specific user's rank
 */
router.get('/rank', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId required' });
        }

        const todayKey = getTodayKeyEST();
        const redisKey = `${LEADERBOARD_KEY_PREFIX}${todayKey}`;

        if (!isRedisAvailable()) {
            return res.json({ success: true, rank: null, message: 'Leaderboard unavailable' });
        }

        // Get user's rank (0-indexed, so add 1)
        const rankIndex = await redis.zrevrank(redisKey, userId);

        if (rankIndex === null) {
            return res.json({
                success: true,
                rank: null,
                message: 'Not on today\'s leaderboard yet'
            });
        }

        const rank = rankIndex + 1;
        const score = await redis.zscore(redisKey, userId);
        const totalEntries = await redis.zcard(redisKey);

        // Calculate distance to top 10
        let distanceToTop10 = null;
        if (rank > 10) {
            const top10Score = await redis.zrevrange(redisKey, 9, 9, 'WITHSCORES');
            if (top10Score.length >= 2) {
                distanceToTop10 = Math.ceil(parseFloat(top10Score[1]) - parseFloat(score));
            }
        }

        res.json({
            success: true,
            rank,
            score: Math.round(parseFloat(score) * 10) / 10,
            totalEntries,
            distanceToTop10,
            ...getRankTitle(rank)
        });
    } catch (error) {
        console.error('[LEADERBOARD] Error getting rank:', error);
        res.status(500).json({ success: false, error: 'Failed to get rank' });
    }
});

/**
 * Record a score to today's leaderboard
 * Called internally by analyze route on successful scan
 */
export async function recordScore(userId, score) {
    if (!userId || !score) return null;

    const todayKey = getTodayKeyEST();
    const redisKey = `${LEADERBOARD_KEY_PREFIX}${todayKey}`;

    try {
        if (!isRedisAvailable()) {
            console.log('[LEADERBOARD] Redis unavailable, skipping record');
            return null;
        }

        // Only record if higher than existing score (best of day)
        const existingScore = await redis.zscore(redisKey, userId);

        if (existingScore && parseFloat(existingScore) >= score) {
            console.log(`[LEADERBOARD] ${userId.slice(0, 12)} already has higher score ${existingScore}, keeping it`);
            return { recorded: false, reason: 'existing_score_higher' };
        }

        // Add/update score in sorted set
        await redis.zadd(redisKey, score, userId);
        await redis.expire(redisKey, LEADERBOARD_TTL);

        // Get new rank
        const rankIndex = await redis.zrevrank(redisKey, userId);
        const rank = rankIndex !== null ? rankIndex + 1 : null;

        console.log(`[LEADERBOARD] ${userId.slice(0, 12)} scored ${score}, now rank #${rank}`);

        return {
            recorded: true,
            rank,
            score,
            ...getRankTitle(rank)
        };
    } catch (error) {
        console.error('[LEADERBOARD] Error recording score:', error);
        return null;
    }
}

// Re-export daily challenge function for use in analyze route
export { recordDailyChallengeScore, getYesterdaysFinalLeaderboard } from '../services/dailyChallengeService.js';

// Import reward service for admin endpoints
import {
    calculateRewards,
    distributeRewards,
    wasDistributed,
    markDistributed,
    getDistributionHistory,
    DAILY_REWARDS
} from '../services/rewardService.js';

/**
 * GET /api/leaderboard/rewards/history
 * Get reward distribution history (admin)
 */
router.get('/rewards/history', async (req, res) => {
    try {
        // Check admin key
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== process.env.ADMIN_API_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const history = await getDistributionHistory(50);
        res.json({ success: true, history });
    } catch (error) {
        console.error('[REWARDS] Error getting history:', error);
        res.status(500).json({ success: false, error: 'Failed to get history' });
    }
});

/**
 * POST /api/leaderboard/rewards/distribute
 * Manually trigger reward distribution for yesterday (admin, for testing)
 */
router.post('/rewards/distribute', async (req, res) => {
    try {
        // Check admin key
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== process.env.ADMIN_API_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { type = 'daily', force = false } = req.body;

        if (type !== 'daily') {
            return res.status(400).json({ error: 'Only daily rewards supported for manual trigger' });
        }

        // Get yesterday's leaderboard
        const { leaderboard, totalParticipants, dateKey } = await getYesterdaysFinalLeaderboard(100);

        // Check if already distributed
        if (!force && await wasDistributed(dateKey, 'daily')) {
            return res.json({
                success: false,
                error: 'already_distributed',
                message: `Daily rewards already distributed for ${dateKey}. Use force=true to re-run.`
            });
        }

        if (leaderboard.length === 0) {
            return res.json({
                success: true,
                message: `No entries found for ${dateKey}`,
                distributed: 0,
                totalScans: 0
            });
        }

        // Calculate and distribute rewards
        const rewards = calculateRewards(leaderboard, DAILY_REWARDS);
        const result = await distributeRewards(rewards);

        // Mark as distributed (unless force, to allow re-testing)
        if (!force) {
            await markDistributed(dateKey, 'daily', {
                totalParticipants,
                winnersCount: rewards.length,
                ...result
            });
        }

        res.json({
            success: true,
            dateKey,
            totalParticipants,
            rewards: rewards.map(r => ({
                rank: r.rank,
                scans: r.scans,
                reason: r.reason
            })),
            ...result
        });
    } catch (error) {
        console.error('[REWARDS] Error distributing:', error);
        res.status(500).json({ success: false, error: 'Distribution failed' });
    }
});

/**
 * GET /api/leaderboard/rewards/preview
 * Preview what rewards would be distributed for yesterday (doesn't actually distribute)
 */
router.get('/rewards/preview', async (req, res) => {
    try {
        const { leaderboard, totalParticipants, dateKey } = await getYesterdaysFinalLeaderboard(100);

        if (leaderboard.length === 0) {
            return res.json({
                success: true,
                message: `No entries for ${dateKey}`,
                rewards: []
            });
        }

        const rewards = calculateRewards(leaderboard, DAILY_REWARDS);
        const wasAlreadyDistributed = await wasDistributed(dateKey, 'daily');

        res.json({
            success: true,
            dateKey,
            totalParticipants,
            wasAlreadyDistributed,
            totalScansToDistribute: rewards.reduce((sum, r) => sum + r.scans, 0),
            rewards: rewards.map(r => ({
                rank: r.rank,
                score: r.score,
                scans: r.scans,
                reason: r.reason
            }))
        });
    } catch (error) {
        console.error('[REWARDS] Error previewing:', error);
        res.status(500).json({ success: false, error: 'Preview failed' });
    }
});

export default router;
