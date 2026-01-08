/**
 * King of the Hill Service
 * 
 * Backend service for KotH throne management.
 * Uses Redis to store kings globally (not per-device like old localStorage).
 * 
 * Redis Data Structure:
 * - koth:kings (Hash): throneId → JSON { userId, displayName, score, crownedAt, defenses }
 * - TTL: No TTL on hash, individual king entries expire based on crownedAt
 */

import { redis, isRedisAvailable } from './redisClient.js';

// In-memory fallback for when Redis is unavailable
const inMemoryKings = new Map();

// Kings expire after 24 hours
const KING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Redis key for all kings
const KINGS_KEY = 'koth:kings';

/**
 * Get all current kings across all thrones
 * @returns {Object} { [throneId]: kingData }
 */
export async function getAllKings() {
    try {
        if (isRedisAvailable()) {
            const kingsData = await redis.hgetall(KINGS_KEY);
            if (!kingsData || Object.keys(kingsData).length === 0) {
                return {};
            }

            // Parse and filter expired kings
            const now = Date.now();
            const validKings = {};

            for (const [throneId, kingJson] of Object.entries(kingsData)) {
                try {
                    const king = JSON.parse(kingJson);
                    // Check if king is still valid (within 24 hours)
                    if (now - king.crownedAt < KING_TTL_MS) {
                        validKings[throneId] = king;
                    } else {
                        // Remove expired king
                        await redis.hdel(KINGS_KEY, throneId);
                        console.log(`[KotH] Removed expired king from throne ${throneId}`);
                    }
                } catch (parseErr) {
                    console.error(`[KotH] Failed to parse king data for ${throneId}:`, parseErr);
                }
            }

            return validKings;
        } else {
            // In-memory fallback
            const now = Date.now();
            const validKings = {};
            for (const [throneId, king] of inMemoryKings.entries()) {
                if (now - king.crownedAt < KING_TTL_MS) {
                    validKings[throneId] = king;
                } else {
                    inMemoryKings.delete(throneId);
                }
            }
            return validKings;
        }
    } catch (error) {
        console.error('[KotH] Failed to get kings:', error);
        return {};
    }
}

/**
 * Get king for a specific throne
 * @param {string} throneId - Throne ID (e.g., 'honest', 'roast')
 * @returns {Object|null} King data or null if vacant/expired
 */
export async function getKing(throneId) {
    try {
        if (isRedisAvailable()) {
            const kingJson = await redis.hget(KINGS_KEY, throneId);
            if (!kingJson) return null;

            const king = JSON.parse(kingJson);
            const now = Date.now();

            // Check if expired
            if (now - king.crownedAt >= KING_TTL_MS) {
                await redis.hdel(KINGS_KEY, throneId);
                return null;
            }

            return king;
        } else {
            const king = inMemoryKings.get(throneId);
            if (!king) return null;

            if (Date.now() - king.crownedAt >= KING_TTL_MS) {
                inMemoryKings.delete(throneId);
                return null;
            }
            return king;
        }
    } catch (error) {
        console.error(`[KotH] Failed to get king for throne ${throneId}:`, error);
        return null;
    }
}

/**
 * Crown a new king for a throne
 * @param {string} throneId - Throne ID
 * @param {Object} kingData - { userId, displayName, score, thumb }
 * @returns {Object} The new king data
 */
export async function setKing(throneId, kingData) {
    const newKing = {
        userId: kingData.userId,
        displayName: kingData.displayName || 'Anonymous',
        score: kingData.score || 0,
        thumb: kingData.thumb || null,
        crownedAt: Date.now(),
        defenses: 0
    };

    try {
        if (isRedisAvailable()) {
            await redis.hset(KINGS_KEY, throneId, JSON.stringify(newKing));
            console.log(`[KotH] 👑 New king crowned on ${throneId}: ${newKing.displayName} (score: ${newKing.score})`);
        } else {
            inMemoryKings.set(throneId, newKing);
        }
        return newKing;
    } catch (error) {
        console.error(`[KotH] Failed to set king for throne ${throneId}:`, error);
        // Fallback to in-memory
        inMemoryKings.set(throneId, newKing);
        return newKing;
    }
}

/**
 * Record a successful defense by the current king
 * @param {string} throneId - Throne ID
 * @returns {Object|null} Updated king data or null if no king
 */
export async function recordDefense(throneId) {
    try {
        const king = await getKing(throneId);
        if (!king) return null;

        king.defenses = (king.defenses || 0) + 1;

        if (isRedisAvailable()) {
            await redis.hset(KINGS_KEY, throneId, JSON.stringify(king));
            console.log(`[KotH] King on ${throneId} defended! Total defenses: ${king.defenses}`);
        } else {
            inMemoryKings.set(throneId, king);
        }

        return king;
    } catch (error) {
        console.error(`[KotH] Failed to record defense for throne ${throneId}:`, error);
        return null;
    }
}

/**
 * Challenge a throne - determines if challenger wins
 * @param {string} throneId - Throne ID
 * @param {Object} challenger - { userId, displayName, score, thumb }
 * @returns {Object} { success, isVacant, won, newKing, oldKing }
 */
export async function challengeThrone(throneId, challenger) {
    try {
        const currentKing = await getKing(throneId);

        // Throne is vacant - auto-win
        if (!currentKing) {
            const newKing = await setKing(throneId, challenger);
            return {
                success: true,
                isVacant: true,
                won: true,
                newKing,
                oldKing: null
            };
        }

        // Compare scores - challenger must beat current king
        const challengerWins = challenger.score > currentKing.score;

        if (challengerWins) {
            // Challenger takes the throne
            const newKing = await setKing(throneId, challenger);
            console.log(`[KotH] 👑 ${challenger.displayName} dethroned ${currentKing.displayName} on ${throneId}!`);
            return {
                success: true,
                isVacant: false,
                won: true,
                newKing,
                oldKing: currentKing
            };
        } else {
            // King defends
            await recordDefense(throneId);
            console.log(`[KotH] 🛡️ ${currentKing.displayName} defended against ${challenger.displayName} on ${throneId}`);
            return {
                success: true,
                isVacant: false,
                won: false,
                newKing: null,
                oldKing: currentKing
            };
        }
    } catch (error) {
        console.error(`[KotH] Challenge failed for throne ${throneId}:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}
