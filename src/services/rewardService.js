/**
 * Reward Service - Challenge Reward Distribution
 * 
 * Handles calculating and distributing scan rewards for:
 * - Daily Challenge (distributed at midnight UTC)
 * - Weekly Challenge (distributed Sunday midnight UTC)
 * - Arena (distributed Monday midnight UTC)
 * 
 * Uses addPurchasedScans() to credit rewards to winners.
 */

import { redis, isRedisAvailable } from './redisClient.js';
import { addPurchasedScans } from '../middleware/referralStore.js';

// Redis keys for tracking distributions
const DISTRIBUTED_KEY_PREFIX = 'fitrate:rewards:distributed:';
const REWARD_LOG_KEY = 'fitrate:rewards:log';

// ============================================
// REWARD CONFIGURATIONS
// ============================================

export const DAILY_REWARDS = {
    name: 'Daily Challenge',
    tiers: [
        { rank: 1, scans: 10 },           // #1 gets 10 scans
        { rank: 2, scans: 5 },            // #2 gets 5 scans
        { rank: 3, scans: 5 },            // #3 gets 5 scans
        { rankEnd: 10, scans: 2 },        // #4-10 get 2 scans each
    ],
    top25PercentReward: 1,              // Top 25% get 1 scan
};

export const WEEKLY_REWARDS = {
    name: 'Weekly Challenge',
    tiers: [
        { rank: 1, scans: 50 },           // #1 gets 50 scans
        { rank: 2, scans: 25 },           // #2 gets 25 scans
        { rank: 3, scans: 25 },           // #3 gets 25 scans
        { rankEnd: 10, scans: 10 },       // #4-10 get 10 scans each
    ],
    top25PercentReward: 3,              // Top 25% get 3 scans
};

export const ARENA_REWARDS = {
    name: 'Arena',
    tiers: [
        { rank: 1, scans: 25 },           // #1 gets 25 scans
        { rank: 2, scans: 15 },           // #2 gets 15 scans
        { rank: 3, scans: 15 },           // #3 gets 15 scans
        { rankEnd: 10, scans: 5 },        // #4-10 get 5 scans each
    ],
    top25PercentReward: 0,              // Arena doesn't have top 25% reward
};

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Calculate scan rewards for a leaderboard
 * @param {Array} leaderboard - Array of { userId, score, rank }
 * @param {Object} rewardConfig - One of DAILY/WEEKLY/ARENA_REWARDS
 * @returns {Array} - Array of { userId, scans, rank, reason }
 */
export function calculateRewards(leaderboard, rewardConfig) {
    if (!leaderboard || leaderboard.length === 0) {
        return [];
    }

    const rewards = [];
    const totalParticipants = leaderboard.length;
    const top25Cutoff = Math.ceil(totalParticipants * 0.25);

    for (let i = 0; i < leaderboard.length; i++) {
        const entry = leaderboard[i];
        const rank = i + 1;
        let scans = 0;
        let reason = '';

        // Check exact rank matches first (1, 2, 3)
        const exactTier = rewardConfig.tiers.find(t => t.rank === rank);
        if (exactTier) {
            scans = exactTier.scans;
            reason = `#${rank} place`;
        } else {
            // Check range tiers (4-10)
            const rangeTier = rewardConfig.tiers.find(t =>
                t.rankEnd && rank <= t.rankEnd && !t.rank
            );
            if (rangeTier) {
                scans = rangeTier.scans;
                reason = `Top 10 (#${rank})`;
            } else if (rewardConfig.top25PercentReward > 0 && rank <= top25Cutoff) {
                // Top 25% reward (must be rank 11+)
                scans = rewardConfig.top25PercentReward;
                reason = `Top 25% (#${rank}/${totalParticipants})`;
            }
        }

        if (scans > 0) {
            rewards.push({
                userId: entry.userId,
                scans,
                rank,
                reason,
                score: entry.score
            });
        }
    }

    return rewards;
}

/**
 * Distribute rewards to winners
 * @param {Array} rewards - Array of { userId, scans, rank, reason }
 * @returns {Object} - { success, distributed, failed, totalScans }
 */
export async function distributeRewards(rewards) {
    if (!rewards || rewards.length === 0) {
        return { success: true, distributed: 0, failed: 0, totalScans: 0 };
    }

    let distributed = 0;
    let failed = 0;
    let totalScans = 0;
    const failures = [];

    for (const reward of rewards) {
        try {
            await addPurchasedScans(reward.userId, reward.scans);
            distributed++;
            totalScans += reward.scans;
            console.log(`🏆 Rewarded ${reward.userId.slice(0, 12)}... with ${reward.scans} scans (${reward.reason})`);
        } catch (error) {
            failed++;
            failures.push({ userId: reward.userId, error: error.message });
            console.error(`❌ Failed to reward ${reward.userId.slice(0, 12)}...: ${error.message}`);
        }
    }

    return {
        success: failed === 0,
        distributed,
        failed,
        totalScans,
        failures: failures.length > 0 ? failures : undefined
    };
}

/**
 * Check if rewards were already distributed for a given date/challenge
 * @param {string} dateKey - Date key (YYYY-MM-DD or YYYY-WXX for weekly)
 * @param {string} challengeType - 'daily', 'weekly', or 'arena'
 * @returns {boolean}
 */
export async function wasDistributed(dateKey, challengeType) {
    if (!isRedisAvailable()) return false;

    const key = `${DISTRIBUTED_KEY_PREFIX}${challengeType}:${dateKey}`;
    const exists = await redis.exists(key);
    return exists === 1;
}

/**
 * Mark rewards as distributed for a given date/challenge
 * @param {string} dateKey - Date key
 * @param {string} challengeType - 'daily', 'weekly', or 'arena'
 * @param {Object} result - Distribution result to log
 */
export async function markDistributed(dateKey, challengeType, result) {
    if (!isRedisAvailable()) return;

    const key = `${DISTRIBUTED_KEY_PREFIX}${challengeType}:${dateKey}`;
    const logEntry = {
        dateKey,
        challengeType,
        distributedAt: new Date().toISOString(),
        ...result
    };

    // Store distribution record (expires after 30 days)
    await redis.set(key, JSON.stringify(logEntry));
    await redis.expire(key, 60 * 60 * 24 * 30);

    // Also add to audit log list
    await redis.lpush(REWARD_LOG_KEY, JSON.stringify(logEntry));
    await redis.ltrim(REWARD_LOG_KEY, 0, 999); // Keep last 1000 entries

    console.log(`✅ Marked ${challengeType} rewards for ${dateKey} as distributed`);
}

/**
 * Get reward distribution history
 * @param {number} limit - Number of entries to fetch
 * @returns {Array} - Recent distribution logs
 */
export async function getDistributionHistory(limit = 50) {
    if (!isRedisAvailable()) return [];

    const logs = await redis.lrange(REWARD_LOG_KEY, 0, limit - 1);
    return logs.map(log => JSON.parse(log));
}

/**
 * Get pending rewards for a user (rewards they haven't been notified about)
 * This is optional - for showing "You won X scans!" notification
 */
export async function getPendingRewardNotification(userId) {
    // TODO: Implement if we want to show reward notifications on login
    return null;
}

export default {
    DAILY_REWARDS,
    WEEKLY_REWARDS,
    ARENA_REWARDS,
    calculateRewards,
    distributeRewards,
    wasDistributed,
    markDistributed,
    getDistributionHistory
};
