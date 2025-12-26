/**
 * Challenge Party Routes
 * 1v1 outfit challenge rooms where two users compare scores
 *
 * Endpoints:
 * - POST   /api/challenges          - Create new challenge
 * - GET    /api/challenges/:id      - Get challenge data
 * - POST   /api/challenges/:id/respond - Submit responder score
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  createChallenge,
  getChallenge,
  respondToChallenge
} from '../services/challengePartyService.js';

const router = express.Router();

// Rate limiter for challenge creation (prevent spam)
const createLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 challenges per minute
  message: {
    error: 'Too many challenges created. Please wait a moment.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for challenge responses (prevent spam)
const respondLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 responses per minute
  message: {
    error: 'Too many requests. Please wait a moment.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for getting challenge data (prevent abuse)
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
 * POST /api/challenges
 * Create a new challenge party
 */
router.post('/', createLimiter, async (req, res) => {
  const requestId = `challenge_create_${Date.now()}`;

  try {
    console.log(`[${requestId}] POST /api/challenges - Creating new challenge`);
    const { creatorScore } = req.body;

    // Validate input
    if (creatorScore === undefined || creatorScore === null) {
      console.log(`[${requestId}] Error: No creatorScore provided`);
      return res.status(400).json({
        error: 'creatorScore is required'
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

    // Create challenge
    const challenge = await createChallenge(score);
    console.log(`[${requestId}] ✅ Challenge created: ${challenge.challengeId}`);

    return res.status(201).json(challenge);
  } catch (error) {
    console.error(`[${requestId}] Error creating challenge:`, error.message);
    return res.status(500).json({
      error: 'Failed to create challenge. Please try again.'
    });
  }
});

/**
 * GET /api/challenges/:challengeId
 * Get challenge data for display
 */
router.get('/:challengeId', getLimiter, async (req, res) => {
  const { challengeId } = req.params;
  const requestId = `challenge_get_${Date.now()}`;

  try {
    console.log(`[${requestId}] GET /api/challenges/${challengeId}`);

    // Validate challengeId format
    if (!challengeId || !challengeId.startsWith('ch_')) {
      console.log(`[${requestId}] Error: Invalid challenge ID format - ${challengeId}`);
      return res.status(400).json({
        error: 'Invalid challenge ID'
      });
    }

    // Get challenge
    const challenge = await getChallenge(challengeId);

    if (!challenge) {
      console.log(`[${requestId}] Challenge not found: ${challengeId}`);
      return res.status(404).json({
        error: 'Challenge not found'
      });
    }

    // Check if expired
    if (challenge.status === 'expired') {
      console.log(`[${requestId}] Challenge expired: ${challengeId}`);
      return res.status(410).json({
        error: 'Challenge expired',
        status: 'expired'
      });
    }

    console.log(`[${requestId}] ✅ Challenge found: ${challengeId} (status: ${challenge.status})`);
    return res.status(200).json(challenge);
  } catch (error) {
    console.error(`[${requestId}] Error getting challenge:`, error.message);
    return res.status(500).json({
      error: 'Failed to get challenge. Please try again.'
    });
  }
});

/**
 * POST /api/challenges/:challengeId/respond
 * Submit the responder's score
 */
router.post('/:challengeId/respond', respondLimiter, async (req, res) => {
  const { challengeId } = req.params;
  const requestId = `challenge_respond_${Date.now()}`;

  try {
    console.log(`[${requestId}] POST /api/challenges/${challengeId}/respond`);
    const { responderScore } = req.body;

    // Validate challengeId format
    if (!challengeId || !challengeId.startsWith('ch_')) {
      console.log(`[${requestId}] Error: Invalid challenge ID format - ${challengeId}`);
      return res.status(400).json({
        error: 'Invalid challenge ID'
      });
    }

    // Validate input
    if (responderScore === undefined || responderScore === null) {
      console.log(`[${requestId}] Error: No responderScore provided`);
      return res.status(400).json({
        error: 'responderScore is required'
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

    // Submit response
    const result = await respondToChallenge(challengeId, score);
    console.log(`[${requestId}] ✅ Response recorded: ${challengeId} - Winner: ${result.winner}`);

    return res.status(200).json(result);
  } catch (error) {
    console.error(`[${requestId}] Error responding to challenge:`, error.message);

    // Handle specific error cases
    if (error.message === 'Challenge not found') {
      return res.status(404).json({
        error: 'Challenge not found'
      });
    }

    if (error.message === 'Challenge expired') {
      return res.status(410).json({
        error: 'Challenge expired',
        status: 'expired'
      });
    }

    if (error.message === 'Challenge already completed') {
      return res.status(400).json({
        error: 'Challenge already completed'
      });
    }

    if (error.message === 'Score must be between 0 and 100') {
      return res.status(400).json({
        error: 'Score must be between 0 and 100'
      });
    }

    return res.status(500).json({
      error: 'Failed to respond to challenge. Please try again.'
    });
  }
});

export default router;
