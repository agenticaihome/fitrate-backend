/**
 * Matchmaking Service - Global Arena
 *
 * Real-time matchmaking queue for global 1v1 outfit battles.
 * Smart matching: Score-based with tolerance, then widens to any score.
 *
 * Redis Data Structures:
 * - arena_queue:{mode} (Sorted Set): userId → joinTime for FIFO matching per mode
 * - arena:user:{userId} (Hash): score, thumb, mode, joinedAt, status
 * - arena_stats (Hash): total matches, current online, battles today
 */

import { redis, isRedisAvailable } from './redisClient.js';
import { createBattle } from './battleService.js';

// In-memory fallback
const inMemoryQueue = new Map(); // mode -> Map(userId -> userData)
const inMemoryUsers = new Map(); // userId -> userData
let inMemoryBattlesToday = 0;
let inMemoryBattlesDate = new Date().toDateString();

// Daily modes rotation (Sunday = 0)
const DAILY_MODES = ['aura', 'roast', 'nice', 'savage', 'rizz', 'chaos', 'celeb'];

// Mode groups for fallback matching
const MODE_GROUPS = {
    nice: ['nice', 'honest', 'aura'],           // Supportive vibes
    honest: ['honest', 'nice', 'aura'],
    aura: ['aura', 'nice', 'honest'],
    roast: ['roast', 'savage', 'chaos'],        // Spicy vibes
    savage: ['savage', 'roast', 'chaos'],
    chaos: ['chaos', 'roast', 'savage'],
    rizz: ['rizz', 'y2k', 'coquette', 'hypebeast'],  // Trendy vibes
    y2k: ['y2k', 'rizz', 'coquette', 'hypebeast'],
    coquette: ['coquette', 'rizz', 'y2k', 'hypebeast'],
    hypebeast: ['hypebeast', 'rizz', 'y2k', 'coquette'],
    celeb: ['celeb', 'villain'],                // Character modes
    villain: ['villain', 'celeb']
};

// All modes for final fallback
const ALL_MODES = ['nice', 'roast', 'honest', 'savage', 'rizz', 'celeb', 'aura', 'chaos', 'y2k', 'villain', 'coquette', 'hypebeast'];

// Queue TTL (90 seconds - matching spec)
const QUEUE_TTL = 90;

// Score matching tolerance
const SCORE_TOLERANCE = 20;

// Stats cache
let statsCache = null;
let statsCacheTime = 0;
const STATS_CACHE_TTL = 5000; // 5 seconds

/**
 * Join the matchmaking queue
 * @param {string} userId - User ID
 * @param {number} score - User's outfit score
 * @param {string} thumb - Base64 thumbnail
 * @param {string} mode - AI mode used
 * @returns {{ status: 'queued'|'matched', battleId?: string, position?: number, estimatedWait?: number }}
 */
export async function joinQueue(userId, score, thumb, mode = 'nice') {
    if (!userId || typeof score !== 'number') {
        throw new Error('userId and score are required');
    }

    const joinedAt = Date.now();
    const userData = {
        score: parseFloat(score.toFixed(1)),
        thumb: thumb || null,
        mode: mode || 'nice',
        joinedAt,
        status: 'queued'
    };

    if (isRedisAvailable()) {
        const userKey = `arena:user:${userId}`;
        const queueKey = `arena_queue:${mode}`;

        // Remove existing entry if user is re-queuing
        const existingData = await redis.hgetall(userKey);
        if (existingData && existingData.mode) {
            await redis.zrem(`arena_queue:${existingData.mode}`, userId);
        }

        // Store user data
        await redis.hset(userKey, userData);
        await redis.expire(userKey, QUEUE_TTL);

        // Add to mode-specific queue (sorted by join time for FIFO)
        await redis.zadd(queueKey, joinedAt, userId);
        await redis.expire(queueKey, QUEUE_TTL);

        // Increment online counter
        await redis.hincrby('arena_stats', 'online', 1);

        // Attempt immediate match
        const match = await attemptMatch(userId, mode, userData);
        if (match) {
            return { status: 'matched', battleId: match.battleId };
        }

        // Get queue position and estimate wait time
        const position = await redis.zrank(queueKey, userId);
        const estimatedWait = Math.max(5, (position + 1) * 3); // ~3 seconds per position, min 5
        return { status: 'queued', position: position + 1, estimatedWait };

    } else {
        // In-memory fallback
        // Remove existing entry if user is re-queuing
        const existingData = inMemoryUsers.get(userId);
        if (existingData) {
            const queue = inMemoryQueue.get(existingData.mode);
            if (queue) queue.delete(userId);
        }

        if (!inMemoryQueue.has(mode)) {
            inMemoryQueue.set(mode, new Map());
        }
        inMemoryQueue.get(mode).set(userId, userData);
        inMemoryUsers.set(userId, userData);

        // Attempt immediate match
        const match = await attemptMatch(userId, mode, userData);
        if (match) {
            return { status: 'matched', battleId: match.battleId };
        }

        const position = inMemoryQueue.get(mode).size;
        const estimatedWait = Math.max(5, position * 3);
        return { status: 'queued', position, estimatedWait };
    }
}

/**
 * Attempt to find a match for a user
 * Smart matching: Score-based within tolerance, then widens to any score.
 * Same mode first → Similar modes → Any mode (based on wait time)
 */
export async function attemptMatch(userId, mode, userData) {
    const waitTime = Date.now() - (userData?.joinedAt || Date.now());
    const userScore = parseFloat(userData.score);

    // Determine which modes to search based on wait time
    let modesToSearch = [mode]; // Start with exact mode

    if (waitTime > 20000) {
        // After 20s: Include similar modes
        modesToSearch = MODE_GROUPS[mode] || [mode];
    }

    if (waitTime > 40000) {
        // After 40s: Search all modes
        modesToSearch = ALL_MODES;
    }

    // Determine score tolerance based on wait time
    // Start strict, then widen
    let scoreTolerance = SCORE_TOLERANCE;
    if (waitTime > 30000) {
        scoreTolerance = 50; // Wider tolerance after 30s
    }
    if (waitTime > 60000) {
        scoreTolerance = 100; // Match anyone after 60s
    }

    if (isRedisAvailable()) {
        for (const searchMode of modesToSearch) {
            const queueKey = `arena_queue:${searchMode}`;

            // Get all users in this mode's queue (oldest first for fairness)
            const queueUsers = await redis.zrange(queueKey, 0, -1);

            // Find best opponent: within score tolerance, oldest first
            let bestOpponent = null;
            let bestOpponentData = null;
            let bestWaitTime = 0;

            for (const candidateId of queueUsers) {
                if (candidateId === userId) continue;

                const candidateData = await redis.hgetall(`arena:user:${candidateId}`);
                if (!candidateData || !candidateData.score) continue;

                const candidateScore = parseFloat(candidateData.score);
                const scoreDiff = Math.abs(userScore - candidateScore);

                // Check score tolerance
                if (scoreDiff <= scoreTolerance) {
                    const candidateWait = Date.now() - parseInt(candidateData.joinedAt);

                    // Prefer users waiting longer (fairness)
                    if (!bestOpponent || candidateWait > bestWaitTime) {
                        bestOpponent = candidateId;
                        bestOpponentData = candidateData;
                        bestWaitTime = candidateWait;
                    }
                }
            }

            if (bestOpponent) {
                // Create battle!
                const battle = await createBattleFromMatch(userId, userData, bestOpponent, bestOpponentData, searchMode);

                // Remove both from queues
                await removeFromQueue(userId, mode);
                await removeFromQueue(bestOpponent, searchMode);

                return battle;
            }
        }
    } else {
        // In-memory fallback
        for (const searchMode of modesToSearch) {
            const queue = inMemoryQueue.get(searchMode);
            if (!queue) continue;

            let bestOpponent = null;
            let bestOpponentData = null;
            let bestWaitTime = 0;

            for (const [candidateId, candidateData] of queue) {
                if (candidateId === userId) continue;

                const candidateScore = parseFloat(candidateData.score);
                const scoreDiff = Math.abs(userScore - candidateScore);

                if (scoreDiff <= scoreTolerance) {
                    const candidateWait = Date.now() - candidateData.joinedAt;

                    if (!bestOpponent || candidateWait > bestWaitTime) {
                        bestOpponent = candidateId;
                        bestOpponentData = candidateData;
                        bestWaitTime = candidateWait;
                    }
                }
            }

            if (bestOpponent) {
                // Create battle
                const battle = await createBattleFromMatch(userId, userData, bestOpponent, bestOpponentData, searchMode);

                // Remove both from queues
                await removeFromQueue(userId, mode);
                await removeFromQueue(bestOpponent, searchMode);

                return battle;
            }
        }
    }

    return null; // No match found
}

/**
 * Create a battle from matched users
 * @returns {{ battleId: string }}
 */
async function createBattleFromMatch(userId, userData, opponentId, opponentData, mode) {
    // Randomly decide who is "creator" vs "responder" for fairness
    const userIsCreator = Math.random() > 0.5;

    const creatorId = userIsCreator ? userId : opponentId;
    const creatorScore = userIsCreator ? parseFloat(userData.score) : parseFloat(opponentData.score);
    const creatorThumb = userIsCreator ? userData.thumb : opponentData.thumb;

    const responderId = userIsCreator ? opponentId : userId;
    const responderScore = userIsCreator ? parseFloat(opponentData.score) : parseFloat(userData.score);
    const responderThumb = userIsCreator ? opponentData.thumb : userData.thumb;

    // Use existing battle service to create the battle
    const battle = await createBattle(creatorScore, creatorId, mode, creatorThumb);
    const battleId = battle.challengeId;

    // Immediately complete the battle with responder data
    const { respondToBattle } = await import('./battleService.js');
    await respondToBattle(battleId, responderScore, responderId, responderThumb);

    // Store match info for both users
    if (isRedisAvailable()) {
        await redis.hset(`arena:user:${userId}`, { status: 'matched', battleId });
        await redis.hset(`arena:user:${opponentId}`, { status: 'matched', battleId });

        // Increment match counter and daily battles
        await redis.hincrby('arena_stats', 'matches', 1);
        await redis.hincrby('arena_stats', 'online', -2);

        // Track battles today (resets at midnight)
        const today = new Date().toISOString().split('T')[0];
        await redis.hincrby(`arena_battles:${today}`, 'count', 1);
        await redis.expire(`arena_battles:${today}`, 86400 * 2); // Keep 2 days
    } else {
        // Reset daily counter if new day
        const today = new Date().toDateString();
        if (today !== inMemoryBattlesDate) {
            inMemoryBattlesToday = 0;
            inMemoryBattlesDate = today;
        }
        inMemoryBattlesToday++;

        if (inMemoryUsers.has(userId)) {
            inMemoryUsers.get(userId).status = 'matched';
            inMemoryUsers.get(userId).battleId = battleId;
        }
        if (inMemoryUsers.has(opponentId)) {
            inMemoryUsers.get(opponentId).status = 'matched';
            inMemoryUsers.get(opponentId).battleId = battleId;
        }
    }

    return { battleId };
}

/**
 * Remove user from queue
 */
async function removeFromQueue(userId, mode) {
    if (isRedisAvailable()) {
        await redis.zrem(`arena_queue:${mode}`, userId);
        // Don't delete user data yet - they need it to poll for match result
    } else {
        const queue = inMemoryQueue.get(mode);
        if (queue) queue.delete(userId);
    }
}

/**
 * Poll for match status
 * @returns {{ status: 'waiting'|'matched'|'expired', battleId?, waitTime? }}
 */
export async function pollForMatch(userId) {
    if (isRedisAvailable()) {
        const userData = await redis.hgetall(`arena:user:${userId}`);

        if (!userData || Object.keys(userData).length === 0) {
            return { status: 'expired' };
        }

        if (userData.status === 'matched' && userData.battleId) {
            // Clean up user data
            await redis.del(`arena:user:${userId}`);

            // Fetch battle data to include scores and winner for result tracking
            try {
                const { getBattle } = await import('./battleService.js');
                const battle = await getBattle(userData.battleId);
                if (battle) {
                    // Determine user's role, scores, and result
                    const isCreator = battle.creatorId === userId;
                    const myScore = isCreator ? battle.creatorScore : battle.responderScore;
                    const opponentScore = isCreator ? battle.responderScore : battle.creatorScore;

                    // Determine if user won, lost, or tied
                    let result = 'tie';
                    if (battle.winner === 'creator') {
                        result = isCreator ? 'win' : 'loss';
                    } else if (battle.winner === 'opponent') {
                        result = isCreator ? 'loss' : 'win';
                    }

                    return {
                        status: 'matched',
                        battleId: userData.battleId,
                        myScore,
                        opponentScore,
                        isCreator,
                        result,  // 'win', 'loss', or 'tie'
                        winner: battle.winner,  // 'creator', 'opponent', or 'tie'
                        battleCommentary: battle.battleCommentary,
                        winningFactor: battle.winningFactor,
                        marginOfVictory: battle.marginOfVictory
                    };
                }
            } catch (err) {
                console.warn('[Arena] Could not fetch battle for scores:', err.message);
            }

            return { status: 'matched', battleId: userData.battleId };
        }

        // Check if queue entry expired (90 seconds)
        const joinedAt = parseInt(userData.joinedAt);
        const waitTime = Math.floor((Date.now() - joinedAt) / 1000); // in seconds

        if (waitTime > QUEUE_TTL) {
            await redis.del(`arena:user:${userId}`);
            await redis.zrem(`arena_queue:${userData.mode}`, userId);
            return { status: 'expired' };
        }

        // Still waiting - try to find a match
        const match = await attemptMatch(userId, userData.mode, {
            ...userData,
            score: parseFloat(userData.score),
            joinedAt
        });

        if (match) {
            return { status: 'matched', battleId: match.battleId };
        }

        return { status: 'waiting', waitTime };

    } else {
        const userData = inMemoryUsers.get(userId);
        if (!userData) return { status: 'expired' };

        if (userData.status === 'matched' && userData.battleId) {
            inMemoryUsers.delete(userId);

            // Fetch battle data to include scores and winner for result tracking
            try {
                const { getBattle } = await import('./battleService.js');
                const battle = await getBattle(userData.battleId);
                if (battle) {
                    const isCreator = battle.creatorId === userId;
                    const myScore = isCreator ? battle.creatorScore : battle.responderScore;
                    const opponentScore = isCreator ? battle.responderScore : battle.creatorScore;

                    // Determine if user won, lost, or tied
                    let result = 'tie';
                    if (battle.winner === 'creator') {
                        result = isCreator ? 'win' : 'loss';
                    } else if (battle.winner === 'opponent') {
                        result = isCreator ? 'loss' : 'win';
                    }

                    return {
                        status: 'matched',
                        battleId: userData.battleId,
                        myScore,
                        opponentScore,
                        isCreator,
                        result,  // 'win', 'loss', or 'tie'
                        winner: battle.winner,  // 'creator', 'opponent', or 'tie'
                        battleCommentary: battle.battleCommentary,
                        winningFactor: battle.winningFactor,
                        marginOfVictory: battle.marginOfVictory
                    };
                }
            } catch (err) {
                console.warn('[Arena] Could not fetch battle for scores:', err.message);
            }

            return { status: 'matched', battleId: userData.battleId };
        }

        // Check expiration
        const waitTime = Math.floor((Date.now() - userData.joinedAt) / 1000);
        if (waitTime > QUEUE_TTL) {
            inMemoryUsers.delete(userId);
            const queue = inMemoryQueue.get(userData.mode);
            if (queue) queue.delete(userId);
            return { status: 'expired' };
        }

        // Try to match
        const match = await attemptMatch(userId, userData.mode, userData);
        if (match) {
            return { status: 'matched', battleId: match.battleId };
        }

        return { status: 'waiting', waitTime };
    }
}

/**
 * Leave the queue
 */
export async function leaveQueue(userId) {
    if (isRedisAvailable()) {
        const userData = await redis.hgetall(`arena:user:${userId}`);
        if (userData && userData.mode) {
            await redis.zrem(`arena_queue:${userData.mode}`, userId);
            await redis.hincrby('arena_stats', 'online', -1);
        }
        await redis.del(`arena:user:${userId}`);
    } else {
        const userData = inMemoryUsers.get(userId);
        if (userData) {
            const queue = inMemoryQueue.get(userData.mode);
            if (queue) queue.delete(userId);
            inMemoryUsers.delete(userId);
        }
    }
    return { success: true };
}

/**
 * Get queue statistics
 * @returns {{ online: number, battlesToday: number, avgWaitTime: number }}
 */
export async function getQueueStats() {
    // Check cache
    const now = Date.now();
    if (statsCache && (now - statsCacheTime) < STATS_CACHE_TTL) {
        return statsCache;
    }

    let stats;

    if (isRedisAvailable()) {
        // Count total users in all queues
        let totalOnline = 0;
        for (const mode of ALL_MODES) {
            const count = await redis.zcard(`arena_queue:${mode}`);
            totalOnline += count;
        }

        // Get battles today
        const today = new Date().toISOString().split('T')[0];
        const battlesData = await redis.hgetall(`arena_battles:${today}`);
        const battlesToday = parseInt(battlesData?.count || 0);

        // Calculate average wait time (estimate based on queue size)
        // If no one in queue, estimate 5-10 seconds
        // Otherwise, estimate based on typical match rate
        let avgWaitTime = 8; // default
        if (totalOnline > 0) {
            avgWaitTime = Math.max(3, Math.min(30, Math.floor(15 / Math.max(1, totalOnline / 2))));
        }

        stats = {
            online: Math.max(totalOnline, 1), // Show at least 1 for social proof
            battlesToday: battlesToday,
            avgWaitTime: avgWaitTime
        };
    } else {
        // In-memory fallback
        let totalOnline = 0;
        for (const queue of inMemoryQueue.values()) {
            totalOnline += queue.size;
        }

        // Reset daily counter if new day
        const today = new Date().toDateString();
        if (today !== inMemoryBattlesDate) {
            inMemoryBattlesToday = 0;
            inMemoryBattlesDate = today;
        }

        stats = {
            online: Math.max(totalOnline, 1),
            battlesToday: inMemoryBattlesToday,
            avgWaitTime: 8
        };
    }

    // Cache the result
    statsCache = stats;
    statsCacheTime = now;

    return stats;
}
