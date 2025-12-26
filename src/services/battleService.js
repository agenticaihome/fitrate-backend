/**
 * Battle Service
 * Handles 1v1 outfit battle rooms where two users compare scores
 *
 * Redis Data Structure:
 * - Key: `challenge:{battleId}` (hash) - keeping 'challenge:' prefix for backwards compat
 * - TTL: 7 days (auto-expires)
 */

import { redis, isRedisAvailable } from './redisClient.js';
import crypto from 'crypto';

// In-memory fallback for when Redis is unavailable
const inMemoryStore = new Map();

/**
 * Generate a unique battle ID
 * Format: "ch_" + 10 random characters (alphanumeric)
 * Note: Keeping "ch_" prefix for backwards compatibility with existing battles
 */
export function generateBattleId() {
    const randomChars = crypto.randomBytes(8).toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 10);
    return `ch_${randomChars}`;
}

/**
 * Create a new battle
 * @param {number} creatorScore - Creator's outfit score (0.0-100.0)
 * @returns {Object} Battle data with ID
 */
export async function createBattle(creatorScore) {
    // Validate score
    if (typeof creatorScore !== 'number' || creatorScore < 0 || creatorScore > 100) {
        throw new Error('Score must be between 0 and 100');
    }

    const battleId = generateBattleId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const battleData = {
        id: battleId,
        creatorScore: parseFloat(creatorScore.toFixed(1)),
        responderScore: null,
        status: 'waiting',
        winner: null,
        createdAt: now.toISOString(),
        respondedAt: null,
        expiresAt: expiresAt.toISOString()
    };

    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`; // Keep 'challenge:' for backwards compat

        // Store as Redis hash
        await redis.hset(key, {
            creatorScore: battleData.creatorScore,
            status: battleData.status,
            createdAt: battleData.createdAt,
            expiresAt: battleData.expiresAt
        });

        // Set TTL to 7 days (604800 seconds)
        await redis.expire(key, 604800);
    } else {
        // In-memory fallback
        inMemoryStore.set(battleId, battleData);
    }

    return {
        battleId,
        status: battleData.status,
        creatorScore: battleData.creatorScore,
        createdAt: battleData.createdAt,
        expiresAt: battleData.expiresAt
    };
}

/**
 * Get battle data by ID
 * @param {string} battleId - Battle ID
 * @returns {Object|null} Battle data or null if not found
 */
export async function getBattle(battleId) {
    if (!battleId || !battleId.startsWith('ch_')) {
        return null;
    }

    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`; // Keep 'challenge:' for backwards compat
        const data = await redis.hgetall(key);

        // Battle not found or expired
        if (!data || Object.keys(data).length === 0) {
            return null;
        }

        // Parse data from Redis (all values are strings)
        const battle = {
            battleId,
            creatorScore: parseFloat(data.creatorScore),
            responderScore: data.responderScore ? parseFloat(data.responderScore) : null,
            status: data.status,
            winner: data.winner || null,
            createdAt: data.createdAt,
            respondedAt: data.respondedAt || null,
            expiresAt: data.expiresAt || null
        };

        // Check if battle has expired
        if (battle.expiresAt && new Date(battle.expiresAt) < new Date()) {
            // Update status to expired
            await redis.hset(key, 'status', 'expired');
            battle.status = 'expired';
        }

        return battle;
    } else {
        // In-memory fallback
        const battle = inMemoryStore.get(battleId);
        if (!battle) return null;

        // Check expiration
        if (new Date(battle.expiresAt) < new Date()) {
            battle.status = 'expired';
        }

        return {
            battleId,
            ...battle
        };
    }
}

/**
 * Submit responder's score and determine winner
 * @param {string} battleId - Battle ID
 * @param {number} responderScore - Responder's outfit score (0.0-100.0)
 * @returns {Object} Result with winner and scores
 */
export async function respondToBattle(battleId, responderScore) {
    // Validate score
    if (typeof responderScore !== 'number' || responderScore < 0 || responderScore > 100) {
        throw new Error('Score must be between 0 and 100');
    }

    // Get existing battle
    const battle = await getBattle(battleId);
    if (!battle) {
        throw new Error('Battle not found');
    }

    // Check if expired
    if (battle.status === 'expired') {
        throw new Error('Battle expired');
    }

    // Check if already completed
    if (battle.status === 'completed') {
        throw new Error('Battle already completed');
    }

    // Calculate winner
    const creatorScore = battle.creatorScore;
    const roundedResponderScore = parseFloat(responderScore.toFixed(1));
    let winner;

    if (roundedResponderScore > creatorScore) {
        winner = 'responder';
    } else if (roundedResponderScore < creatorScore) {
        winner = 'creator';
    } else {
        winner = 'tie';
    }

    const margin = Math.abs(roundedResponderScore - creatorScore);
    const respondedAt = new Date().toISOString();

    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`; // Keep 'challenge:' for backwards compat

        // Update battle with response
        await redis.hset(key, {
            responderScore: roundedResponderScore,
            status: 'completed',
            winner: winner,
            respondedAt: respondedAt
        });
    } else {
        // In-memory fallback
        const stored = inMemoryStore.get(battleId);
        if (stored) {
            stored.responderScore = roundedResponderScore;
            stored.status = 'completed';
            stored.winner = winner;
            stored.respondedAt = respondedAt;
        }
    }

    return {
        success: true,
        status: 'completed',
        creatorScore,
        responderScore: roundedResponderScore,
        winner,
        margin: parseFloat(margin.toFixed(1))
    };
}

/**
 * Check if a battle exists and is valid
 * @param {string} battleId - Battle ID
 * @returns {boolean}
 */
export async function battleExists(battleId) {
    const battle = await getBattle(battleId);
    return battle !== null;
}
