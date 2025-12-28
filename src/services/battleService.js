/**
 * Battle Service
 * Handles 1v1 outfit battle rooms where two users compare scores
 *
 * Redis Data Structure:
 * - Key: `challenge:{battleId}` (hash) - keeping 'challenge:' prefix for backwards compat
 * - TTL: 24 hours (auto-expires)
 */

import { redis, isRedisAvailable } from './redisClient.js';
import crypto from 'crypto';
import { compareBattleOutfits } from './battleAnalyzer.js';

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
 * @param {string} creatorId - User ID of the creator
 * @param {string} mode - AI mode used for scoring (e.g., 'nice', 'roast', 'savage')
 * @param {string} creatorThumb - Base64 thumbnail of creator's outfit (optional)
 * @returns {Object} Battle data with ID
 */
export async function createBattle(creatorScore, creatorId, mode = 'nice', creatorThumb = null) {
    // Validate score
    if (typeof creatorScore !== 'number' || creatorScore < 0 || creatorScore > 100) {
        throw new Error('Score must be between 0 and 100');
    }

    // Validate creatorId
    if (!creatorId || typeof creatorId !== 'string') {
        throw new Error('creatorId is required');
    }

    const battleId = generateBattleId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const battleData = {
        id: battleId,
        creatorScore: parseFloat(creatorScore.toFixed(2)),
        creatorId: creatorId,
        responderScore: null,
        responderId: null,
        mode: mode || 'nice',  // AI mode for both players
        creatorThumb: creatorThumb || null,  // Creator's outfit photo
        responderThumb: null,
        status: 'waiting',
        winner: null,
        createdAt: now.toISOString(),
        respondedAt: null,
        expiresAt: expiresAt.toISOString()
    };

    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`; // Keep 'challenge:' for backwards compat

        // Store as Redis hash
        const hashData = {
            creatorScore: battleData.creatorScore,
            creatorId: battleData.creatorId,
            mode: battleData.mode,
            status: battleData.status,
            createdAt: battleData.createdAt,
            expiresAt: battleData.expiresAt
        };

        // Only store thumb if provided (saves Redis memory)
        if (creatorThumb) {
            hashData.creatorThumb = creatorThumb;
        }

        await redis.hset(key, hashData);

        // Set TTL to 24 hours (86400 seconds)
        await redis.expire(key, 86400);
    } else {
        // In-memory fallback
        inMemoryStore.set(battleId, battleData);
    }

    return {
        challengeId: battleId,
        creatorScore: battleData.creatorScore,
        creatorId: battleData.creatorId,
        mode: battleData.mode,
        status: battleData.status,
        createdAt: battleData.createdAt,
        expiresAt: battleData.expiresAt
    };
}

/**
 * Get battle data by ID
 * @param {string} battleId - Battle ID
 * @param {boolean} includeExpired - Whether to include expired battles (default: false)
 * @returns {Object|null} Battle data or null if not found/expired
 */
export async function getBattle(battleId, includeExpired = false) {
    if (!battleId || !battleId.startsWith('ch_')) {
        return null;
    }

    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`; // Keep 'challenge:' for backwards compat
        const data = await redis.hgetall(key);

        // Battle not found
        if (!data || Object.keys(data).length === 0) {
            return null;
        }

        // Parse data from Redis (all values are strings)
        const battle = {
            challengeId: battleId,
            creatorScore: parseFloat(data.creatorScore),
            creatorId: data.creatorId || null,
            creatorThumb: data.creatorThumb || null,
            responderScore: data.responderScore ? parseFloat(data.responderScore) : null,
            responderId: data.responderId || null,
            responderThumb: data.responderThumb || null,
            mode: data.mode || 'nice',
            status: data.status,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt || null,
            // AI Commentary (populated by auto-compare after battle completes)
            battleCommentary: data.battleCommentary || null,
            winningFactor: data.winningFactor || null,
            outfit1Verdict: data.outfit1Verdict || null,
            outfit2Verdict: data.outfit2Verdict || null
        };

        // Check if battle has expired
        if (battle.expiresAt && new Date(battle.expiresAt) < new Date()) {
            if (!includeExpired) {
                return null; // Return null for expired battles
            }
            // Update status to expired
            await redis.hset(key, 'status', 'expired');
            battle.status = 'expired';
        }

        return battle;
    } else {
        // In-memory fallback
        const stored = inMemoryStore.get(battleId);
        if (!stored) return null;

        // Check expiration
        if (new Date(stored.expiresAt) < new Date()) {
            if (!includeExpired) {
                return null; // Return null for expired battles
            }
            stored.status = 'expired';
        }

        return {
            challengeId: battleId,
            creatorScore: stored.creatorScore,
            creatorId: stored.creatorId || null,
            creatorThumb: stored.creatorThumb || null,
            responderScore: stored.responderScore || null,
            responderId: stored.responderId || null,
            responderThumb: stored.responderThumb || null,
            mode: stored.mode || 'nice',
            status: stored.status,
            createdAt: stored.createdAt,
            expiresAt: stored.expiresAt,
            // AI Commentary (in-memory fallback - may not be populated)
            battleCommentary: stored.battleCommentary || null,
            winningFactor: stored.winningFactor || null,
            outfit1Verdict: stored.outfit1Verdict || null,
            outfit2Verdict: stored.outfit2Verdict || null
        };
    }
}

/**
 * Submit responder's score and determine winner
 * @param {string} battleId - Battle ID
 * @param {number} responderScore - Responder's outfit score (0.0-100.0)
 * @param {string} responderId - User ID of the responder
 * @param {string} responderThumb - Base64 thumbnail of responder's outfit (optional)
 * @returns {Object} Full battle object with updated data
 */
export async function respondToBattle(battleId, responderScore, responderId, responderThumb = null) {
    // Validate score
    if (typeof responderScore !== 'number' || responderScore < 0 || responderScore > 100) {
        throw new Error('Score must be between 0 and 100');
    }

    // Validate responderId
    if (!responderId || typeof responderId !== 'string') {
        throw new Error('responderId is required');
    }

    // Get existing battle (including expired for proper error messaging)
    const battle = await getBattle(battleId, true);
    if (!battle) {
        throw new Error('Battle not found');
    }

    // Check if expired
    if (battle.status === 'expired' || (battle.expiresAt && new Date(battle.expiresAt) < new Date())) {
        throw new Error('Battle expired');
    }

    // Check if already completed
    if (battle.status === 'completed') {
        throw new Error('Battle already completed');
    }

    const roundedResponderScore = parseFloat(responderScore.toFixed(2));

    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`; // Keep 'challenge:' for backwards compat

        // Update battle with response
        const updateData = {
            responderScore: roundedResponderScore,
            responderId: responderId,
            status: 'completed'
        };

        // Only store thumb if provided
        if (responderThumb) {
            updateData.responderThumb = responderThumb;
        }

        await redis.hset(key, updateData);

        // Reduce TTL to 1 hour after completion (saves storage - photos get cleaned up faster)
        await redis.expire(key, 3600); // 1 hour
    } else {
        // In-memory fallback
        const stored = inMemoryStore.get(battleId);
        if (stored) {
            stored.responderScore = roundedResponderScore;
            stored.responderId = responderId;
            stored.responderThumb = responderThumb || null;
            stored.status = 'completed';
            // Update expiry to 1 hour from now
            stored.expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        }
    }

    // ====================================================
    // AUTO-COMPARE: Get AI commentary for battle results
    // Runs in background - doesn't block response
    // ====================================================
    const creatorImage = battle.creatorThumb;
    const responderImage = responderThumb;

    // Only run comparative analysis if both images exist
    if (creatorImage && responderImage) {
        // Run async - don't await, let it complete in background
        (async () => {
            try {
                console.log(`[Battle] Running comparative analysis for ${battleId}`);
                const compareResult = await compareBattleOutfits(creatorImage, responderImage, { mode: battle.mode });

                if (compareResult.success && compareResult.battle) {
                    const commentary = {
                        battleCommentary: compareResult.battle.battleCommentary,
                        winningFactor: compareResult.battle.winningFactor,
                        outfit1Verdict: compareResult.battle.outfit1Verdict,
                        outfit2Verdict: compareResult.battle.outfit2Verdict,
                        aiWinner: compareResult.battle.winner,
                        marginOfVictory: compareResult.battle.marginOfVictory
                    };

                    // Store commentary in Redis
                    if (isRedisAvailable()) {
                        const key = `challenge:${battleId}`;
                        await redis.hset(key, {
                            battleCommentary: commentary.battleCommentary || '',
                            winningFactor: commentary.winningFactor || '',
                            outfit1Verdict: commentary.outfit1Verdict || '',
                            outfit2Verdict: commentary.outfit2Verdict || ''
                        });
                        console.log(`[Battle] ✅ AI commentary saved for ${battleId}`);
                    }
                }
            } catch (err) {
                console.warn(`[Battle] Comparative analysis failed for ${battleId}:`, err.message);
                // Non-blocking - battle still works without commentary
            }
        })();
    }

    // Return full battle object
    return {
        challengeId: battleId,
        creatorScore: battle.creatorScore,
        creatorId: battle.creatorId,
        creatorThumb: battle.creatorThumb,
        responderScore: roundedResponderScore,
        responderId: responderId,
        responderThumb: responderThumb || null,
        mode: battle.mode,
        status: 'completed',
        createdAt: battle.createdAt,
        expiresAt: battle.expiresAt
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
