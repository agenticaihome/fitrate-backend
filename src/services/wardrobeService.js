/**
 * Wardrobe Service - Wardrobe Wars Matchmaking
 *
 * Stores user wardrobes and provides matchmaking for Wardrobe Wars battles.
 *
 * Redis Data Structures:
 * - wardrobe:{userId} (Hash): outfits (JSON), updatedAt, displayName
 * - wardrobe_queue (Sorted Set): userId → joinTime for FIFO matching
 * - wardrobe_battles:{battleId} (Hash): battle state and results
 */

import { redis, isRedisAvailable } from './redisClient.js';
import { v4 as uuidv4 } from 'uuid';

// In-memory fallback
const inMemoryWardrobes = new Map(); // userId → { outfits, displayName, updatedAt }
const inMemoryQueue = new Map(); // userId → { joinedAt, displayName }
const inMemoryBattles = new Map(); // battleId → battle data
let inMemoryBattlesToday = 0;
let inMemoryBattlesDate = new Date().toDateString();

// Queue TTL (120 seconds for wardrobe - longer since battles take time)
const QUEUE_TTL = 120;

// Required outfit count
const REQUIRED_OUTFITS = 5;

// Stats cache
let statsCache = null;
let statsCacheTime = 0;
const STATS_CACHE_TTL = 10000; // 10 seconds

/**
 * Save user's wardrobe
 * @param {string} userId
 * @param {Array} outfits - Array of { id, thumb } objects
 * @param {string} displayName
 * @returns {{ success: boolean, message?: string }}
 */
export async function saveWardrobe(userId, outfits, displayName = 'Anonymous') {
    if (!userId) {
        throw new Error('userId is required');
    }

    if (!outfits || !Array.isArray(outfits)) {
        throw new Error('outfits must be an array');
    }

    // Validate outfit count
    if (outfits.length < REQUIRED_OUTFITS) {
        return {
            success: false,
            message: `Need ${REQUIRED_OUTFITS} outfits, got ${outfits.length}`
        };
    }

    // Clean outfit data (only keep id and thumb)
    const cleanOutfits = outfits.slice(0, REQUIRED_OUTFITS).map((o, i) => ({
        id: o.id || `outfit_${i}`,
        thumb: o.thumb || null
    }));

    const wardrobeData = {
        outfits: JSON.stringify(cleanOutfits),
        displayName: displayName || 'Anonymous',
        updatedAt: Date.now().toString()
    };

    if (isRedisAvailable()) {
        const key = `wardrobe:${userId}`;
        await redis.hset(key, wardrobeData);
        // Wardrobes persist for 7 days
        await redis.expire(key, 60 * 60 * 24 * 7);

        console.log(`[Wardrobe] Saved ${cleanOutfits.length} outfits for ${userId.slice(0, 12)}`);
        return { success: true, outfitCount: cleanOutfits.length };
    } else {
        inMemoryWardrobes.set(userId, {
            outfits: cleanOutfits,
            displayName,
            updatedAt: Date.now()
        });

        console.log(`[Wardrobe] (In-memory) Saved ${cleanOutfits.length} outfits for ${userId.slice(0, 12)}`);
        return { success: true, outfitCount: cleanOutfits.length };
    }
}

/**
 * Get user's wardrobe
 * @param {string} userId
 * @returns {{ outfits: Array, displayName: string } | null}
 */
export async function getWardrobe(userId) {
    if (!userId) return null;

    if (isRedisAvailable()) {
        const data = await redis.hgetall(`wardrobe:${userId}`);
        if (!data || !data.outfits) return null;

        return {
            outfits: JSON.parse(data.outfits),
            displayName: data.displayName || 'Anonymous',
            updatedAt: parseInt(data.updatedAt)
        };
    } else {
        const data = inMemoryWardrobes.get(userId);
        return data || null;
    }
}

/**
 * Join Wardrobe Wars matchmaking queue
 * @param {string} userId
 * @param {string} displayName
 * @returns {{ status: 'queued'|'matched'|'error', battleId?: string }}
 */
export async function joinWardrobeQueue(userId, displayName = 'Anonymous') {
    if (!userId) {
        throw new Error('userId is required');
    }

    // Check if user has a wardrobe
    const wardrobe = await getWardrobe(userId);
    if (!wardrobe || !wardrobe.outfits || wardrobe.outfits.length < REQUIRED_OUTFITS) {
        return {
            status: 'error',
            message: `You need ${REQUIRED_OUTFITS} outfits to play Wardrobe Wars`
        };
    }

    const joinedAt = Date.now();

    if (isRedisAvailable()) {
        const queueKey = 'wardrobe_queue';
        const userKey = `wardrobe_queue_user:${userId}`;

        // Remove existing entry if re-queuing
        await redis.zrem(queueKey, userId);

        // Store user queue data
        await redis.hset(userKey, {
            joinedAt: joinedAt.toString(),
            displayName,
            status: 'queued'
        });
        await redis.expire(userKey, QUEUE_TTL);

        // Add to queue
        await redis.zadd(queueKey, joinedAt, userId);
        await redis.expire(queueKey, QUEUE_TTL);

        // Attempt immediate match
        const match = await attemptWardrobeMatch(userId);
        if (match) {
            return { status: 'matched', battleId: match.battleId };
        }

        // Get position
        const position = await redis.zrank(queueKey, userId);
        return { status: 'queued', position: (position || 0) + 1 };

    } else {
        // In-memory
        inMemoryQueue.set(userId, { joinedAt, displayName, status: 'queued' });

        // Attempt match
        const match = await attemptWardrobeMatch(userId);
        if (match) {
            return { status: 'matched', battleId: match.battleId };
        }

        return { status: 'queued', position: inMemoryQueue.size };
    }
}

/**
 * Attempt to find a match for Wardrobe Wars
 */
async function attemptWardrobeMatch(userId) {
    if (isRedisAvailable()) {
        const queueUsers = await redis.zrange('wardrobe_queue', 0, -1);

        for (const candidateId of queueUsers) {
            if (candidateId === userId) continue;

            // Check candidate has a wardrobe
            const candidateWardrobe = await getWardrobe(candidateId);
            if (!candidateWardrobe || candidateWardrobe.outfits.length < REQUIRED_OUTFITS) {
                continue;
            }

            // Found a match!
            const battle = await createWardrobeBattle(userId, candidateId);

            // Remove both from queue
            await redis.zrem('wardrobe_queue', userId);
            await redis.zrem('wardrobe_queue', candidateId);

            return battle;
        }
    } else {
        for (const [candidateId, data] of inMemoryQueue) {
            if (candidateId === userId) continue;

            const candidateWardrobe = inMemoryWardrobes.get(candidateId);
            if (!candidateWardrobe || candidateWardrobe.outfits.length < REQUIRED_OUTFITS) {
                continue;
            }

            // Found a match!
            const battle = await createWardrobeBattle(userId, candidateId);

            // Remove both from queue
            inMemoryQueue.delete(userId);
            inMemoryQueue.delete(candidateId);

            return battle;
        }
    }

    return null;
}

/**
 * Create a Wardrobe Wars battle
 */
async function createWardrobeBattle(userId1, userId2) {
    const battleId = `wb_${uuidv4().slice(0, 8)}`;

    const wardrobe1 = await getWardrobe(userId1);
    const wardrobe2 = await getWardrobe(userId2);

    // Simulate scoring for each round (5 rounds, one per outfit)
    const rounds = [];
    let user1Wins = 0;
    let user2Wins = 0;

    for (let i = 0; i < REQUIRED_OUTFITS; i++) {
        // Random scores for each outfit (70-100 range)
        const score1 = Math.floor(Math.random() * 30) + 70;
        const score2 = Math.floor(Math.random() * 30) + 70;

        rounds.push({
            round: i + 1,
            user1Outfit: wardrobe1.outfits[i],
            user2Outfit: wardrobe2.outfits[i],
            user1Score: score1,
            user2Score: score2
        });

        if (score1 > score2) user1Wins++;
        else if (score2 > score1) user2Wins++;
    }

    // Determine winner
    let winner = 'tie';
    if (user1Wins > user2Wins) winner = 'user1';
    else if (user2Wins > user1Wins) winner = 'user2';

    const battleData = {
        battleId,
        user1Id: userId1,
        user2Id: userId2,
        user1DisplayName: wardrobe1.displayName,
        user2DisplayName: wardrobe2.displayName,
        rounds: JSON.stringify(rounds),
        user1Wins,
        user2Wins,
        winner,
        createdAt: Date.now(),
        status: 'complete'
    };

    if (isRedisAvailable()) {
        await redis.hset(`wardrobe_battle:${battleId}`, {
            ...battleData,
            rounds: battleData.rounds // Already stringified
        });
        await redis.expire(`wardrobe_battle:${battleId}`, 60 * 60 * 24); // 24 hour TTL

        // Mark both users as matched
        await redis.hset(`wardrobe_queue_user:${userId1}`, { status: 'matched', battleId });
        await redis.hset(`wardrobe_queue_user:${userId2}`, { status: 'matched', battleId });

        // Track daily battles
        const today = new Date().toISOString().split('T')[0];
        await redis.hincrby(`wardrobe_battles:${today}`, 'count', 1);

        console.log(`[Wardrobe] Battle ${battleId}: ${userId1.slice(0, 8)} vs ${userId2.slice(0, 8)}`);
    } else {
        inMemoryBattles.set(battleId, {
            ...battleData,
            rounds // Keep as array in memory
        });

        // Track in-memory queue
        const user1Data = inMemoryQueue.get(userId1);
        const user2Data = inMemoryQueue.get(userId2);
        if (user1Data) { user1Data.status = 'matched'; user1Data.battleId = battleId; }
        if (user2Data) { user2Data.status = 'matched'; user2Data.battleId = battleId; }

        console.log(`[Wardrobe] (In-memory) Battle ${battleId}`);
    }

    return { battleId };
}

/**
 * Poll for Wardrobe Wars match
 */
export async function pollWardrobeMatch(userId) {
    if (isRedisAvailable()) {
        const userKey = `wardrobe_queue_user:${userId}`;
        const userData = await redis.hgetall(userKey);

        if (!userData || Object.keys(userData).length === 0) {
            return { status: 'expired' };
        }

        if (userData.status === 'matched' && userData.battleId) {
            // Get battle data
            const battleData = await redis.hgetall(`wardrobe_battle:${userData.battleId}`);
            await redis.del(userKey);

            if (battleData) {
                const isUser1 = battleData.user1Id === userId;
                const result = battleData.winner === 'tie' ? 'tie' :
                    (battleData.winner === 'user1' && isUser1) || (battleData.winner === 'user2' && !isUser1) ? 'win' : 'loss';

                return {
                    status: 'matched',
                    battleId: userData.battleId,
                    myWins: isUser1 ? parseInt(battleData.user1Wins) : parseInt(battleData.user2Wins),
                    opponentWins: isUser1 ? parseInt(battleData.user2Wins) : parseInt(battleData.user1Wins),
                    opponentName: isUser1 ? battleData.user2DisplayName : battleData.user1DisplayName,
                    opponentOutfits: JSON.parse(battleData.rounds).map(r => isUser1 ? r.user2Outfit : r.user1Outfit),
                    rounds: JSON.parse(battleData.rounds).map(r => ({
                        round: r.round,
                        myOutfit: isUser1 ? r.user1Outfit : r.user2Outfit,
                        opponentOutfit: isUser1 ? r.user2Outfit : r.user1Outfit,
                        myScore: isUser1 ? r.user1Score : r.user2Score,
                        opponentScore: isUser1 ? r.user2Score : r.user1Score
                    })),
                    result
                };
            }

            return { status: 'matched', battleId: userData.battleId };
        }

        // Check expiration
        const joinedAt = parseInt(userData.joinedAt);
        const waitTime = Math.floor((Date.now() - joinedAt) / 1000);

        if (waitTime > QUEUE_TTL) {
            await redis.del(userKey);
            await redis.zrem('wardrobe_queue', userId);
            return { status: 'expired' };
        }

        // Try to match
        const match = await attemptWardrobeMatch(userId);
        if (match) {
            return { status: 'matched', battleId: match.battleId };
        }

        // Get queue position
        const position = await redis.zrank('wardrobe_queue', userId);
        return { status: 'waiting', waitTime, position: (position || 0) + 1 };

    } else {
        const userData = inMemoryQueue.get(userId);
        if (!userData) return { status: 'expired' };

        if (userData.status === 'matched' && userData.battleId) {
            const battleData = inMemoryBattles.get(userData.battleId);
            inMemoryQueue.delete(userId);

            if (battleData) {
                const isUser1 = battleData.user1Id === userId;
                const result = battleData.winner === 'tie' ? 'tie' :
                    (battleData.winner === 'user1' && isUser1) || (battleData.winner === 'user2' && !isUser1) ? 'win' : 'loss';

                return {
                    status: 'matched',
                    battleId: userData.battleId,
                    myWins: isUser1 ? battleData.user1Wins : battleData.user2Wins,
                    opponentWins: isUser1 ? battleData.user2Wins : battleData.user1Wins,
                    opponentName: isUser1 ? battleData.user2DisplayName : battleData.user1DisplayName,
                    opponentOutfits: battleData.rounds.map(r => isUser1 ? r.user2Outfit : r.user1Outfit),
                    rounds: battleData.rounds.map(r => ({
                        round: r.round,
                        myOutfit: isUser1 ? r.user1Outfit : r.user2Outfit,
                        opponentOutfit: isUser1 ? r.user2Outfit : r.user1Outfit,
                        myScore: isUser1 ? r.user1Score : r.user2Score,
                        opponentScore: isUser1 ? r.user2Score : r.user1Score
                    })),
                    result
                };
            }

            return { status: 'matched', battleId: userData.battleId };
        }

        // Check expiration
        const waitTime = Math.floor((Date.now() - userData.joinedAt) / 1000);
        if (waitTime > QUEUE_TTL) {
            inMemoryQueue.delete(userId);
            return { status: 'expired' };
        }

        // Try to match
        const match = await attemptWardrobeMatch(userId);
        if (match) {
            return { status: 'matched', battleId: match.battleId };
        }

        return { status: 'waiting', waitTime, position: inMemoryQueue.size };
    }
}

/**
 * Leave Wardrobe Wars queue
 */
export async function leaveWardrobeQueue(userId) {
    if (isRedisAvailable()) {
        await redis.zrem('wardrobe_queue', userId);
        await redis.del(`wardrobe_queue_user:${userId}`);
    } else {
        inMemoryQueue.delete(userId);
    }
    return { success: true };
}

/**
 * Get Wardrobe Wars queue stats
 */
export async function getWardrobeStats() {
    const now = Date.now();
    if (statsCache && (now - statsCacheTime) < STATS_CACHE_TTL) {
        return statsCache;
    }

    let stats;

    if (isRedisAvailable()) {
        const queueSize = await redis.zcard('wardrobe_queue');
        const today = new Date().toISOString().split('T')[0];
        const battlesData = await redis.hgetall(`wardrobe_battles:${today}`);

        stats = {
            playersSearching: Math.max(queueSize, 0),
            battlesToday: parseInt(battlesData?.count || 0),
            avgWaitTime: queueSize > 0 ? Math.max(10, 30 / queueSize) : 15
        };
    } else {
        stats = {
            playersSearching: inMemoryQueue.size,
            battlesToday: inMemoryBattlesToday,
            avgWaitTime: inMemoryQueue.size > 0 ? 15 : 30
        };
    }

    statsCache = stats;
    statsCacheTime = now;
    return stats;
}
