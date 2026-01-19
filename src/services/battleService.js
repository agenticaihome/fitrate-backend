/**
 * Battle Service
 * Handles 1v1 outfit battle rooms where two users compare scores
 *
 * State Machine:
 * CREATED → JOINED → JUDGING → COMPLETED
 *    ↓         ↓         ↓         ↓
 * EXPIRED  EXPIRED  ERROR    (terminal)
 *
 * Redis Data Structure:
 * - Key: `challenge:{battleId}` (hash) - keeping 'challenge:' prefix for backwards compat
 * - TTL: 24 hours (auto-expires)
 */

import { redis, isRedisAvailable } from './redisClient.js';
import crypto from 'crypto';
import { compareBattleOutfits } from './battleAnalyzer.js';

// ============================================
// BATTLE STATE MACHINE
// ============================================
export const BATTLE_STATES = {
    CREATED: 'created',      // Battle created, waiting for opponent to open link
    JOINED: 'joined',        // Opponent opened link but hasn't submitted yet
    JUDGING: 'judging',      // Both submitted, AI comparison in progress
    COMPLETED: 'completed',  // Winner determined
    EXPIRED: 'expired',      // TTL exceeded
    CANCELLED: 'cancelled',  // Creator cancelled
    ERROR: 'error'           // Something went wrong
};

// Backwards compatibility: map old 'waiting' status to new states
const normalizeStatus = (status) => {
    if (status === 'waiting') return BATTLE_STATES.CREATED;
    return status;
};

// ============================================
// STRUCTURED LOGGING
// ============================================
export const logBattleEvent = (event, battleId, data = {}) => {
    const logEntry = {
        timestamp: new Date().toISOString(),
        service: 'battle',
        event,
        battleId,
        ...data
    };
    console.log(`[Battle] ${event}:`, JSON.stringify(logEntry));
};

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
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours total expiry
    const forfeitAt = new Date(now.getTime() + 6 * 60 * 60 * 1000);  // P2.5: 6 hours for auto-forfeit

    const battleData = {
        id: battleId,
        creatorScore: parseFloat(creatorScore.toFixed(2)),
        creatorId: creatorId,
        responderScore: null,
        responderId: null,
        mode: mode || 'nice',  // AI mode for both players
        creatorThumb: creatorThumb || null,  // Creator's outfit photo
        responderThumb: null,
        status: BATTLE_STATES.CREATED,  // Use new state machine
        winner: null,
        createdAt: now.toISOString(),
        respondedAt: null,
        expiresAt: expiresAt.toISOString(),
        forfeitAt: forfeitAt.toISOString()  // P2.5: Auto-win if no response
    };

    logBattleEvent('battle_created', battleId, { creatorId, mode, creatorScore: battleData.creatorScore });

    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`; // Keep 'challenge:' for backwards compat

        // Store as Redis hash
        const hashData = {
            creatorScore: battleData.creatorScore,
            creatorId: battleData.creatorId,
            mode: battleData.mode,
            status: battleData.status,
            createdAt: battleData.createdAt,
            expiresAt: battleData.expiresAt,
            forfeitAt: battleData.forfeitAt  // P2.5: 6h auto-forfeit
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
        expiresAt: battleData.expiresAt,
        forfeitAt: battleData.forfeitAt  // P2.5: 6h auto-forfeit
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
        // Store BOTH original and comparative scores to prevent user confusion
        // Original = what user saw when they first scanned
        // Comparative = head-to-head comparison score (used for winner determination)
        const originalCreatorScore = parseFloat(data.creatorScore);
        const originalResponderScore = data.responderScore ? parseFloat(data.responderScore) : null;

        // Comparative scores from head-to-head (may differ from original)
        const comparativeCreatorScore = data.comparativeCreatorScore
            ? parseFloat(data.comparativeCreatorScore)
            : originalCreatorScore;
        const comparativeResponderScore = data.comparativeResponderScore
            ? parseFloat(data.comparativeResponderScore)
            : originalResponderScore;

        // For winner determination, use comparative scores
        const creatorScore = comparativeCreatorScore;
        const responderScore = comparativeResponderScore;

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
            // Comparative scores (used for winner determination)
            creatorScore: creatorScore,
            responderScore: responderScore,
            // Original scores (what users saw when they first scanned)
            // Frontend should display: "Your original score: 53 → Battle score: 67"
            originalCreatorScore: originalCreatorScore,
            originalResponderScore: originalResponderScore,
            // Flag to indicate if scores were recalculated in head-to-head
            scoresRecalculated: data.comparativeCreatorScore ? true : false,
            creatorId: data.creatorId || null,
            creatorThumb: data.creatorThumb || null,
            responderId: data.responderId || null,
            responderThumb: data.responderThumb || null,
            mode: data.mode || 'nice',
            status: data.status,
            winner: winner,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt || null,
            forfeitAt: data.forfeitAt || null,  // P2.5: 6h auto-forfeit timestamp
            // AI Commentary (populated by head-to-head comparison)
            battleCommentary: data.battleCommentary || null,
            winningFactor: data.winningFactor || null,
            outfit1Verdict: data.outfit1Verdict || null,
            outfit2Verdict: data.outfit2Verdict || null,
            marginOfVictory: data.marginOfVictory ? parseFloat(data.marginOfVictory) : null
        };

        // P2.5: Check for auto-forfeit (6 hours with no response)
        // If battle is still 'waiting' and forfeit time has passed, auto-complete with creator win
        if (battle.status === 'waiting' && battle.forfeitAt && new Date(battle.forfeitAt) < new Date()) {
            console.log(`[Battle] ⏰ Auto-forfeit triggered for ${battleId} - no response in 6 hours`);
            await redis.hset(key, {
                status: 'completed',
                winner: 'creator',
                responderScore: '0',
                responderId: 'forfeited',
                battleCommentary: 'Opponent didn\'t show up in time - you win by forfeit! 🏆'
            });
            battle.status = 'completed';
            battle.winner = 'creator';
            battle.responderScore = 0;
            battle.responderId = 'forfeited';
            battle.battleCommentary = 'Opponent didn\'t show up in time - you win by forfeit! 🏆';
        }

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
            // Comparative scores (used for winner determination)
            creatorScore: stored.comparativeCreatorScore || stored.creatorScore,
            responderScore: stored.comparativeResponderScore || stored.responderScore || null,
            // Original scores (what users saw when they first scanned)
            originalCreatorScore: stored.creatorScore,
            originalResponderScore: stored.responderScore || null,
            // Flag to indicate if scores were recalculated in head-to-head
            scoresRecalculated: stored.comparativeCreatorScore ? true : false,
            creatorId: stored.creatorId || null,
            creatorThumb: stored.creatorThumb || null,
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
        logBattleEvent('battle_respond_failed', battleId, { reason: 'not_found', responderId });
        throw new Error('Battle not found');
    }

    // Check if expired
    const normalizedStatus = normalizeStatus(battle.status);
    if (normalizedStatus === BATTLE_STATES.EXPIRED || (battle.expiresAt && new Date(battle.expiresAt) < new Date())) {
        logBattleEvent('battle_respond_failed', battleId, { reason: 'expired', responderId });
        throw new Error('Battle expired');
    }

    // ============================================
    // IDEMPOTENCY CHECK: Handle re-submissions
    // ============================================
    if (normalizedStatus === BATTLE_STATES.COMPLETED || normalizedStatus === BATTLE_STATES.JUDGING) {
        // Already completed - check if same user (idempotent return)
        if (battle.responderId === responderId) {
            logBattleEvent('battle_respond_idempotent', battleId, { responderId, message: 'Same user re-submitted, returning existing result' });
            return battle; // Return existing completed battle (idempotent)
        }
        // Different user trying to respond to completed battle
        logBattleEvent('battle_respond_failed', battleId, { reason: 'already_completed', responderId, existingResponderId: battle.responderId });
        throw new Error('Battle already completed');
    }

    // Check if another user already joined but hasn't submitted (JOINED state)
    if (battle.responderId && battle.responderId !== responderId) {
        logBattleEvent('battle_respond_failed', battleId, { reason: 'different_opponent', responderId, existingResponderId: battle.responderId });
        throw new Error('Another user is already responding to this battle');
    }

    // Prevent creator from responding to their own battle
    if (battle.creatorId === responderId) {
        logBattleEvent('battle_respond_failed', battleId, { reason: 'creator_self_respond', responderId });
        throw new Error('Cannot respond to your own battle');
    }

    const roundedResponderScore = parseFloat(responderScore.toFixed(2));
    logBattleEvent('battle_respond_started', battleId, { responderId, responderScore: roundedResponderScore });

    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`; // Keep 'challenge:' for backwards compat

        // Set status to JUDGING first (before AI call)
        await redis.hset(key, { status: BATTLE_STATES.JUDGING });

        // Update battle with response
        const updateData = {
            responderScore: roundedResponderScore,
            responderId: responderId,
            status: BATTLE_STATES.JUDGING  // Will be updated to COMPLETED after AI judging
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

    // Store the final winner in Redis and set status to COMPLETED
    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`;
        await redis.hset(key, { winner: winner, status: BATTLE_STATES.COMPLETED });
    }

    logBattleEvent('battle_completed', battleId, { winner, creatorScore: finalCreatorScore, responderScore: finalResponderScore, marginOfVictory });

    // Return full battle object with BOTH original and comparative scores
    return {
        challengeId: battleId,
        // Comparative scores (used for winner determination)
        creatorScore: finalCreatorScore,
        responderScore: finalResponderScore,
        // Original scores (what users saw when they first scanned)
        originalCreatorScore: battle.creatorScore,
        originalResponderScore: roundedResponderScore,
        // Flag to indicate if scores were recalculated in head-to-head
        scoresRecalculated: aiDeterminedWinner !== null,
        creatorId: battle.creatorId,
        creatorThumb: battle.creatorThumb,
        responderId: responderId,
        responderThumb: responderThumb || null,
        mode: battle.mode,
        status: BATTLE_STATES.COMPLETED,
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

/**
 * Join a battle (called when opponent opens the link)
 * Marks the battle as JOINED so creator can see opponent arrived
 * @param {string} battleId - Battle ID
 * @param {string} userId - User ID of the person joining
 * @returns {Object} Updated battle data
 */
export async function joinBattle(battleId, userId) {
    if (!battleId || !battleId.startsWith('ch_')) {
        throw new Error('Invalid battle ID');
    }
    if (!userId || typeof userId !== 'string') {
        throw new Error('userId is required');
    }

    const battle = await getBattle(battleId, true);
    if (!battle) {
        logBattleEvent('battle_join_failed', battleId, { reason: 'not_found', userId });
        throw new Error('Battle not found');
    }

    // Check if expired
    const normalizedStatus = normalizeStatus(battle.status);
    if (normalizedStatus === BATTLE_STATES.EXPIRED || (battle.expiresAt && new Date(battle.expiresAt) < new Date())) {
        logBattleEvent('battle_join_failed', battleId, { reason: 'expired', userId });
        throw new Error('Battle expired');
    }

    // Creator opening their own battle is fine - just return current state
    if (battle.creatorId === userId) {
        logBattleEvent('battle_join_creator', battleId, { userId, message: 'Creator viewing own battle' });
        return battle;
    }

    // If battle is already completed/judging, return current state (idempotent)
    if (normalizedStatus === BATTLE_STATES.COMPLETED || normalizedStatus === BATTLE_STATES.JUDGING) {
        logBattleEvent('battle_join_already_done', battleId, { userId, status: normalizedStatus });
        return battle;
    }

    // If already joined by this user, return current state (idempotent)
    if (battle.responderId === userId) {
        logBattleEvent('battle_join_idempotent', battleId, { userId, message: 'Same user re-joined' });
        return battle;
    }

    // If already joined by DIFFERENT user, that's an error
    if (battle.responderId && battle.responderId !== userId) {
        logBattleEvent('battle_join_failed', battleId, { reason: 'already_has_opponent', userId, existingResponderId: battle.responderId });
        throw new Error('This battle already has an opponent');
    }

    // Mark as JOINED with this responderId
    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`;
        await redis.hset(key, {
            status: BATTLE_STATES.JOINED,
            responderId: userId,
            joinedAt: new Date().toISOString()
        });
    } else {
        const stored = inMemoryStore.get(battleId);
        if (stored) {
            stored.status = BATTLE_STATES.JOINED;
            stored.responderId = userId;
            stored.joinedAt = new Date().toISOString();
        }
    }

    logBattleEvent('battle_joined', battleId, { userId, creatorId: battle.creatorId });

    // Return updated battle
    return await getBattle(battleId);
}

/**
 * Delete a battle (user-initiated)
 * Users can dismiss battles from their screen before the 24h auto-expiry
 * @param {string} battleId - Battle ID
 * @param {string} userId - User ID requesting deletion
 * @param {boolean} isCreator - Whether the user is the creator
 * @returns {Object} Deletion result with warning
 */
export async function deleteBattle(battleId, userId) {
    if (!battleId || !battleId.startsWith('ch_')) {
        throw new Error('Invalid battle ID');
    }
    if (!userId || typeof userId !== 'string') {
        throw new Error('userId is required');
    }

    const battle = await getBattle(battleId, true);
    if (!battle) {
        // Already gone, that's fine
        return { success: true, message: 'Battle already deleted or expired' };
    }

    // Verify user is allowed to delete (creator or responder)
    const isCreator = battle.creatorId === userId;
    const isResponder = battle.responderId === userId;

    if (!isCreator && !isResponder) {
        logBattleEvent('battle_delete_failed', battleId, { reason: 'unauthorized', userId });
        throw new Error('You can only delete your own battles');
    }

    logBattleEvent('battle_deleted', battleId, { userId, isCreator, status: battle.status });

    // For Redis, we can delete the key entirely or just mark as cancelled
    // We'll mark as cancelled so it can still be retrieved briefly if needed
    if (isRedisAvailable()) {
        const key = `challenge:${battleId}`;
        // If creator deletes a waiting battle, cancel it
        if (isCreator && (battle.status === BATTLE_STATES.CREATED || battle.status === 'waiting')) {
            await redis.hset(key, { status: BATTLE_STATES.CANCELLED });
            await redis.expire(key, 300); // Expire in 5 minutes instead of waiting 24h
        } else {
            // For completed battles or responder deletion, just reduce TTL
            await redis.expire(key, 60); // Expire in 1 minute
        }
    } else {
        // In-memory: just delete
        inMemoryStore.delete(battleId);
    }

    return {
        success: true,
        message: isCreator && battle.status !== BATTLE_STATES.COMPLETED
            ? 'Battle cancelled - opponent will no longer be able to join'
            : 'Battle removed from your view',
        wasCompleted: battle.status === BATTLE_STATES.COMPLETED,
        // Include warning for UI
        warning: 'This battle will be permanently deleted. If you want to keep a record, save the screenshot first!'
    };
}
