/**
 * Arena Leaderboard Service
 * 
 * Weekly leaderboard and user profile management for the Global Arena.
 * 
 * Redis Data Structures:
 * - arena:leaderboard:YYYY-WXX (Sorted Set): userId → totalPoints for weekly rankings
 * - arena:profiles (Hash): userId → JSON{displayName, createdAt, updatedAt}
 */

import { redis, isRedisAvailable } from './redisClient.js';

// Constants
const LEADERBOARD_TTL = 60 * 60 * 24 * 14; // 2 weeks retention
const PROFILE_TTL = 60 * 60 * 24 * 365; // 1 year retention

// Tier definitions matching frontend
const SEASON_TIERS = [
    { name: 'Bronze', minPoints: 0, color: '#cd7f32', emoji: '🥉' },
    { name: 'Silver', minPoints: 100, color: '#c0c0c0', emoji: '🥈' },
    { name: 'Gold', minPoints: 250, color: '#ffd700', emoji: '🥇' },
    { name: 'Platinum', minPoints: 500, color: '#e5e4e2', emoji: '💎' },
    { name: 'Diamond', minPoints: 1000, color: '#b9f2ff', emoji: '👑' }
];

// In-memory fallbacks
const inMemoryLeaderboard = new Map(); // weekKey -> Map(userId -> points)
const inMemoryProfiles = new Map(); // userId -> {displayName, createdAt, updatedAt}

/**
 * Get the current week key for leaderboard storage
 * @returns {string} Format: YYYY-WXX
 */
function getWeekKey() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000));
    const week = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${week.toString().padStart(2, '0')}`;
}

/**
 * Get tier for a given point total
 */
function getTierForPoints(points) {
    let tier = SEASON_TIERS[0];
    for (const t of SEASON_TIERS) {
        if (points >= t.minPoints) {
            tier = t;
        }
    }
    return tier;
}

/**
 * Generate anonymous display name from userId
 */
function generateAnonymousName(userId) {
    const adjectives = ['Stylish', 'Dripped', 'Fresh', 'Clean', 'Bold', 'Fierce', 'Sleek', 'Iconic'];
    const nouns = ['Fox', 'Tiger', 'Eagle', 'Wolf', 'Falcon', 'Phoenix', 'Panther', 'Hawk'];

    const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const adj = adjectives[hash % adjectives.length];
    const noun = nouns[(hash * 7) % nouns.length];

    return `${adj} ${noun}`;
}

/**
 * Get weekly arena leaderboard
 * @param {string} userId - Optional: to include user's rank
 * @param {number} limit - Number of entries to fetch
 * @returns {Object} { success, entries: [{rank, userId, displayName, points, tier}], userRank, totalEntries }
 */
export async function getWeeklyLeaderboard(userId = null, limit = 50) {
    const weekKey = getWeekKey();
    const leaderboardKey = `arena:leaderboard:${weekKey}`;

    try {
        if (isRedisAvailable()) {
            // Get top entries with scores
            const topEntries = await redis.zrevrange(leaderboardKey, 0, limit - 1, 'WITHSCORES');

            // Parse results
            const entries = [];
            for (let i = 0; i < topEntries.length; i += 2) {
                const entryUserId = topEntries[i];
                const points = parseInt(topEntries[i + 1]) || 0;

                // Get display name from profile
                const profile = await getUserProfile(entryUserId);
                const displayName = profile.displayName || generateAnonymousName(entryUserId);
                const tier = getTierForPoints(points);

                entries.push({
                    rank: (i / 2) + 1,
                    odgerId: entryUserId.slice(-8), // Partial ID for privacy
                    displayName,
                    points,
                    tier: {
                        name: tier.name,
                        emoji: tier.emoji,
                        color: tier.color
                    },
                    isCurrentUser: entryUserId === userId
                });
            }

            // Get user's rank if provided
            let userRank = null;
            let userPoints = 0;
            if (userId) {
                const rank = await redis.zrevrank(leaderboardKey, userId);
                if (rank !== null) {
                    userRank = rank + 1;
                    userPoints = parseInt(await redis.zscore(leaderboardKey, userId)) || 0;
                }
            }

            const totalEntries = await redis.zcard(leaderboardKey);

            return {
                success: true,
                entries,
                userRank,
                userPoints,
                weekKey,
                totalEntries
            };

        } else {
            // In-memory fallback
            let weekMap = inMemoryLeaderboard.get(weekKey);
            if (!weekMap) {
                weekMap = new Map();
                inMemoryLeaderboard.set(weekKey, weekMap);
            }

            // Sort entries by points descending
            const sortedEntries = [...weekMap.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit);

            const entries = sortedEntries.map(([entryUserId, points], i) => {
                const profile = inMemoryProfiles.get(entryUserId);
                const displayName = profile?.displayName || generateAnonymousName(entryUserId);
                const tier = getTierForPoints(points);

                return {
                    rank: i + 1,
                    odgerId: entryUserId.slice(-8),
                    displayName,
                    points,
                    tier: {
                        name: tier.name,
                        emoji: tier.emoji,
                        color: tier.color
                    },
                    isCurrentUser: entryUserId === userId
                };
            });

            let userRank = null;
            let userPoints = 0;
            if (userId && weekMap.has(userId)) {
                userPoints = weekMap.get(userId);
                userRank = [...weekMap.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .findIndex(([id]) => id === userId) + 1;
            }

            return {
                success: true,
                entries,
                userRank,
                userPoints,
                weekKey,
                totalEntries: weekMap.size
            };
        }
    } catch (error) {
        console.error('[ARENA] Leaderboard fetch error:', error.message);
        return {
            success: false,
            entries: [],
            error: error.message
        };
    }
}

/**
 * Get user profile (display name)
 * @param {string} userId
 * @returns {Object} { displayName, createdAt, updatedAt }
 */
export async function getUserProfile(userId) {
    if (!userId) return { displayName: null };

    try {
        if (isRedisAvailable()) {
            const profileData = await redis.hget('arena:profiles', userId);
            if (profileData) {
                return JSON.parse(profileData);
            }
            return { displayName: null };
        } else {
            return inMemoryProfiles.get(userId) || { displayName: null };
        }
    } catch (error) {
        console.error('[ARENA] Profile fetch error:', error.message);
        return { displayName: null };
    }
}

/**
 * Set user profile (display name)
 * @param {string} userId
 * @param {string} displayName
 * @returns {Object} { displayName, createdAt, updatedAt }
 */
export async function setUserProfile(userId, displayName) {
    if (!userId || !displayName) {
        throw new Error('userId and displayName are required');
    }

    const now = new Date().toISOString();

    try {
        // Get existing profile to preserve createdAt
        const existing = await getUserProfile(userId);

        const profile = {
            displayName,
            createdAt: existing?.createdAt || now,
            updatedAt: now
        };

        if (isRedisAvailable()) {
            await redis.hset('arena:profiles', userId, JSON.stringify(profile));
            // Set expiry on the hash field isn't directly supported, but the hash persists
        } else {
            inMemoryProfiles.set(userId, profile);
        }

        return profile;
    } catch (error) {
        console.error('[ARENA] Profile set error:', error.message);
        throw error;
    }
}

/**
 * Record a score to the weekly arena leaderboard
 * Called after an arena match is completed
 * @param {string} userId
 * @param {number} points - Points to add (typically 10 for win, 3 for tie, 1 for loss)
 * @returns {Object} { newTotal, rank }
 */
export async function recordArenaScore(userId, points) {
    if (!userId || typeof points !== 'number') return null;

    const weekKey = getWeekKey();
    const leaderboardKey = `arena:leaderboard:${weekKey}`;

    try {
        if (isRedisAvailable()) {
            // Increment user's score
            const newTotal = await redis.zincrby(leaderboardKey, points, userId);
            await redis.expire(leaderboardKey, LEADERBOARD_TTL);

            // Get new rank
            const rank = await redis.zrevrank(leaderboardKey, userId);

            console.log(`[ARENA] User ${userId.slice(0, 8)} +${points}pts, total: ${newTotal}, rank: #${rank + 1}`);

            return {
                newTotal: parseInt(newTotal),
                rank: rank !== null ? rank + 1 : null
            };
        } else {
            let weekMap = inMemoryLeaderboard.get(weekKey);
            if (!weekMap) {
                weekMap = new Map();
                inMemoryLeaderboard.set(weekKey, weekMap);
            }

            const currentPoints = weekMap.get(userId) || 0;
            const newTotal = currentPoints + points;
            weekMap.set(userId, newTotal);

            // Calculate rank
            const sortedUsers = [...weekMap.entries()].sort((a, b) => b[1] - a[1]);
            const rank = sortedUsers.findIndex(([id]) => id === userId) + 1;

            return { newTotal, rank };
        }
    } catch (error) {
        console.error('[ARENA] Score recording error:', error.message);
        return null;
    }
}
