/**
 * Battle Routes
 * 1v1 outfit battle rooms where two users compare scores
 *
 * Endpoints:
 * - POST   /api/battle          - Create new battle
 * - GET    /api/battle/:id      - Get battle data
 * - POST   /api/battle/:id/respond - Submit responder score
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    createBattle,
    getBattle,
    respondToBattle
} from '../services/battleService.js';

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

        // Determine winner
        let winner = null;
        if (battle.status === 'completed' && battle.responderScore !== null) {
            if (battle.creatorScore > battle.responderScore) {
                winner = 'creator';
            } else if (battle.responderScore > battle.creatorScore) {
                winner = 'opponent';
            } else {
                winner = 'tie';
            }
        }

        // Return battle data in new format
        console.log(`[${requestId}] ✅ Battle found: ${battleId} (status: ${battle.status})`);
        return res.status(200).json({
            battleId: battle.challengeId,
            status: battle.status,
            mode: battle.mode,
            createdAt: battle.createdAt,
            creator: {
                userId: battle.creatorId,
                score: battle.creatorScore,
                thumb: battle.creatorThumb
            },
            opponent: battle.responderId ? {
                userId: battle.responderId,
                score: battle.responderScore,
                thumb: battle.responderThumb
            } : null,
            winner: winner,
            creatorId: battle.creatorId
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

        // Submit response with responderId and photo
        const result = await respondToBattle(battleId, score, responderId, responderThumb || null);
        console.log(`[${requestId}] ✅ Response recorded: ${battleId} - status: completed`);

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

export default router;
