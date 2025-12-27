/**
 * Matchmaking Service - Global Arena
 * 
 * Real-time matchmaking queue for global 1v1 outfit battles.
 * Smart matching: Same mode first, then widens to similar modes, then any.
 * 
 * Redis Data Structures:
 * - arena_queue:{mode} (Sorted Set): userId → joinTime for FIFO matching per mode
 * - arena:user:{userId} (Hash): score, thumb, mode, joinedAt, status
 * - arena_stats (Hash): total matches, current online
 */

import { redis, isRedisAvailable } from './redisClient.js';
import { createBattle } from './battleService.js';

// In-memory fallback
const inMemoryQueue = new Map(); // mode -> Map(userId -> userData)
const inMemoryUsers = new Map(); // oderId -> userData

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

// Queue TTL (2 minutes - auto-expire stale entries)
const QUEUE_TTL = 120;

/**
 * Join the matchmaking queue
 * @param {string} userId - User ID
 * @param {number} score - User's outfit score
 * @param {string} thumb - Base64 thumbnail
 * @param {string} mode - AI mode used
 * @returns {{ status: 'queued'|'matched', battleId?: string, position?: number }}
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
            return { status: 'matched', battleId: match.challengeId };
        }

        // Get queue position
        const position = await redis.zrank(queueKey, userId);
        return { status: 'queued', position: position + 1 };

    } else {
        // In-memory fallback
        if (!inMemoryQueue.has(mode)) {
            inMemoryQueue.set(mode, new Map());
        }
        inMemoryQueue.get(mode).set(userId, userData);
        inMemoryUsers.set(userId, userData);

        // Attempt immediate match
        const match = await attemptMatch(userId, mode, userData);
        if (match) {
            return { status: 'matched', battleId: match.challengeId };
        }

        return { status: 'queued', position: inMemoryQueue.get(mode).size };
    }
}

/**
 * Attempt to find a match for a user
 * Smart matching: Same mode → Similar modes → Any mode (based on wait time)
 */
export async function attemptMatch(userId, mode, userData) {
    const waitTime = Date.now() - (userData?.joinedAt || Date.now());

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

    if (isRedisAvailable()) {
        for (const searchMode of modesToSearch) {
            const queueKey = `arena_queue:${searchMode}`;

            // Get all users in this mode's queue
            const queueUsers = await redis.zrange(queueKey, 0, -1);

            // Find first opponent (not self)
            const opponent = queueUsers.find(id => id !== userId);

            if (opponent) {
                // Get opponent data
                const opponentData = await redis.hgetall(`arena:user:${opponent}`);
                if (opponentData && opponentData.score) {
                    // Create battle!
                    const battle = await createBattleFromMatch(userId, userData, opponent, opponentData, searchMode);

                    // Remove both from queues
                    await removeFromQueue(userId, mode);
                    await removeFromQueue(opponent, searchMode);

                    return battle;
                }
            }
        }
    } else {
        // In-memory fallback
        for (const searchMode of modesToSearch) {
            const queue = inMemoryQueue.get(searchMode);
            if (!queue) continue;

            for (const [opponentId, opponentData] of queue) {
                if (opponentId !== userId) {
                    // Create battle
                    const battle = await createBattleFromMatch(userId, userData, opponentId, opponentData, searchMode);

                    // Remove both from queues
                    await removeFromQueue(userId, mode);
                    await removeFromQueue(opponentId, searchMode);

                    return battle;
                }
            }
        }
    }

    return null; // No match found
}

/**
 * Create a battle from matched users
 */
async function createBattleFromMatch(userId, userData, opponentId, opponentData, mode) {
    // Randomly decide who is "creator" vs "responder" for fairness
    const userIsCreator = Math.random() > 0.5;

    const creatorId = userIsCreator ? userId : opponentId;
    const creatorScore = userIsCreator ? userData.score : parseFloat(opponentData.score);
    const creatorThumb = userIsCreator ? userData.thumb : opponentData.thumb;

    const responderId = userIsCreator ? opponentId : userId;
    const responderScore = userIsCreator ? parseFloat(opponentData.score) : userData.score;
    const responderThumb = userIsCreator ? opponentData.thumb : userData.thumb;

    // Use existing battle service to create the battle
    const battle = await createBattle(creatorScore, creatorId, mode, creatorThumb);

    // Immediately complete the battle with responder data
    // We need to import respondToBattle...
    const { respondToBattle } = await import('./battleService.js');
    await respondToBattle(battle.challengeId, responderScore, responderId, responderThumb);

    // Store match info for both users
    if (isRedisAvailable()) {
        await redis.hset(`arena:user:${userId}`, { status: 'matched', battleId: battle.challengeId });
        await redis.hset(`arena:user:${opponentId}`, { status: 'matched', battleId: battle.challengeId });

        // Increment match counter
        await redis.hincrby('arena_stats', 'matches', 1);
        await redis.hincrby('arena_stats', 'online', -2);
    } else {
        if (inMemoryUsers.has(userId)) {
            inMemoryUsers.get(userId).status = 'matched';
            inMemoryUsers.get(userId).battleId = battle.challengeId;
        }
        if (inMemoryUsers.has(opponentId)) {
            inMemoryUsers.get(opponentId).status = 'matched';
            inMemoryUsers.get(opponentId).battleId = battle.challengeId;
        }
    }

    return battle;
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
 * @returns {{ status: 'queued'|'matched'|'expired', battleId?, waitTime? }}
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
            return { status: 'matched', battleId: userData.battleId };
        }

        // Still queued - try to find a match
        const match = await attemptMatch(userId, userData.mode, {
            ...userData,
            score: parseFloat(userData.score),
            joinedAt: parseInt(userData.joinedAt)
        });

        if (match) {
            return { status: 'matched', battleId: match.challengeId };
        }

        const waitTime = Date.now() - parseInt(userData.joinedAt);
        return { status: 'queued', waitTime };

    } else {
        const userData = inMemoryUsers.get(userId);
        if (!userData) return { status: 'expired' };

        if (userData.status === 'matched' && userData.battleId) {
            inMemoryUsers.delete(userId);
            return { status: 'matched', battleId: userData.battleId };
        }

        // Try to match
        const match = await attemptMatch(userId, userData.mode, userData);
        if (match) {
            return { status: 'matched', battleId: match.challengeId };
        }

        return { status: 'queued', waitTime: Date.now() - userData.joinedAt };
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
 */
export async function getQueueStats() {
    if (isRedisAvailable()) {
        const stats = await redis.hgetall('arena_stats');

        // Count total users in all queues
        let totalOnline = 0;
        for (const mode of ALL_MODES) {
            const count = await redis.zcard(`arena_queue:${mode}`);
            totalOnline += count;
        }

        return {
            online: totalOnline,
            matchesToday: parseInt(stats?.matches || 0)
        };
    } else {
        let totalOnline = 0;
        for (const queue of inMemoryQueue.values()) {
            totalOnline += queue.size;
        }
        return { online: totalOnline, matchesToday: 0 };
    }
}
