/**
 * Daily Challenge Service
 *
 * Manages the free daily challenge where everyone gets one try per day.
 * Winner (highest score) receives 5 free pro scans.
 *
 * Redis Keys:
 * - fitrate:daily:scores:{YYYY-MM-DD} - Sorted set (userId → score)
 * - fitrate:daily:entries:{YYYY-MM-DD}:{userId} - Entry metadata (JSON)
 * - fitrate:daily:rewards:{YYYY-MM-DD} - Reward log for the day (JSON)
 */

import { redis, isRedisAvailable } from './redisClient.js';
import { addPurchasedScans } from '../middleware/referralStore.js';

// Redis key patterns
const DAILY_SCORES_PREFIX = 'fitrate:daily:scores:';
const DAILY_ENTRIES_PREFIX = 'fitrate:daily:entries:';
const DAILY_REWARDS_PREFIX = 'fitrate:daily:rewards:';

// Constants
const DAILY_TTL = 60 * 60 * 48; // 48 hours (overlap for timezone safety)
const WINNER_REWARD_SCANS = 5; // 5 free pro scans for winner

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
 * Get today's date key (YYYY-MM-DD) in UTC
 */
export function getTodayKey() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Get yesterday's date key (YYYY-MM-DD) in UTC
 */
export function getYesterdayKey() {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return yesterday.toISOString().split('T')[0];
}

/**
 * Get midnight UTC reset time for today
 */
export function getMidnightResetTime() {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.toISOString();
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

    // Record entry metadata with tagline and thumbnail for leaderboard
    const entry = {
        userId,
        score,
        displayName: displayName || getAnonymousName(userId),
        tagline: tagline || null,
        imageThumb: imageThumb || null,
        submittedAt: new Date().toISOString()
    };
    await redis.set(entryKey, JSON.stringify(entry));
    await redis.expire(entryKey, DAILY_TTL);

    // Get the user's rank
    const rankIndex = await redis.zrevrank(scoresKey, userId);
    const rank = rankIndex !== null ? rankIndex + 1 : null;
    const totalParticipants = await redis.zcard(scoresKey);

    console.log(`[DAILY CHALLENGE] ${userId.slice(0, 12)}... entered with score ${score}, rank #${rank}/${totalParticipants}`);

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
 * Award the daily challenge winner(s) from yesterday
 * Should be called by cron job at midnight
 * Handles ties by awarding all users with the highest score
 */
export async function awardDailyWinner() {
    if (!isRedisAvailable()) {
        console.log('[DAILY WINNER] Redis unavailable, skipping');
        return { success: false, error: 'redis_unavailable' };
    }

    const yesterday = getYesterdayKey();
    const scoresKey = `${DAILY_SCORES_PREFIX}${yesterday}`;
    const rewardsKey = `${DAILY_REWARDS_PREFIX}${yesterday}`;

    // Check if already awarded
    const existingReward = await redis.get(rewardsKey);
    if (existingReward) {
        console.log(`[DAILY WINNER] Already awarded for ${yesterday}`);
        return { success: false, error: 'already_awarded', data: JSON.parse(existingReward) };
    }

    // Get the highest score(s)
    const topResults = await redis.zrevrange(scoresKey, 0, 0, 'WITHSCORES');

    if (topResults.length < 2) {
        console.log(`[DAILY WINNER] No entries for ${yesterday}`);
        const noEntriesResult = {
            date: yesterday,
            winners: [],
            message: 'No entries for this day'
        };
        await redis.set(rewardsKey, JSON.stringify(noEntriesResult));
        await redis.expire(rewardsKey, 90 * 24 * 60 * 60); // 90 days
        return { success: true, data: noEntriesResult };
    }

    const topScore = parseFloat(topResults[1]);

    // Get ALL users with the top score (handle ties)
    const allEntries = await redis.zrevrange(scoresKey, 0, -1, 'WITHSCORES');
    const winners = [];

    for (let i = 0; i < allEntries.length; i += 2) {
        const odlUserId = allEntries[i];
        const score = parseFloat(allEntries[i + 1]);

        if (score === topScore) {
            winners.push({ userId: odlUserId, score });
        } else {
            break; // Sorted by score descending, so we can stop
        }
    }

    // Award all winners
    const awardedWinners = [];
    for (const winner of winners) {
        try {
            await addPurchasedScans(winner.userId, WINNER_REWARD_SCANS);
            awardedWinners.push({
                userId: winner.userId,
                score: winner.score,
                reward: `${WINNER_REWARD_SCANS} Pro Scans`
            });
            console.log(`[DAILY WINNER] Awarded ${WINNER_REWARD_SCANS} pro scans to ${winner.userId.slice(0, 12)}... (score: ${winner.score})`);
        } catch (err) {
            console.error(`[DAILY WINNER] Failed to award ${winner.userId.slice(0, 12)}...:`, err.message);
        }
    }

    const rewardResult = {
        date: yesterday,
        winners: awardedWinners,
        topScore,
        totalParticipants: allEntries.length / 2,
        awardedAt: new Date().toISOString()
    };

    // Log the reward
    await redis.set(rewardsKey, JSON.stringify(rewardResult));
    await redis.expire(rewardsKey, 90 * 24 * 60 * 60); // 90 days

    console.log(`[DAILY WINNER] ${yesterday}: Awarded ${awardedWinners.length} winner(s) with score ${topScore}`);

    return { success: true, data: rewardResult };
}

/**
 * Get past daily challenge results
 */
export async function getDailyRewardHistory(date) {
    if (!isRedisAvailable()) return null;

    const rewardsKey = `${DAILY_REWARDS_PREFIX}${date}`;
    const rewardJson = await redis.get(rewardsKey);

    if (!rewardJson) return null;
    return JSON.parse(rewardJson);
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
    awardDailyWinner,
    getDailyRewardHistory
};
