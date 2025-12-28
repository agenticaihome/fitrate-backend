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
        // Use comparative scores if available (from head-to-head comparison)
        const creatorScore = data.comparativeCreatorScore
            ? parseFloat(data.comparativeCreatorScore)
            : parseFloat(data.creatorScore);
        const responderScore = data.comparativeResponderScore
            ? parseFloat(data.comparativeResponderScore)
            : (data.responderScore ? parseFloat(data.responderScore) : null);

        // Determine winner from stored value or calculate it
        let winner = data.winner || null;
        if (!winner && data.status === 'completed' && responderScore !== null) {
            if (creatorScore > responderScore) {
                winner = 'creator';
            } else if (responderScore > creatorScore) {
                winner = 'opponent';
            } else {
                winner = 'tie';
            }
        }

        const battle = {
            challengeId: battleId,
            creatorScore: creatorScore,
            creatorId: data.creatorId || null,
            creatorThumb: data.creatorThumb || null,
            responderScore: responderScore,
            responderId: data.responderId || null,
            responderThumb: data.responderThumb || null,
            mode: data.mode || 'nice',
            status: data.status,
            winner: winner,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt || null,
            // AI Commentary (populated by head-to-head comparison)
            battleCommentary: data.battleCommentary || null,
            winningFactor: data.winningFactor || null,
            outfit1Verdict: data.outfit1Verdict || null,
            outfit2Verdict: data.outfit2Verdict || null,
            marginOfVictory: data.marginOfVictory ? parseFloat(data.marginOfVictory) : null
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

        // Determine winner for in-memory stored battles
        let winner = stored.winner || null;
        if (!winner && stored.status === 'completed' && stored.responderScore !== null) {
            if (stored.creatorScore > stored.responderScore) {
                winner = 'creator';
            } else if (stored.responderScore > stored.creatorScore) {
                winner = 'opponent';
            } else {
                winner = 'tie';
            }
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
            winner: winner,
            createdAt: stored.createdAt,
            expiresAt: stored.expiresAt,
            // AI Commentary (in-memory fallback - may not be populated)
            battleCommentary: stored.battleCommentary || null,
            winningFactor: stored.winningFactor || null,
            outfit1Verdict: stored.outfit1Verdict || null,
            outfit2Verdict: stored.outfit2Verdict || null,
            marginOfVictory: stored.marginOfVictory || null
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
    // COMPARATIVE ANALYSIS: Head-to-head outfit comparison
    // This PREVENTS TIES by comparing outfits directly against each other
    // The AI picks a winner with at least 3+ point gap
    // ====================================================
    const creatorImage = battle.creatorThumb;
    const responderImage = responderThumb;

    let finalCreatorScore = battle.creatorScore;
    let finalResponderScore = roundedResponderScore;
    let aiDeterminedWinner = null;  // 'creator', 'opponent', or 'tie'
    let battleCommentary = null;
    let winningFactor = null;
    let outfit1Verdict = null;
    let outfit2Verdict = null;
    let marginOfVictory = null;

    // Run comparative analysis if both images exist
    // This is the KEY to preventing ties - we compare both outfits head-to-head
    if (creatorImage && responderImage) {
        try {
            console.log(`[Battle] Running head-to-head comparison for ${battleId} (mode: ${battle.mode})`);
            const compareResult = await compareBattleOutfits(creatorImage, responderImage, { mode: battle.mode });

            if (compareResult.success && compareResult.battle) {
                const comparison = compareResult.battle;

                // Store comparison results
                battleCommentary = comparison.battleCommentary;
                winningFactor = comparison.winningFactor;
                outfit1Verdict = comparison.outfit1Verdict;
                outfit2Verdict = comparison.outfit2Verdict;
                marginOfVictory = comparison.marginOfVictory;

                // Use the AI's head-to-head comparison to determine winner
                // This is MORE accurate than comparing independently-scored outfits
                if (comparison.winner === 1) {
                    aiDeterminedWinner = 'creator';
                    // Use the AI's comparative scores - they have at least 3+ point gap
                    finalCreatorScore = comparison.outfit1Score;
                    finalResponderScore = comparison.outfit2Score;
                    console.log(`[Battle] ⚔️ AI picks CREATOR (${comparison.outfit1Score} vs ${comparison.outfit2Score}, margin: ${marginOfVictory})`);
                } else if (comparison.winner === 2) {
                    aiDeterminedWinner = 'opponent';
                    finalCreatorScore = comparison.outfit1Score;
                    finalResponderScore = comparison.outfit2Score;
                    console.log(`[Battle] ⚔️ AI picks OPPONENT (${comparison.outfit1Score} vs ${comparison.outfit2Score}, margin: ${marginOfVictory})`);
                } else {
                    // AI says tie (extremely rare - outfits nearly identical)
                    aiDeterminedWinner = 'tie';
                    console.log(`[Battle] ⚔️ AI declares TRUE TIE (${comparison.outfit1Score} vs ${comparison.outfit2Score})`);
                }

                // Update Redis with comparison results AND the AI-determined scores
                if (isRedisAvailable()) {
                    const key = `challenge:${battleId}`;
                    await redis.hset(key, {
                        battleCommentary: battleCommentary || '',
                        winningFactor: winningFactor || '',
                        outfit1Verdict: outfit1Verdict || '',
                        outfit2Verdict: outfit2Verdict || '',
                        aiWinner: String(comparison.winner),
                        marginOfVictory: String(marginOfVictory || 0),
                        // Store the head-to-head comparative scores
                        comparativeCreatorScore: String(finalCreatorScore),
                        comparativeResponderScore: String(finalResponderScore)
                    });
                    console.log(`[Battle] ✅ Head-to-head results saved for ${battleId}`);
                }
            }
        } catch (err) {
            console.warn(`[Battle] Head-to-head comparison failed for ${battleId}:`, err.message);
            // Fall back to original scores if comparison fails
            aiDeterminedWinner = null;
        }
    }

    // Determine final winner
    // Priority: Use AI head-to-head winner if available (prevents ties!)
    // Fallback: Use original independent scores
    let winner;
    if (aiDeterminedWinner) {
        winner = aiDeterminedWinner;
    } else {
        // Fallback to original score comparison (may result in ties)
        if (battle.creatorScore > roundedResponderScore) {
            winner = 'creator';
        } else if (roundedResponderScore > battle.creatorScore) {
            winner = 'opponent';
        } else {
            winner = 'tie';
        }
    }

    // Store the final winner in Redis
    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`;
        await redis.hset(key, { winner: winner });
    }

    // Return full battle object with comparative scores and winner
    return {
        challengeId: battleId,
        creatorScore: finalCreatorScore,  // Use comparative score if available
        creatorId: battle.creatorId,
        creatorThumb: battle.creatorThumb,
        responderScore: finalResponderScore,  // Use comparative score if available
        responderId: responderId,
        responderThumb: responderThumb || null,
        mode: battle.mode,
        status: 'completed',
        winner: winner,
        createdAt: battle.createdAt,
        expiresAt: battle.expiresAt,
        // Include battle commentary
        battleCommentary: battleCommentary,
        winningFactor: winningFactor,
        outfit1Verdict: outfit1Verdict,
        outfit2Verdict: outfit2Verdict,
        marginOfVictory: marginOfVictory
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
