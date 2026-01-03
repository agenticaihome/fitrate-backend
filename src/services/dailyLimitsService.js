/**
 * Daily Limits Service
 *
 * Tracks daily usage limits for free tier users.
 * Pro users have unlimited access.
 *
 * Limits (free users only):
 * - Arena battles: 5/day
 * - Wardrobe wars: 1/day
 * - KOTH attempts: 3/day
 *
 * Redis Keys:
 * - fitrate:limits:{type}:{userId}:{YYYY-MM-DD} - Daily count
 */

import { redis, isRedisAvailable } from './redisClient.js';
import { EntitlementService } from './entitlements.js';
import { FREE_TIER_LIMITS } from '../config/systemPrompt.js';

// In-memory fallback for local dev
const limitsStoreFallback = new Map();

// Redis key pattern
const LIMITS_KEY_PREFIX = 'fitrate:limits:';

// TTL for limit keys (48 hours to handle timezone edge cases)
const LIMITS_TTL = 60 * 60 * 48;

/**
 * Get today's date key (YYYY-MM-DD) in UTC
 */
function getTodayKey() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Get the Redis key for a specific limit type and user
 */
function getLimitKey(type, userId) {
    const today = getTodayKey();
    return `${LIMITS_KEY_PREFIX}${type}:${userId}:${today}`;
}

/**
 * Check if a user is Pro (has unlimited access)
 */
async function checkIsPro(userId) {
    if (!userId) return false;
    try {
        return await EntitlementService.isPro(userId, null);
    } catch (error) {
        console.error('[DAILY_LIMITS] Error checking Pro status:', error.message);
        return false;
    }
}

/**
 * Get current usage count for a limit type
 * @param {string} type - 'arena', 'wardrobe', or 'koth'
 * @param {string} userId - User ID
 * @returns {number} Current usage count
 */
export async function getDailyUsage(type, userId) {
    if (!userId) return 0;

    const key = getLimitKey(type, userId);

    if (isRedisAvailable()) {
        const count = await redis.get(key);
        return parseInt(count || '0', 10);
    } else {
        return limitsStoreFallback.get(key) || 0;
    }
}

/**
 * Increment usage count for a limit type
 * @param {string} type - 'arena', 'wardrobe', or 'koth'
 * @param {string} userId - User ID
 * @returns {number} New usage count
 */
export async function incrementDailyUsage(type, userId) {
    if (!userId) return 0;

    const key = getLimitKey(type, userId);

    if (isRedisAvailable()) {
        const newCount = await redis.incr(key);
        if (newCount === 1) {
            await redis.expire(key, LIMITS_TTL);
        }
        return newCount;
    } else {
        const current = limitsStoreFallback.get(key) || 0;
        const newCount = current + 1;
        limitsStoreFallback.set(key, newCount);
        return newCount;
    }
}

/**
 * Get the daily limit for a specific type
 * @param {string} type - 'arena', 'wardrobe', or 'koth'
 * @returns {number} Daily limit
 */
function getDailyLimit(type) {
    switch (type) {
        case 'arena':
            return FREE_TIER_LIMITS.ARENA_BATTLES_DAILY;
        case 'wardrobe':
            return FREE_TIER_LIMITS.WARDROBE_BATTLES_DAILY;
        case 'koth':
            return FREE_TIER_LIMITS.KOTH_ATTEMPTS_DAILY;
        default:
            return 0;
    }
}

/**
 * Check if a user can perform an action (hasn't exceeded daily limit)
 * Pro users always return true (unlimited)
 *
 * @param {string} type - 'arena', 'wardrobe', or 'koth'
 * @param {string} userId - User ID
 * @returns {Object} { allowed: boolean, isPro: boolean, used: number, limit: number, remaining: number }
 */
export async function canPerformAction(type, userId) {
    if (!userId) {
        return {
            allowed: false,
            isPro: false,
            used: 0,
            limit: getDailyLimit(type),
            remaining: 0,
            error: 'User ID required'
        };
    }

    // Check if user is Pro
    const isPro = await checkIsPro(userId);
    if (isPro) {
        return {
            allowed: true,
            isPro: true,
            used: 0,
            limit: Infinity,
            remaining: Infinity
        };
    }

    // Get current usage for free user
    const used = await getDailyUsage(type, userId);
    const limit = getDailyLimit(type);
    const remaining = Math.max(0, limit - used);

    return {
        allowed: used < limit,
        isPro: false,
        used,
        limit,
        remaining
    };
}

/**
 * Record an action and check if it was allowed
 * This is atomic - checks and increments in one operation
 *
 * @param {string} type - 'arena', 'wardrobe', or 'koth'
 * @param {string} userId - User ID
 * @returns {Object} { allowed: boolean, isPro: boolean, used: number, limit: number, remaining: number }
 */
export async function recordAction(type, userId) {
    if (!userId) {
        return {
            allowed: false,
            isPro: false,
            used: 0,
            limit: getDailyLimit(type),
            remaining: 0,
            error: 'User ID required'
        };
    }

    // Check if user is Pro
    const isPro = await checkIsPro(userId);
    if (isPro) {
        return {
            allowed: true,
            isPro: true,
            used: 0,
            limit: Infinity,
            remaining: Infinity
        };
    }

    // Get current usage before incrementing
    const currentUsed = await getDailyUsage(type, userId);
    const limit = getDailyLimit(type);

    // Check if limit already reached
    if (currentUsed >= limit) {
        return {
            allowed: false,
            isPro: false,
            used: currentUsed,
            limit,
            remaining: 0
        };
    }

    // Increment and return new count
    const newUsed = await incrementDailyUsage(type, userId);
    const remaining = Math.max(0, limit - newUsed);

    console.log(`[DAILY_LIMITS] ${type} usage for ${userId.slice(0, 12)}: ${newUsed}/${limit}`);

    return {
        allowed: true,
        isPro: false,
        used: newUsed,
        limit,
        remaining
    };
}

/**
 * Get status for all limit types for a user
 * @param {string} userId - User ID
 * @returns {Object} Status for all limit types
 */
export async function getAllLimitsStatus(userId) {
    if (!userId) {
        return {
            isPro: false,
            arena: { used: 0, limit: FREE_TIER_LIMITS.ARENA_BATTLES_DAILY, remaining: FREE_TIER_LIMITS.ARENA_BATTLES_DAILY },
            wardrobe: { used: 0, limit: FREE_TIER_LIMITS.WARDROBE_BATTLES_DAILY, remaining: FREE_TIER_LIMITS.WARDROBE_BATTLES_DAILY },
            koth: { used: 0, limit: FREE_TIER_LIMITS.KOTH_ATTEMPTS_DAILY, remaining: FREE_TIER_LIMITS.KOTH_ATTEMPTS_DAILY }
        };
    }

    const isPro = await checkIsPro(userId);

    if (isPro) {
        return {
            isPro: true,
            arena: { used: 0, limit: Infinity, remaining: Infinity },
            wardrobe: { used: 0, limit: Infinity, remaining: Infinity },
            koth: { used: 0, limit: Infinity, remaining: Infinity }
        };
    }

    const [arenaUsed, wardrobeUsed, kothUsed] = await Promise.all([
        getDailyUsage('arena', userId),
        getDailyUsage('wardrobe', userId),
        getDailyUsage('koth', userId)
    ]);

    return {
        isPro: false,
        arena: {
            used: arenaUsed,
            limit: FREE_TIER_LIMITS.ARENA_BATTLES_DAILY,
            remaining: Math.max(0, FREE_TIER_LIMITS.ARENA_BATTLES_DAILY - arenaUsed)
        },
        wardrobe: {
            used: wardrobeUsed,
            limit: FREE_TIER_LIMITS.WARDROBE_BATTLES_DAILY,
            remaining: Math.max(0, FREE_TIER_LIMITS.WARDROBE_BATTLES_DAILY - wardrobeUsed)
        },
        koth: {
            used: kothUsed,
            limit: FREE_TIER_LIMITS.KOTH_ATTEMPTS_DAILY,
            remaining: Math.max(0, FREE_TIER_LIMITS.KOTH_ATTEMPTS_DAILY - kothUsed)
        }
    };
}

export default {
    getDailyUsage,
    incrementDailyUsage,
    canPerformAction,
    recordAction,
    getAllLimitsStatus
};
