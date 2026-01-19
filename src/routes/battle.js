/**
 * Battle Routes
 * 1v1 outfit battle rooms where two users compare scores
 *
 * Endpoints:
 * - POST   /api/battle               - Create new battle
 * - GET    /api/battle/:id           - Get battle data
 * - POST   /api/battle/:id/join      - Mark opponent joined (for realtime updates)
 * - POST   /api/battle/:id/respond   - Submit responder score
 * - DELETE /api/battle/:id           - Delete/dismiss battle from user's view
 * - POST   /api/battle/:id/compare   - Compare both outfits head-to-head
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    createBattle,
    getBattle,
    respondToBattle,
    joinBattle,
    deleteBattle,
    BATTLE_STATES,
    logBattleEvent
} from '../services/battleService.js';
import { compareBattleOutfits } from '../services/battleAnalyzer.js';
import { PushService } from '../services/pushService.js';

const router = express.Router();

// Rate limiter for battle creation (prevent spam)
const createLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 battles per minute
    message: {
        error: 'Too many battles created. Please wait a moment.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for battle responses (prevent spam)
const respondLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 responses per minute
    message: {
        error: 'Too many requests. Please wait a moment.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for getting battle data (prevent abuse)
const getLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 checks per minute
    message: {
        error: 'Too many requests. Please wait a moment.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * POST /api/battle
 * Create a new battle
 */
router.post('/', createLimiter, async (req, res) => {
    const requestId = `battle_create_${Date.now()}`;

    try {
        console.log(`[${requestId}] POST /api/battle - Creating new battle`);
        const { creatorScore, creatorId, mode, creatorThumb } = req.body;

        // Validate creatorScore
        if (creatorScore === undefined || creatorScore === null) {
            console.log(`[${requestId}] Error: No creatorScore provided`);
            return res.status(400).json({
                error: 'creatorScore is required'
            });
        }

        // Validate creatorId
        if (!creatorId || typeof creatorId !== 'string') {
            console.log(`[${requestId}] Error: No creatorId provided`);
            return res.status(400).json({
                error: 'creatorId is required'
            });
        }

        // Validate score range
        const score = parseFloat(creatorScore);
        if (isNaN(score) || score < 0 || score > 100) {
            console.log(`[${requestId}] Error: Invalid score - ${creatorScore}`);
            return res.status(400).json({
                error: 'Score must be between 0 and 100'
            });
        }

        // ============================================
        // CONTENT MODERATION: Reject battles from flagged content
        // AI flags nudity, shirtless, underwear-only, etc. as contentFlagged: true
        // ============================================
        const { contentFlagged } = req.body;
        if (contentFlagged === true) {
            console.warn(`[${requestId}] 🚫 BLOCKED: Attempt to create battle with flagged content (creatorId: ${creatorId?.slice(0, 12)}...)`);
            return res.status(400).json({
                error: 'This image cannot be used for battles due to content policy.',
                code: 'CONTENT_FLAGGED'
            });
        }

        // Create battle with creatorId, mode and photo
        const battle = await createBattle(score, creatorId, mode || 'nice', creatorThumb || null);
        console.log(`[${requestId}] ✅ Battle created: ${battle.challengeId} (mode: ${battle.mode})`);

        return res.status(201).json({
            challengeId: battle.challengeId,
            creatorScore: battle.creatorScore,
            creatorId: battle.creatorId,
            mode: battle.mode,
            status: battle.status,
            createdAt: battle.createdAt,
            expiresAt: battle.expiresAt
        });
    } catch (error) {
        console.error(`[${requestId}] Error creating battle:`, error.message);
        return res.status(500).json({
            error: 'Failed to create battle. Please try again.'
        });
    }
});

/**
 * GET /api/battle/:battleId
 * Get battle data for display
 */
router.get('/:battleId', getLimiter, async (req, res) => {
    const { battleId } = req.params;
    const requestId = `battle_get_${Date.now()}`;

    try {
        console.log(`[${requestId}] GET /api/battle/${battleId}`);

        // Validate battleId format (still uses ch_ prefix for backwards compat)
        if (!battleId || !battleId.startsWith('ch_')) {
            console.log(`[${requestId}] Error: Invalid battle ID format - ${battleId}`);
            return res.status(404).json({
                error: true,
                code: 'BATTLE_NOT_FOUND',
                message: 'Battle not found'
            });
        }

        // Get battle (expired battles return null)
        const battle = await getBattle(battleId);

        if (!battle) {
            console.log(`[${requestId}] Battle not found or expired: ${battleId}`);
            return res.status(404).json({
                error: true,
                code: 'BATTLE_NOT_FOUND',
                message: 'Battle not found or expired'
            });
        }

        // Use the winner from the battle object (determined by head-to-head comparison)
        // This prevents ties by using AI comparative analysis
        const winner = battle.winner || null;

        // Return battle data in new format
        console.log(`[${requestId}] ✅ Battle found: ${battleId} (status: ${battle.status}, winner: ${winner})`);
        return res.status(200).json({
            battleId: battle.challengeId,
            status: battle.status,
            mode: battle.mode,
            createdAt: battle.createdAt,
            creator: {
                userId: battle.creatorId,
                score: battle.creatorScore,
                thumb: battle.creatorThumb,
                verdict: battle.outfit1Verdict
            },
            opponent: battle.responderId ? {
                userId: battle.responderId,
                score: battle.responderScore,
                thumb: battle.responderThumb,
                verdict: battle.outfit2Verdict
            } : null,
            winner: winner,
            creatorId: battle.creatorId,
            // Include battle commentary from head-to-head comparison
            battleCommentary: battle.battleCommentary,
            winningFactor: battle.winningFactor,
            marginOfVictory: battle.marginOfVictory
        });
    } catch (error) {
        console.error(`[${requestId}] Error getting battle:`, error.message);
        return res.status(500).json({
            error: true,
            code: 'INTERNAL_ERROR',
            message: 'Failed to get battle. Please try again.'
        });
    }
});

/**
 * POST /api/battle/:battleId/respond
 * Submit the responder's score
 */
router.post('/:battleId/respond', respondLimiter, async (req, res) => {
    const { battleId } = req.params;
    const requestId = `battle_respond_${Date.now()}`;

    try {
        console.log(`[${requestId}] POST /api/battle/${battleId}/respond`);
        const { responderScore, responderId, responderThumb } = req.body;

        // Validate battleId format (still uses ch_ prefix for backwards compat)
        if (!battleId || !battleId.startsWith('ch_')) {
            console.log(`[${requestId}] Error: Invalid battle ID format - ${battleId}`);
            return res.status(400).json({
                error: 'Invalid battle ID'
            });
        }

        // Validate responderScore
        if (responderScore === undefined || responderScore === null) {
            console.log(`[${requestId}] Error: No responderScore provided`);
            return res.status(400).json({
                error: 'responderScore is required'
            });
        }

        // Validate responderId
        if (!responderId || typeof responderId !== 'string') {
            console.log(`[${requestId}] Error: No responderId provided`);
            return res.status(400).json({
                error: 'responderId is required'
            });
        }

        // Validate score range
        const score = parseFloat(responderScore);
        if (isNaN(score) || score < 0 || score > 100) {
            console.log(`[${requestId}] Error: Invalid score - ${responderScore}`);
            return res.status(400).json({
                error: 'Score must be between 0 and 100'
            });
        }

        // ============================================
        // CONTENT MODERATION: Reject battle responses from flagged content
        // AI flags nudity, shirtless, underwear-only, etc. as contentFlagged: true
        // ============================================
        const { contentFlagged } = req.body;
        if (contentFlagged === true) {
            console.warn(`[${requestId}] 🚫 BLOCKED: Attempt to respond to battle with flagged content (responderId: ${responderId?.slice(0, 12)}...)`);
            return res.status(400).json({
                error: 'This image cannot be used for battles due to content policy.',
                code: 'CONTENT_FLAGGED'
            });
        }

        // Submit response with responderId and photo
        const result = await respondToBattle(battleId, score, responderId, responderThumb || null);
        console.log(`[${requestId}] ✅ Response recorded: ${battleId} - status: completed`);

        // PUSH NOTIFICATION: Notify the battle creator that someone responded
        // This is non-blocking - we don't wait for push to complete
        if (result.creatorId) {
            const winnerEmoji = result.winner === 'creator' ? '👑' : result.winner === 'responder' ? '😅' : '⚔️';
            const winnerText = result.winner === 'creator' ? 'You won!' : result.winner === 'responder' ? 'They beat you!' : 'Battle complete!';

            PushService.sendNotification(result.creatorId, {
                title: `${winnerEmoji} Battle Results Are In!`,
                body: `Someone accepted your challenge! ${winnerText}`,
                data: {
                    type: 'battle_response',
                    battleId,
                    winner: result.winner
                }
            }).catch(err => console.log(`[${requestId}] Push notification failed (non-blocking):`, err.message));
        }

        return res.status(200).json(result);
    } catch (error) {
        console.error(`[${requestId}] Error responding to battle:`, error.message);

        // Handle specific error cases
        if (error.message === 'Battle not found') {
            return res.status(404).json({
                error: 'Battle not found or expired'
            });
        }

        if (error.message === 'Battle expired') {
            return res.status(404).json({
                error: 'Battle not found or expired'
            });
        }

        if (error.message === 'Battle already completed') {
            return res.status(400).json({
                error: 'Battle already completed'
            });
        }

        if (error.message === 'Score must be between 0 and 100') {
            return res.status(400).json({
                error: 'Score must be between 0 and 100'
            });
        }

        if (error.message === 'responderId is required') {
            return res.status(400).json({
                error: 'responderId is required'
            });
        }

        return res.status(500).json({
            error: 'Failed to respond to battle. Please try again.'
        });
    }
});

/**
 * POST /api/battle/:battleId/compare
 * Compare both outfits head-to-head using AI (recommended for final battle result)
 * This endpoint requires both images and compares them simultaneously
 */
router.post('/:battleId/compare', respondLimiter, async (req, res) => {
    const { battleId } = req.params;
    const requestId = `battle_compare_${Date.now()}`;

    try {
        console.log(`[${requestId}] POST /api/battle/${battleId}/compare`);
        const { image1, image2, mode } = req.body;

        // Validate battleId format
        if (!battleId || !battleId.startsWith('ch_')) {
            return res.status(400).json({
                error: 'Invalid battle ID'
            });
        }

        // Validate both images are provided
        if (!image1 || !image2) {
            return res.status(400).json({
                error: 'Both outfit images (image1 and image2) are required for comparison'
            });
        }

        // Get battle to verify it exists
        const battle = await getBattle(battleId, true);
        if (!battle) {
            return res.status(404).json({
                error: 'Battle not found or expired'
            });
        }

        // Use battle's mode if not specified
        const battleMode = mode || battle.mode || 'nice';

        // Run comparative analysis
        const result = await compareBattleOutfits(image1, image2, { mode: battleMode });

        if (!result.success) {
            console.error(`[${requestId}] Comparison failed:`, result.error);
            return res.status(500).json({
                error: result.error || 'Failed to compare outfits'
            });
        }

        console.log(`[${requestId}] ⚔️ Battle comparison complete - Winner: Outfit ${result.battle.winner}`);

        return res.status(200).json({
            battleId,
            success: true,
            ...result.battle
        });
    } catch (error) {
        console.error(`[${requestId}] Error comparing battle:`, error.message);
        return res.status(500).json({
            error: 'Failed to compare outfits. Please try again.'
        });
    }
    /**
     * POST /api/battle/:battleId/join
     * Mark opponent as joined (called when they open the battle link)
     * Allows creator to see "Opponent joined!" in realtime
     */
    router.post('/:battleId/join', getLimiter, async (req, res) => {
        const { battleId } = req.params;
        const requestId = `battle_join_${Date.now()}`;

        try {
            console.log(`[${requestId}] POST /api/battle/${battleId}/join`);
            const { userId } = req.body;

            if (!userId) {
                return res.status(400).json({
                    error: 'userId is required'
                });
            }

            // Validate battleId format
            if (!battleId || !battleId.startsWith('ch_')) {
                return res.status(404).json({
                    error: true,
                    code: 'BATTLE_NOT_FOUND',
                    message: 'Battle not found'
                });
            }

            const battle = await joinBattle(battleId, userId);
            console.log(`[${requestId}] ✅ User ${userId.slice(0, 12)}... joined battle ${battleId}`);

            // Notify creator that opponent joined (non-blocking)
            if (battle.creatorId && battle.creatorId !== userId) {
                PushService.sendNotification(battle.creatorId, {
                    title: '⚔️ Opponent Joined!',
                    body: 'Someone opened your battle link - they\'re taking their photo now!',
                    data: {
                        type: 'battle_joined',
                        battleId,
                        responderId: userId
                    }
                }).catch(err => console.log(`[${requestId}] Push notification failed (non-blocking):`, err.message));
            }

            return res.status(200).json({
                battleId: battle.challengeId,
                status: battle.status,
                joined: true,
                mode: battle.mode,
                creatorId: battle.creatorId,
                creatorScore: battle.creatorScore,
                creatorThumb: battle.creatorThumb,
                expiresAt: battle.expiresAt
            });
        } catch (error) {
            console.error(`[${requestId}] Error joining battle:`, error.message);

            if (error.message === 'Battle not found') {
                return res.status(404).json({ error: 'Battle not found or expired', code: 'BATTLE_NOT_FOUND' });
            }
            if (error.message === 'Battle expired') {
                return res.status(404).json({ error: 'Battle has expired', code: 'BATTLE_EXPIRED' });
            }
            if (error.message === 'This battle already has an opponent') {
                return res.status(409).json({ error: 'This battle already has an opponent', code: 'ALREADY_HAS_OPPONENT' });
            }

            return res.status(500).json({ error: 'Failed to join battle. Please try again.' });
        }
    });

    /**
     * DELETE /api/battle/:battleId
     * Delete/dismiss a battle from user's view
     * Warns user that battle will be gone and they should save screenshot if wanted
     */
    router.delete('/:battleId', getLimiter, async (req, res) => {
        const { battleId } = req.params;
        const requestId = `battle_delete_${Date.now()}`;

        try {
            console.log(`[${requestId}] DELETE /api/battle/${battleId}`);
            const { userId } = req.body;

            if (!userId) {
                return res.status(400).json({
                    error: 'userId is required'
                });
            }

            // Validate battleId format
            if (!battleId || !battleId.startsWith('ch_')) {
                return res.status(404).json({
                    error: true,
                    code: 'BATTLE_NOT_FOUND',
                    message: 'Battle not found'
                });
            }

            const result = await deleteBattle(battleId, userId);
            console.log(`[${requestId}] ✅ Battle ${battleId} deleted by user ${userId.slice(0, 12)}...`);

            return res.status(200).json(result);
        } catch (error) {
            console.error(`[${requestId}] Error deleting battle:`, error.message);

            if (error.message === 'You can only delete your own battles') {
                return res.status(403).json({ error: 'You can only delete your own battles', code: 'UNAUTHORIZED' });
            }

            return res.status(500).json({ error: 'Failed to delete battle. Please try again.' });
        }
    });

    export default router;
