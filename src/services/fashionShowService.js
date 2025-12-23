/**
 * FitRate Fashion Show Service
 * 
 * Handles private group experiences where friends/family compete
 * with AI-rated outfit photos in invite-only "Fashion Shows"
 */

import { redis, isRedisAvailable } from './redisClient.js';
import crypto from 'crypto';

// ============================================
// CONSTANTS
// ============================================

const SHOW_TTL_HOURS_DEFAULT = 24;
const SHOW_TTL_HOURS_EXTENDED = 168; // 7 days
const SHOW_ID_LENGTH = 6;

const VIBES = {
    nice: { label: 'Nice 😇', proOnly: false },
    roast: { label: 'Roast 🔥', proOnly: false },
    savage: { label: 'Savage 😈', proOnly: true },
    chaos: { label: 'Chaos 🌀', proOnly: true }
};

const WALKS_FREE = 1;
const WALKS_PRO = 3;

// ============================================
// HELPERS
// ============================================

/**
 * Generate a short, URL-safe show ID
 * Format: 6 alphanumeric characters (lowercase + numbers)
 */
function generateShowId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    const bytes = crypto.randomBytes(SHOW_ID_LENGTH);
    for (let i = 0; i < SHOW_ID_LENGTH; i++) {
        id += chars[bytes[i] % chars.length];
    }
    return id;
}

/**
 * Get Redis key for a show
 */
function showKey(showId) {
    return `fashionshow:${showId}`;
}

function participantsKey(showId) {
    return `fashionshow:${showId}:participants`;
}

function entriesKey(showId) {
    return `fashionshow:${showId}:entries`;
}

function activityKey(showId) {
    return `fashionshow:${showId}:activity`;
}

function userWalksKey(showId, userId) {
    return `fashionshow:${showId}:walks:${userId}`;
}

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Create a new Fashion Show
 * @param {Object} options - Show configuration
 * @returns {Object} Created show details with invite URL
 */
export async function createShow({
    name,
    vibe = 'nice',
    familySafe = true,  // DEFAULT ON per user requirement
    durationHours = SHOW_TTL_HOURS_DEFAULT,
    entriesPerPerson = 1,
    hostId
}) {
    if (!isRedisAvailable()) {
        throw new Error('Fashion Shows require Redis');
    }

    // Validate inputs
    if (!name || name.length < 2 || name.length > 50) {
        throw new Error('Show name must be 2-50 characters');
    }

    if (!VIBES[vibe]) {
        throw new Error('Invalid vibe');
    }

    if (![24, 168].includes(durationHours)) {
        durationHours = SHOW_TTL_HOURS_DEFAULT;
    }

    if (![1, 2, 3].includes(entriesPerPerson)) {
        entriesPerPerson = 1;
    }

    // Generate unique show ID
    let showId;
    let attempts = 0;
    do {
        showId = generateShowId();
        const exists = await redis.exists(showKey(showId));
        if (!exists) break;
        attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
        throw new Error('Failed to generate unique show ID');
    }

    const ttlSeconds = durationHours * 60 * 60;
    const expiresAt = Date.now() + (ttlSeconds * 1000);

    // Store show data
    const showData = {
        name,
        vibe,
        familySafe: familySafe ? '1' : '0',
        hostId: hostId || 'anonymous',
        entriesPerPerson: entriesPerPerson.toString(),
        expiresAt: expiresAt.toString(),
        status: 'active',
        createdAt: Date.now().toString()
    };

    await redis.hset(showKey(showId), showData);
    await redis.expire(showKey(showId), ttlSeconds);

    // Also set TTL on related keys (they'll be created later)
    // Redis will auto-cleanup when show expires

    console.log(`[FashionShow] Created "${name}" (${showId}) - ${vibe}, familySafe: ${familySafe}`);

    return {
        showId,
        name,
        vibe,
        vibeLabel: VIBES[vibe].label,
        familySafe,
        entriesPerPerson,
        expiresAt: new Date(expiresAt).toISOString(),
        inviteUrl: `https://fitrate.app/f/${showId}`
    };
}

/**
 * Get show details
 * @param {string} showId - Show ID
 * @returns {Object|null} Show data or null if not found/expired
 */
export async function getShow(showId) {
    if (!isRedisAvailable()) {
        return null;
    }

    const data = await redis.hgetall(showKey(showId));

    if (!data || Object.keys(data).length === 0) {
        return null;
    }

    // Check if expired
    const expiresAt = parseInt(data.expiresAt);
    if (Date.now() > expiresAt) {
        return { ...parseShowData(data, showId), status: 'ended' };
    }

    return parseShowData(data, showId);
}

function parseShowData(data, showId) {
    return {
        showId,
        name: data.name,
        vibe: data.vibe,
        vibeLabel: VIBES[data.vibe]?.label || data.vibe,
        familySafe: data.familySafe === '1',
        hostId: data.hostId,
        entriesPerPerson: parseInt(data.entriesPerPerson) || 1,
        expiresAt: new Date(parseInt(data.expiresAt)).toISOString(),
        status: data.status,
        createdAt: new Date(parseInt(data.createdAt)).toISOString()
    };
}

/**
 * Join a Fashion Show
 * @param {string} showId - Show ID
 * @param {string} userId - User identifier
 * @param {string} nickname - Display name
 * @param {string} emoji - Emoji avatar
 * @returns {Object} Join result
 */
export async function joinShow(showId, userId, nickname, emoji = '😎') {
    const show = await getShow(showId);

    if (!show) {
        throw new Error('Fashion Show not found');
    }

    if (show.status === 'ended') {
        throw new Error('This Fashion Show has ended');
    }

    // Add to participants set
    const participantData = JSON.stringify({
        userId,
        nickname: nickname.substring(0, 20),  // Limit nickname length
        emoji,
        joinedAt: Date.now()
    });

    await redis.sadd(participantsKey(showId), participantData);

    // Set TTL on participants set to match show expiry
    const showTTL = await redis.ttl(showKey(showId));
    if (showTTL > 0) {
        await redis.expire(participantsKey(showId), showTTL);
    }

    // Get current participant count
    const participantCount = await redis.scard(participantsKey(showId));

    return {
        success: true,
        show,
        participantCount,
        walksAllowed: WALKS_FREE,  // Will check Pro status at walk time
        walksUsed: 0
    };
}

/**
 * Get scoreboard for a show
 * @param {string} showId - Show ID
 * @returns {Array} Ranked entries
 */
export async function getScoreboard(showId) {
    if (!isRedisAvailable()) {
        return [];
    }

    // Get all entries sorted by score (descending)
    const entries = await redis.zrevrange(entriesKey(showId), 0, -1, 'WITHSCORES');

    const scoreboard = [];
    for (let i = 0; i < entries.length; i += 2) {
        const entryData = JSON.parse(entries[i]);
        const score = parseFloat(entries[i + 1]);

        scoreboard.push({
            rank: Math.floor(i / 2) + 1,
            userId: entryData.userId,
            nickname: entryData.nickname,
            emoji: entryData.emoji,
            score,
            verdict: entryData.verdict,
            walkedAt: entryData.walkedAt,
            imageThumb: entryData.imageThumb || null  // Include outfit thumbnail
        });
    }

    return scoreboard;
}

/**
 * Record a walk (outfit submission) in a show
 * @param {string} showId - Show ID
 * @param {Object} walkData - Walk details
 * @returns {Object} Walk result with rank
 */
export async function recordWalk(showId, {
    userId,
    nickname,
    emoji,
    score,
    verdict,
    isPro = false,
    imageThumb = null
}) {
    const show = await getShow(showId);

    if (!show) {
        throw new Error('Fashion Show not found');
    }

    if (show.status === 'ended') {
        throw new Error('This Fashion Show has ended');
    }

    // Check walks limit
    const maxWalks = isPro ? WALKS_PRO : WALKS_FREE;
    const walksUsed = await redis.incr(userWalksKey(showId, userId));

    if (walksUsed > maxWalks) {
        await redis.decr(userWalksKey(showId, userId));  // Rollback
        throw new Error(isPro
            ? `Maximum ${WALKS_PRO} walks reached`
            : `Free users get ${WALKS_FREE} walk per show. Upgrade to Pro for more!`
        );
    }

    // Set TTL on walks key to match show
    const showTTL = await redis.ttl(showKey(showId));
    if (showTTL > 0) {
        await redis.expire(userWalksKey(showId, userId), showTTL);
    }

    const entryData = JSON.stringify({
        userId,
        nickname,
        emoji,
        verdict,
        walkedAt: Date.now(),
        walkNumber: walksUsed,
        imageThumb: imageThumb || null  // Store outfit thumbnail for leaderboard
    });

    // Add to sorted set (score is the outfit score)
    await redis.zadd(entriesKey(showId), score, entryData);
    await redis.expire(entriesKey(showId), showTTL > 0 ? showTTL : 86400);

    // Add to activity feed
    const activityItem = JSON.stringify({
        type: 'walk',
        nickname,
        emoji,
        score,
        time: Date.now()
    });
    await redis.lpush(activityKey(showId), activityItem);
    await redis.ltrim(activityKey(showId), 0, 49);  // Keep last 50 activities
    await redis.expire(activityKey(showId), showTTL > 0 ? showTTL : 86400);

    // Get current rank
    const rank = await redis.zrevrank(entriesKey(showId), entryData);
    const totalEntries = await redis.zcard(entriesKey(showId));

    console.log(`[FashionShow] ${nickname} walked in "${show.name}" - Score: ${score}, Rank: ${rank + 1}/${totalEntries}`);

    return {
        success: true,
        rank: rank + 1,
        totalParticipants: totalEntries,
        walksUsed,
        walksRemaining: maxWalks - walksUsed,
        showId,
        showName: show.name
    };
}

/**
 * Get activity feed for a show
 * @param {string} showId - Show ID
 * @param {number} limit - Max items to return
 * @returns {Array} Recent activities
 */
export async function getActivity(showId, limit = 20) {
    if (!isRedisAvailable()) {
        return [];
    }

    const activities = await redis.lrange(activityKey(showId), 0, limit - 1);
    return activities.map(a => JSON.parse(a));
}

/**
 * Get participant count for a show
 */
export async function getParticipantCount(showId) {
    if (!isRedisAvailable()) {
        return 0;
    }
    return await redis.scard(participantsKey(showId));
}

/**
 * Get user's walk count for a show
 * @param {string} showId - Show ID
 * @param {string} userId - User ID
 * @returns {number} Number of walks used
 */
export async function getUserWalks(showId, userId) {
    if (!isRedisAvailable() || !userId) {
        return 0;
    }
    const walks = await redis.get(userWalksKey(showId, userId));
    return parseInt(walks) || 0;
}

// Export constants for routes
export { VIBES, WALKS_FREE, WALKS_PRO };
