/**
 * Daily Challenge Service
 *
 * Manages the free daily challenge where everyone gets one try per day.
 * Leaderboard is for bragging rights only.
 *
 * Redis Keys:
 * - fitrate:daily:scores:{YYYY-MM-DD} - Sorted set (userId → score)
 * - fitrate:daily:entries:{YYYY-MM-DD}:{userId} - Entry metadata (JSON)
 */

import { redis, isRedisAvailable } from './redisClient.js';
import { getESTDate, getTodayKeyEST, getYesterdayKeyEST, getMidnightResetTimeEST, EST_OFFSET } from '../utils/dateUtils.js';

// Redis key patterns
const DAILY_SCORES_PREFIX = 'fitrate:daily:scores:';
const DAILY_ENTRIES_PREFIX = 'fitrate:daily:entries:';

// Constants
const DAILY_TTL = 60 * 60 * 48; // 48 hours (overlap for timezone safety)

// Display name templates
const DISPLAY_ADJECTIVES = ['Stylish', 'Dripped', 'Fresh', 'Clean', 'Bold', 'Fierce', 'Sleek', 'Iconic', 'Sharp', 'Slick'];
const DISPLAY_NOUNS = ['Fox', 'Tiger', 'Eagle', 'Wolf', 'Falcon', 'Phoenix', 'Panther', 'Hawk', 'Lion', 'Bear'];

// Rank titles for daily challenge
const RANK_TITLES = {
    1: { title: 'Style Icon', description: 'Top fit of the day!' },
    2: { title: 'Runner Up', description: 'So close to the crown' },
    3: { title: 'Bronze Fit', description: 'Third place style' },
    10: { title: 'Top 10', description: 'Elite daily squad' },
    50: { title: 'Rising Star', description: 'On the way up' },
    100: { title: 'Contender', description: 'In the game' }
};

/**
 * Get today's date key (YYYY-MM-DD) in EST
 * Leaderboard resets at midnight EST
 */
export function getTodayKey() {
    return getTodayKeyEST();
}

/**
 * Get yesterday's date key (YYYY-MM-DD) in EST
 * Uses proper date arithmetic to handle month/year boundaries correctly
 */
export function getYesterdayKey() {
    return getYesterdayKeyEST();
}

/**
 * Get midnight EST reset time for today (returned as UTC ISO string)
 * This is when the next leaderboard reset will occur
 */
export function getMidnightResetTime() {
    return getMidnightResetTimeEST();
}

/**
 * Generate anonymous display name from userId
 */
export function getAnonymousName(userId) {
    if (!userId) return 'Anonymous';
    const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const adj = DISPLAY_ADJECTIVES[hash % DISPLAY_ADJECTIVES.length];
    const noun = DISPLAY_NOUNS[(hash * 7) % DISPLAY_NOUNS.length];
    return `${adj} ${noun}`;
}

/**
 * Get rank title based on position
 */
export function getRankTitle(rank) {
    if (rank === 1) return RANK_TITLES[1];
    if (rank === 2) return { ...RANK_TITLES[2] };
    if (rank === 3) return { ...RANK_TITLES[3] };
    if (rank <= 10) return RANK_TITLES[10];
    if (rank <= 50) return RANK_TITLES[50];
    if (rank <= 100) return RANK_TITLES[100];
    return { title: 'Participant', description: 'Keep climbing!' };
}

/**
 * Check if a user has already entered today's daily challenge
 */
export async function hasEnteredToday(userId) {
    if (!userId || !isRedisAvailable()) return false;

    const todayKey = getTodayKey();
    const entryKey = `${DAILY_ENTRIES_PREFIX}${todayKey}:${userId}`;
    const entry = await redis.get(entryKey);
    return entry !== null;
}
/**
 * Record a daily challenge score
 * Returns error if user has already entered today
 * Only stores imageThumb for top 5 entries to save storage
 */
export async function recordDailyChallengeScore(userId, score, options = {}) {
    const { displayName = null, tagline = null, imageThumb = null } = options;

    if (!userId || score === undefined) {
        return { success: false, error: 'missing_params', message: 'Missing userId or score' };
    }

    if (!isRedisAvailable()) {
        return { success: false, error: 'redis_unavailable', message: 'Daily challenge unavailable' };
    }

    const todayKey = getTodayKey();
    const scoresKey = `${DAILY_SCORES_PREFIX}${todayKey}`;
    const entryKey = `${DAILY_ENTRIES_PREFIX}${todayKey}:${userId}`;

    // Check if already entered today
    const existingEntry = await redis.get(entryKey);
    if (existingEntry) {
        return {
            success: false,
            error: 'already_entered',
            message: "You've already entered today's challenge. Come back tomorrow!"
        };
    }

    // Record the score
    await redis.zadd(scoresKey, score, userId);
    await redis.expire(scoresKey, DAILY_TTL);

    // Get the user's rank BEFORE storing entry
    const rankIndex = await redis.zrevrank(scoresKey, userId);
    const rank = rankIndex !== null ? rankIndex + 1 : null;
    const totalParticipants = await redis.zcard(scoresKey);

    // Only store thumbnail if user is in top 5 (saves storage)
    const isTop5 = rank !== null && rank <= 5;
    const entry = {
        userId,
        score,
        displayName: displayName || getAnonymousName(userId),
        tagline: tagline || null,
        imageThumb: isTop5 ? (imageThumb || null) : null,  // Only top 5 get thumbnails
        submittedAt: new Date().toISOString()
    };
    await redis.set(entryKey, JSON.stringify(entry));
    await redis.expire(entryKey, DAILY_TTL);

    // If a new entry pushed someone out of top 5, remove their thumbnail
    if (isTop5 && totalParticipants > 5) {
        // Get the 6th place entry and remove their thumbnail
        const sixthPlaceResults = await redis.zrevrange(scoresKey, 5, 5);
        if (sixthPlaceResults.length > 0) {
            const sixthPlaceUserId = sixthPlaceResults[0];
            const sixthPlaceKey = `${DAILY_ENTRIES_PREFIX}${todayKey}:${sixthPlaceUserId}`;
            const sixthPlaceJson = await redis.get(sixthPlaceKey);
            if (sixthPlaceJson) {
                const sixthPlaceEntry = JSON.parse(sixthPlaceJson);
                if (sixthPlaceEntry.imageThumb) {
                    sixthPlaceEntry.imageThumb = null;  // Remove thumbnail
                    await redis.set(sixthPlaceKey, JSON.stringify(sixthPlaceEntry));
                    console.log(`[DAILY CHALLENGE] Removed thumbnail from 6th place: ${sixthPlaceUserId.slice(0, 12)}...`);
                }
            }
        }
    }

    console.log(`[DAILY CHALLENGE] ${userId.slice(0, 12)}... entered with score ${score}, rank #${rank}/${totalParticipants}${isTop5 ? ' (top 5, thumbnail stored)' : ''}`);

    return {
        success: true,
        score,
        rank,
        totalParticipants,
        ...getRankTitle(rank),
        message: rank === 1
            ? "You're currently #1! Keep checking back to see if you hold the top spot!"
            : `You're currently #${rank} today!`
    };
}

/**
 * Get today's daily challenge leaderboard
 */
export async function getDailyLeaderboard(userId = null, limit = 10) {
    const todayKey = getTodayKey();
    const scoresKey = `${DAILY_SCORES_PREFIX}${todayKey}`;

    if (!isRedisAvailable()) {
        return {
            success: true,
            leaderboard: [],
            totalParticipants: 0,
            resetsAt: getMidnightResetTime(),
            message: 'Leaderboard unavailable (no Redis)'
        };
    }

    // Get top N with scores
    const results = await redis.zrevrange(scoresKey, 0, limit - 1, 'WITHSCORES');
    const totalParticipants = await redis.zcard(scoresKey) || 0;

    const leaderboard = [];
    for (let i = 0; i < results.length; i += 2) {
        const odlUserId = results[i];
        const score = parseFloat(results[i + 1]);
        const rank = Math.floor(i / 2) + 1;

        // Get entry details for display name
        const entryKey = `${DAILY_ENTRIES_PREFIX}${todayKey}:${odlUserId}`;
        const entryJson = await redis.get(entryKey);
        const entry = entryJson ? JSON.parse(entryJson) : {};

        leaderboard.push({
            rank,
            userId: odlUserId.slice(0, 8) + '...', // Truncated for privacy
            displayName: entry.displayName || getAnonymousName(odlUserId),
            tagline: entry.tagline || null,
            imageThumb: entry.imageThumb || null,
            score: Math.round(score * 10) / 10,
            ...getRankTitle(rank),
            isCurrentUser: userId ? odlUserId === userId : false
        });
    }

    // Get user's rank if userId provided
    let userRank = null;
    let userScore = null;
    let hasEnteredToday = false;

    if (userId) {
        const rankIndex = await redis.zrevrank(scoresKey, userId);
        if (rankIndex !== null) {
            userRank = rankIndex + 1;
            userScore = parseFloat(await redis.zscore(scoresKey, userId));
            hasEnteredToday = true;
        }
    }

    return {
        success: true,
        leaderboard,
        userRank,
        userScore: userScore !== null ? Math.round(userScore * 10) / 10 : null,
        hasEnteredToday,
        totalParticipants,
        resetsAt: getMidnightResetTime()
    };
}

/**
 * Get user's daily challenge status
 */
export async function getUserDailyStatus(userId) {
    if (!userId) {
        return { hasEnteredToday: false, resetsAt: getMidnightResetTime() };
    }

    const todayKey = getTodayKey();
    const scoresKey = `${DAILY_SCORES_PREFIX}${todayKey}`;
    const entryKey = `${DAILY_ENTRIES_PREFIX}${todayKey}:${userId}`;

    if (!isRedisAvailable()) {
        return { hasEnteredToday: false, resetsAt: getMidnightResetTime() };
    }

    const entryJson = await redis.get(entryKey);
    if (!entryJson) {
        return { hasEnteredToday: false, resetsAt: getMidnightResetTime() };
    }

    const entry = JSON.parse(entryJson);
    const rankIndex = await redis.zrevrank(scoresKey, userId);
    const rank = rankIndex !== null ? rankIndex + 1 : null;
    const totalParticipants = await redis.zcard(scoresKey) || 0;

    return {
        hasEnteredToday: true,
        score: entry.score,
        rank,
        totalParticipants,
        ...getRankTitle(rank),
        submittedAt: entry.submittedAt,
        resetsAt: getMidnightResetTime()
    };
}


/**
 * Get yesterday's complete leaderboard for reward distribution
 * Called at midnight to distribute rewards for the previous day
 * @param {number} limit - Max entries to fetch (default 100 for reward calculation)
 * @returns {Object} { success, leaderboard: [{ userId, score, rank }], totalParticipants }
 */
export async function getYesterdaysFinalLeaderboard(limit = 100) {
    const yesterdayKey = getYesterdayKey();
    const scoresKey = `${DAILY_SCORES_PREFIX}${yesterdayKey}`;

    if (!isRedisAvailable()) {
        console.log('[DAILY REWARDS] Redis unavailable for yesterday leaderboard');
        return { success: false, leaderboard: [], totalParticipants: 0 };
    }

    // Get all entries with scores
    const results = await redis.zrevrange(scoresKey, 0, limit - 1, 'WITHSCORES');
    const totalParticipants = await redis.zcard(scoresKey) || 0;

    if (results.length === 0) {
        console.log(`[DAILY REWARDS] No entries found for ${yesterdayKey}`);
        return { success: true, leaderboard: [], totalParticipants: 0, dateKey: yesterdayKey };
    }

    const leaderboard = [];
    for (let i = 0; i < results.length; i += 2) {
        const userId = results[i];
        const score = parseFloat(results[i + 1]);
        const rank = Math.floor(i / 2) + 1;

        leaderboard.push({
            userId,  // Full userId needed for reward distribution
            score: Math.round(score * 10) / 10,
            rank
        });
    }

    console.log(`[DAILY REWARDS] Retrieved ${leaderboard.length}/${totalParticipants} entries from ${yesterdayKey}`);

    return {
        success: true,
        leaderboard,
        totalParticipants,
        dateKey: yesterdayKey
    };
}

export default {
    getTodayKey,
    getYesterdayKey,
    getMidnightResetTime,
    getAnonymousName,
    getRankTitle,
    hasEnteredToday,
    recordDailyChallengeScore,
    getDailyLeaderboard,
    getUserDailyStatus,
    getYesterdaysFinalLeaderboard
};
