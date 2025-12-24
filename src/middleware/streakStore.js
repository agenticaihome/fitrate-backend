/**
 * Streak Store - Daily Fit Streak System
 * 
 * Tracks consecutive days of fit scanning per user/device.
 * Uses Redis with in-memory fallback for resilience.
 * 
 * Visual Progression:
 * - Day 1-2:    🔥 (small flame)
 * - Day 3-6:    🔥🔥 (growing flame)
 * - Day 7-13:   ✨🔥✨ (flame with sparkles)
 * - Day 14-29:  👑🔥👑 (crown + flame)
 * - Day 30+:    🏆 LEGENDARY
 */

import { redis, isRedisAvailable } from '../config/redis.js';

// Constants
const STREAK_PREFIX = 'fitrate:streak:';
const STREAK_TTL = 60 * 60 * 24 * 60; // 60 days (keep history)
const GRACE_HOUR = 3; // Scans before 3 AM count as previous day

// In-memory fallback for local dev
const streakStoreFallback = new Map();

/**
 * Get the streak date key, accounting for grace period
 * Scans before 3 AM count as previous day
 */
function getStreakDateKey() {
    const now = new Date();
    const hour = now.getHours();

    // If before grace hour (3 AM), treat as previous day
    if (hour < GRACE_HOUR) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Get yesterday's date key for streak continuation check
 */
function getYesterdayKey() {
    const now = new Date();
    const hour = now.getHours();

    // If before grace hour, yesterday is actually 2 days ago
    const daysBack = hour < GRACE_HOUR ? 2 : 1;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - daysBack);
    return yesterday.toISOString().split('T')[0];
}

/**
 * Get streak data for a user
 * Returns: { currentStreak, lastScanDate, maxStreak, totalScans }
 */
export async function getStreakData(userId) {
    if (!userId) {
        return { currentStreak: 0, lastScanDate: null, maxStreak: 0, totalScans: 0 };
    }

    const redisKey = `${STREAK_PREFIX}${userId}`;

    try {
        if (isRedisAvailable()) {
            const data = await redis.hgetall(redisKey);
            if (!data || Object.keys(data).length === 0) {
                return { currentStreak: 0, lastScanDate: null, maxStreak: 0, totalScans: 0 };
            }
            return {
                currentStreak: parseInt(data.currentStreak) || 0,
                lastScanDate: data.lastScanDate || null,
                maxStreak: parseInt(data.maxStreak) || 0,
                totalScans: parseInt(data.totalScans) || 0
            };
        } else {
            // In-memory fallback
            const data = streakStoreFallback.get(userId);
            return data || { currentStreak: 0, lastScanDate: null, maxStreak: 0, totalScans: 0 };
        }
    } catch (error) {
        console.error(`[STREAK] Error getting streak for ${userId.slice(0, 12)}:`, error);
        return { currentStreak: 0, lastScanDate: null, maxStreak: 0, totalScans: 0 };
    }
}

/**
 * Record a scan and update streak
 * Called after successful scan completion
 * Returns updated streak data
 */
export async function recordScan(userId) {
    if (!userId) {
        return { currentStreak: 0, lastScanDate: null, maxStreak: 0, totalScans: 0, isNewStreak: false, isMilestone: false };
    }

    const todayKey = getStreakDateKey();
    const yesterdayKey = getYesterdayKey();
    const currentData = await getStreakData(userId);

    let newStreak = 1;
    let isNewStreak = false;
    let isMilestone = false;

    // Calculate new streak
    if (currentData.lastScanDate === todayKey) {
        // Already scanned today, streak unchanged
        newStreak = currentData.currentStreak;
    } else if (currentData.lastScanDate === yesterdayKey) {
        // Scanned yesterday, continue streak!
        newStreak = currentData.currentStreak + 1;
        isNewStreak = true;

        // Check for milestones
        if ([3, 7, 14, 30, 50, 100].includes(newStreak)) {
            isMilestone = true;
        }
    } else if (currentData.currentStreak > 0) {
        // Missed a day, streak resets to 1
        newStreak = 1;
        isNewStreak = true;
        console.log(`[STREAK] ${userId.slice(0, 12)} streak reset (was ${currentData.currentStreak})`);
    } else {
        // First scan ever
        newStreak = 1;
        isNewStreak = true;
    }

    const newMaxStreak = Math.max(currentData.maxStreak, newStreak);
    const newTotalScans = currentData.totalScans + 1;

    const newData = {
        currentStreak: newStreak,
        lastScanDate: todayKey,
        maxStreak: newMaxStreak,
        totalScans: newTotalScans
    };

    // Save to storage
    try {
        if (isRedisAvailable()) {
            const redisKey = `${STREAK_PREFIX}${userId}`;
            await redis.hset(redisKey, {
                currentStreak: newStreak.toString(),
                lastScanDate: todayKey,
                maxStreak: newMaxStreak.toString(),
                totalScans: newTotalScans.toString()
            });
            await redis.expire(redisKey, STREAK_TTL);
            console.log(`[STREAK] ${userId.slice(0, 12)} now at ${newStreak} days (Redis)`);
        } else {
            streakStoreFallback.set(userId, newData);
            console.log(`[STREAK] ${userId.slice(0, 12)} now at ${newStreak} days (in-memory)`);
        }
    } catch (error) {
        console.error(`[STREAK] Error saving streak for ${userId.slice(0, 12)}:`, error);
    }

    return {
        ...newData,
        isNewStreak,
        isMilestone
    };
}

/**
 * Get streak display info (emoji, label, tier)
 */
export function getStreakDisplay(streak) {
    if (streak >= 30) {
        return {
            emoji: '🏆',
            label: 'LEGENDARY',
            tier: 'legendary',
            message: `${streak}-day legend! You're on fire! 🏆`
        };
    } else if (streak >= 14) {
        return {
            emoji: '👑🔥👑',
            label: 'Crown',
            tier: 'crown',
            message: `${streak} days! Crowned 👑`
        };
    } else if (streak >= 7) {
        return {
            emoji: '✨🔥✨',
            label: 'Sparkle',
            tier: 'sparkle',
            message: `${streak} days! Sparkling ✨`
        };
    } else if (streak >= 3) {
        return {
            emoji: '🔥🔥',
            label: 'Fire',
            tier: 'fire',
            message: `${streak} days! On fire 🔥`
        };
    } else if (streak >= 1) {
        return {
            emoji: '🔥',
            label: 'Flame',
            tier: 'flame',
            message: streak === 1 ? 'Day 1! Let\'s go 🔥' : `${streak} days! Keep it up 🔥`
        };
    } else {
        return {
            emoji: '💔',
            label: 'Fresh Start',
            tier: 'none',
            message: 'Start your streak today!'
        };
    }
}

/**
 * Get milestone celebration info
 */
export function getMilestoneInfo(streak) {
    const milestones = {
        3: { title: '3 Days Strong!', message: 'You\'re building a habit 💪' },
        7: { title: 'Week Warrior!', message: 'One whole week of fits! ✨' },
        14: { title: 'Two Week King!', message: 'You\'re officially dedicated 👑' },
        30: { title: 'LEGENDARY STATUS', message: '30 days! You\'re a FitRate legend 🏆' },
        50: { title: 'Half Century!', message: '50 days of pure drip 💎' },
        100: { title: 'CENTURY CLUB', message: 'Welcome to the elite 100 🎖️' }
    };

    return milestones[streak] || null;
}

export default {
    getStreakData,
    recordScan,
    getStreakDisplay,
    getMilestoneInfo
};
