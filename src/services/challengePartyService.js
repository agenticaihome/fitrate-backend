/**
 * Challenge Party Service
 * Handles 1v1 outfit challenge rooms where two users compare scores
 *
 * Redis Data Structure:
 * - Key: `challenge:{challengeId}` (hash)
 * - TTL: 7 days (auto-expires)
 */

import { redis, isRedisAvailable } from './redisClient.js';
import crypto from 'crypto';

// In-memory fallback for when Redis is unavailable
const inMemoryStore = new Map();

/**
 * Generate a unique challenge ID
 * Format: "ch_" + 10 random characters (alphanumeric)
 */
export function generateChallengeId() {
  const randomChars = crypto.randomBytes(8).toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 10);
  return `ch_${randomChars}`;
}

/**
 * Create a new challenge
 * @param {number} creatorScore - Creator's outfit score (0.0-100.0)
 * @returns {Object} Challenge data with ID
 */
export async function createChallenge(creatorScore) {
  // Validate score
  if (typeof creatorScore !== 'number' || creatorScore < 0 || creatorScore > 100) {
    throw new Error('Score must be between 0 and 100');
  }

  const challengeId = generateChallengeId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const challengeData = {
    id: challengeId,
    creatorScore: parseFloat(creatorScore.toFixed(1)),
    responderScore: null,
    status: 'waiting',
    winner: null,
    createdAt: now.toISOString(),
    respondedAt: null,
    expiresAt: expiresAt.toISOString()
  };

  if (isRedisAvailable()) {
    const key = `challenge:${challengeId}`;

    // Store as Redis hash
    await redis.hset(key, {
      creatorScore: challengeData.creatorScore,
      status: challengeData.status,
      createdAt: challengeData.createdAt,
      expiresAt: challengeData.expiresAt
    });

    // Set TTL to 7 days (604800 seconds)
    await redis.expire(key, 604800);
  } else {
    // In-memory fallback
    inMemoryStore.set(challengeId, challengeData);
  }

  return {
    challengeId,
    status: challengeData.status,
    creatorScore: challengeData.creatorScore,
    createdAt: challengeData.createdAt,
    expiresAt: challengeData.expiresAt
  };
}

/**
 * Get challenge data by ID
 * @param {string} challengeId - Challenge ID
 * @returns {Object|null} Challenge data or null if not found
 */
export async function getChallenge(challengeId) {
  if (!challengeId || !challengeId.startsWith('ch_')) {
    return null;
  }

  if (isRedisAvailable()) {
    const key = `challenge:${challengeId}`;
    const data = await redis.hgetall(key);

    // Challenge not found or expired
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    // Parse data from Redis (all values are strings)
    const challenge = {
      challengeId,
      creatorScore: parseFloat(data.creatorScore),
      responderScore: data.responderScore ? parseFloat(data.responderScore) : null,
      status: data.status,
      winner: data.winner || null,
      createdAt: data.createdAt,
      respondedAt: data.respondedAt || null,
      expiresAt: data.expiresAt || null
    };

    // Check if challenge has expired
    if (challenge.expiresAt && new Date(challenge.expiresAt) < new Date()) {
      // Update status to expired
      await redis.hset(key, 'status', 'expired');
      challenge.status = 'expired';
    }

    return challenge;
  } else {
    // In-memory fallback
    const challenge = inMemoryStore.get(challengeId);
    if (!challenge) return null;

    // Check expiration
    if (new Date(challenge.expiresAt) < new Date()) {
      challenge.status = 'expired';
    }

    return {
      challengeId,
      ...challenge
    };
  }
}

/**
 * Submit responder's score and determine winner
 * @param {string} challengeId - Challenge ID
 * @param {number} responderScore - Responder's outfit score (0.0-100.0)
 * @returns {Object} Result with winner and scores
 */
export async function respondToChallenge(challengeId, responderScore) {
  // Validate score
  if (typeof responderScore !== 'number' || responderScore < 0 || responderScore > 100) {
    throw new Error('Score must be between 0 and 100');
  }

  // Get existing challenge
  const challenge = await getChallenge(challengeId);
  if (!challenge) {
    throw new Error('Challenge not found');
  }

  // Check if expired
  if (challenge.status === 'expired') {
    throw new Error('Challenge expired');
  }

  // Check if already completed
  if (challenge.status === 'completed') {
    throw new Error('Challenge already completed');
  }

  // Calculate winner
  const creatorScore = challenge.creatorScore;
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
    const key = `challenge:${challengeId}`;

    // Update challenge with response
    await redis.hset(key, {
      responderScore: roundedResponderScore,
      status: 'completed',
      winner: winner,
      respondedAt: respondedAt
    });
  } else {
    // In-memory fallback
    const stored = inMemoryStore.get(challengeId);
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
 * Check if a challenge exists and is valid
 * @param {string} challengeId - Challenge ID
 * @returns {boolean}
 */
export async function challengeExists(challengeId) {
  const challenge = await getChallenge(challengeId);
  return challenge !== null;
}
