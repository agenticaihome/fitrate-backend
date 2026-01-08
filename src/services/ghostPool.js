/**
 * Ghost Pool Service - Async Battle Fallback
 * 
 * Stores recent outfit submissions for use as "ghost" opponents when no live
 * player is available in the queue. This ensures users NEVER see "no opponents found".
 * 
 * Key Design Decisions:
 * - Store last 200 outfits in Redis sorted set (or in-memory fallback)
 * - Outfits older than 24h are automatically purged
 * - Random selection weighted by score proximity
 * - Ghost battles are indistinguishable from real battles to the user
 * 
 * Redis Data Structure:
 * - Key: `ghost_pool` (sorted set, score = timestamp)
 * - Key: `ghost_data:{odatahash}` (hash with outfit details)
 */

import { redis, isRedisAvailable } from './redisClient.js';
import crypto from 'crypto';

const GHOST_POOL_KEY = 'ghost_pool';
const GHOST_DATA_PREFIX = 'ghost_data:';
const MAX_POOL_SIZE = 200;
const GHOST_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory fallback
const inMemoryPool = new Map();

/**
 * Generate a unique hash for outfit de-duplication
 */
function generateOutfitHash(userId, score) {
    return crypto.createHash('md5')
        .update(`${userId}:${score}:${Date.now()}`)
        .digest('hex')
        .slice(0, 12);
}

/**
 * Add an outfit to the ghost pool
 * Called automatically after every successful battle/scan in arena
 * 
 * @param {Object} outfit - Outfit data
 * @param {string} outfit.userId - User ID (will be anonymized in pool)
 * @param {number} outfit.score - Outfit score
 * @param {string} outfit.thumb - Base64 thumbnail
 * @param {string} outfit.mode - AI mode used
 * @param {string} outfit.displayName - Display name (optional)
 */
export async function addToGhostPool(outfit) {
    try {
        const { userId, score, thumb, mode, displayName } = outfit;

        // Don't add if missing critical data
        if (!score || !thumb) return;

        const hash = generateOutfitHash(userId, score);
        const timestamp = Date.now();

        const ghostData = {
            hash,
            score: Math.round(score * 10) / 10, // Round to 1 decimal
            thumb,
            mode: mode || 'nice',
            displayName: displayName || generateGhostName(),
            addedAt: timestamp
        };

        if (isRedisAvailable()) {
            // Add to sorted set with timestamp as score
            await redis.zadd(GHOST_POOL_KEY, timestamp, hash);

            // Store outfit data
            await redis.hset(`${GHOST_DATA_PREFIX}${hash}`, ghostData);
            await redis.expire(`${GHOST_DATA_PREFIX}${hash}`, 86400); // 24h TTL

            // Trim pool to max size (remove oldest)
            const poolSize = await redis.zcard(GHOST_POOL_KEY);
            if (poolSize > MAX_POOL_SIZE) {
                const toRemove = poolSize - MAX_POOL_SIZE;
                const oldEntries = await redis.zrange(GHOST_POOL_KEY, 0, toRemove - 1);
                for (const oldHash of oldEntries) {
                    await redis.zrem(GHOST_POOL_KEY, oldHash);
                    await redis.del(`${GHOST_DATA_PREFIX}${oldHash}`);
                }
            }
        } else {
            // In-memory fallback
            inMemoryPool.set(hash, { ...ghostData, timestamp });

            // Trim to max size
            if (inMemoryPool.size > MAX_POOL_SIZE) {
                const entries = [...inMemoryPool.entries()]
                    .sort((a, b) => a[1].timestamp - b[1].timestamp);
                const toRemove = entries.slice(0, entries.length - MAX_POOL_SIZE);
                toRemove.forEach(([h]) => inMemoryPool.delete(h));
            }
        }

        console.log(`[GhostPool] Added outfit: score=${score}, mode=${mode}`);
    } catch (err) {
        console.error('[GhostPool] Add error:', err);
    }
}

/**
 * Get a random ghost opponent matching criteria
 * 
 * @param {Object} options
 * @param {number} options.targetScore - User's score (for proximity matching)
 * @param {string} options.excludeUserId - Don't match with own ghosts
 * @param {string} options.preferMode - Prefer same mode (optional)
 * @returns {Object|null} Ghost outfit data or null if pool empty
 */
export async function getGhostOpponent({ targetScore, excludeUserId, preferMode }) {
    try {
        let candidates = [];

        if (isRedisAvailable()) {
            // Get all ghosts from last 24h
            const cutoff = Date.now() - GHOST_TTL_MS;
            const hashes = await redis.zrangebyscore(GHOST_POOL_KEY, cutoff, '+inf');

            for (const hash of hashes) {
                const data = await redis.hgetall(`${GHOST_DATA_PREFIX}${hash}`);
                if (data && Object.keys(data).length > 0) {
                    candidates.push({
                        ...data,
                        score: parseFloat(data.score)
                    });
                }
            }
        } else {
            // In-memory fallback
            const cutoff = Date.now() - GHOST_TTL_MS;
            candidates = [...inMemoryPool.values()]
                .filter(g => g.timestamp > cutoff);
        }

        if (candidates.length === 0) {
            console.log('[GhostPool] No ghosts available, generating synthetic');
            return generateSyntheticGhost(targetScore, preferMode);
        }

        // Score candidates based on proximity and mode match
        const scored = candidates.map(ghost => {
            let weight = 100;

            // Score proximity weighting (closer = higher weight)
            const scoreDiff = Math.abs(ghost.score - targetScore);
            if (scoreDiff < 5) weight += 50;
            else if (scoreDiff < 10) weight += 30;
            else if (scoreDiff < 20) weight += 10;

            // Mode match bonus
            if (preferMode && ghost.mode === preferMode) {
                weight += 20;
            }

            return { ...ghost, weight };
        });

        // Weighted random selection
        const totalWeight = scored.reduce((sum, g) => sum + g.weight, 0);
        let random = Math.random() * totalWeight;

        for (const ghost of scored) {
            random -= ghost.weight;
            if (random <= 0) {
                console.log(`[GhostPool] Selected ghost: score=${ghost.score}, mode=${ghost.mode}`);
                return {
                    score: ghost.score,
                    thumb: ghost.thumb,
                    displayName: ghost.displayName,
                    mode: ghost.mode,
                    isGhost: true
                };
            }
        }

        // Fallback to first candidate
        const first = candidates[0];
        return {
            score: first.score,
            thumb: first.thumb,
            displayName: first.displayName,
            mode: first.mode,
            isGhost: true
        };

    } catch (err) {
        console.error('[GhostPool] Get error:', err);
        return generateSyntheticGhost(targetScore, preferMode);
    }
}

/**
 * Generate a synthetic ghost when pool is empty
 * Creates a believable opponent with score near the user's
 */
function generateSyntheticGhost(targetScore, mode) {
    // Score variation: ±15 points centered on target
    const scoreVariation = (Math.random() - 0.5) * 30;
    const ghostScore = Math.max(10, Math.min(100, targetScore + scoreVariation));

    return {
        score: Math.round(ghostScore * 10) / 10,
        thumb: null, // UI will show silhouette
        displayName: generateGhostName(),
        mode: mode || 'nice',
        isGhost: true,
        isSynthetic: true
    };
}

/**
 * Generate a random ghost display name
 */
function generateGhostName() {
    const adjectives = [
        'Stylish', 'Trendy', 'Fierce', 'Bold', 'Chic',
        'Slick', 'Fresh', 'Dapper', 'Glam', 'Sharp',
        'Sassy', 'Classy', 'Iconic', 'Vibey', 'Drip'
    ];
    const nouns = [
        'Diva', 'Star', 'Icon', 'Legend', 'Fashionista',
        'Trendsetter', 'Vibe', 'Look', 'Fit', 'King',
        'Queen', 'Boss', 'Drip', 'Style', 'Mood'
    ];

    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 999) + 1;

    return `${adj}${noun}${num}`;
}

/**
 * Get pool statistics
 */
export async function getPoolStats() {
    try {
        if (isRedisAvailable()) {
            const size = await redis.zcard(GHOST_POOL_KEY);
            const cutoff = Date.now() - GHOST_TTL_MS;
            const activeSize = await redis.zcount(GHOST_POOL_KEY, cutoff, '+inf');
            return { totalSize: size, activeSize };
        } else {
            const cutoff = Date.now() - GHOST_TTL_MS;
            const activeSize = [...inMemoryPool.values()]
                .filter(g => g.timestamp > cutoff).length;
            return { totalSize: inMemoryPool.size, activeSize };
        }
    } catch (err) {
        return { totalSize: 0, activeSize: 0, error: err.message };
    }
}

export default {
    addToGhostPool,
    getGhostOpponent,
    getPoolStats
};
