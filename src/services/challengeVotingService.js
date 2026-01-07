/**
 * Challenge Voting Service
 * 
 * "Judge Others, Get Judged" - Community voting system for daily/weekly challenges
 * 
 * Rules:
 * - Must have entered the challenge to vote
 * - 3 votes max per user per challenge
 * - Upvote only (🔥 Fire) - no downvotes to keep vibes positive
 * - Can't vote on own entry
 * - Anonymous voting
 * - Random entry order
 * 
 * Scoring:
 * - Final Score = (AI Score × 70%) + (Community Vote Bonus × 30%)
 * - Community Vote Bonus = normalized 0-100 based on vote count vs average
 * 
 * Redis Keys:
 * - fitrate:votes:{type}:{dateKey}:entries:{userId} → vote count
 * - fitrate:votes:{type}:{dateKey}:voters:{voterId} → array of entryIds voted for
 * - fitrate:votes:{type}:{dateKey}:total → total votes cast
 */

import { redis, isRedisAvailable } from './redisClient.js';
import { getTodayKeyEST, getCurrentWeekKeyEST } from '../utils/dateUtils.js';

// Redis key patterns
const VOTES_PREFIX = 'fitrate:votes:';
const VOTE_TTL = 60 * 60 * 72; // 72 hours

// Constants
const MAX_VOTES_PER_USER = 3;
const AI_WEIGHT = 0.7;
const COMMUNITY_WEIGHT = 0.3;

/**
 * Get the date key for a challenge type
 */
function getChallengeKey(type) {
    if (type === 'weekly') {
        return getCurrentWeekKeyEST();
    }
    return getTodayKeyEST(); // daily
}

/**
 * Record a vote (🔥 Fire) on an entry
 * 
 * @param {string} voterId - The user casting the vote
 * @param {string} entryId - The entry being voted for (userId of entry owner)
 * @param {string} type - 'daily' or 'weekly'
 * @returns {Object} Result with success status
 */
export async function castVote(voterId, entryId, type = 'daily') {
    if (!voterId || !entryId) {
        return { success: false, error: 'missing_params', message: 'Missing voterId or entryId' };
    }

    if (!isRedisAvailable()) {
        return { success: false, error: 'redis_unavailable', message: 'Voting unavailable' };
    }

    // Can't vote for yourself
    if (voterId === entryId) {
        return { success: false, error: 'self_vote', message: "You can't vote for your own outfit!" };
    }

    const dateKey = getChallengeKey(type);
    const voterKey = `${VOTES_PREFIX}${type}:${dateKey}:voters:${voterId}`;
    const entryVotesKey = `${VOTES_PREFIX}${type}:${dateKey}:entries:${entryId}`;
    const totalVotesKey = `${VOTES_PREFIX}${type}:${dateKey}:total`;

    // Check if voter has entered this challenge
    const hasEntered = await checkUserHasEntered(voterId, type);
    if (!hasEntered) {
        return {
            success: false,
            error: 'not_entered',
            message: 'Enter the challenge first to unlock voting!'
        };
    }

    // Check if voter has votes remaining
    const voterData = await redis.get(voterKey);
    const votedFor = voterData ? JSON.parse(voterData) : [];

    if (votedFor.length >= MAX_VOTES_PER_USER) {
        return {
            success: false,
            error: 'no_votes_remaining',
            message: "You've used all 3 votes!"
        };
    }

    // Check if already voted for this entry
    if (votedFor.includes(entryId)) {
        return {
            success: false,
            error: 'already_voted',
            message: "You've already fired this outfit!"
        };
    }

    // Record the vote
    votedFor.push(entryId);
    await redis.set(voterKey, JSON.stringify(votedFor));
    await redis.expire(voterKey, VOTE_TTL);

    // Increment entry's vote count
    await redis.incr(entryVotesKey);
    await redis.expire(entryVotesKey, VOTE_TTL);

    // Increment total votes
    await redis.incr(totalVotesKey);
    await redis.expire(totalVotesKey, VOTE_TTL);

    const votesRemaining = MAX_VOTES_PER_USER - votedFor.length;
    const entryVotes = parseInt(await redis.get(entryVotesKey)) || 0;

    console.log(`[VOTING] ${voterId.slice(0, 8)}... 🔥 voted for ${entryId.slice(0, 8)}... (${type}), ${votesRemaining} votes left`);

    return {
        success: true,
        votesRemaining,
        entryVotes,
        message: votesRemaining > 0
            ? `🔥 Fired! ${votesRemaining} vote${votesRemaining === 1 ? '' : 's'} remaining`
            : '🔥 Fired! No votes left - check back for results!'
    };
}

/**
 * Get user's voting status for a challenge
 */
export async function getVotingStatus(userId, type = 'daily') {
    if (!userId || !isRedisAvailable()) {
        return { canVote: false, votesRemaining: 0, votedFor: [] };
    }

    const dateKey = getChallengeKey(type);
    const voterKey = `${VOTES_PREFIX}${type}:${dateKey}:voters:${userId}`;

    // Check if user has entered
    const hasEntered = await checkUserHasEntered(userId, type);
    if (!hasEntered) {
        return {
            canVote: false,
            votesRemaining: 0,
            votedFor: [],
            reason: 'not_entered'
        };
    }

    const voterData = await redis.get(voterKey);
    const votedFor = voterData ? JSON.parse(voterData) : [];
    const votesRemaining = MAX_VOTES_PER_USER - votedFor.length;

    return {
        canVote: votesRemaining > 0,
        votesRemaining,
        votedFor,
        maxVotes: MAX_VOTES_PER_USER
    };
}

/**
 * Get entries for voting (randomized, excluding own entry and already voted)
 */
export async function getVotableEntries(userId, type = 'daily', limit = 5) {
    if (!userId || !isRedisAvailable()) {
        return { success: false, entries: [] };
    }

    const dateKey = getChallengeKey(type);

    // Get all entries for this challenge
    const scoresKey = type === 'weekly'
        ? `fitrate:event:scores:${dateKey}`  // Weekly uses event service pattern
        : `fitrate:daily:scores:${dateKey}`;

    const results = await redis.zrevrange(scoresKey, 0, 49, 'WITHSCORES'); // Get top 50
    if (!results || results.length === 0) {
        return { success: true, entries: [], message: 'No entries to vote on' };
    }

    // Get user's already voted entries
    const voterKey = `${VOTES_PREFIX}${type}:${dateKey}:voters:${userId}`;
    const voterData = await redis.get(voterKey);
    const votedFor = voterData ? JSON.parse(voterData) : [];

    // Build list of votable entries
    const entries = [];
    for (let i = 0; i < results.length; i += 2) {
        const entryUserId = results[i];
        const score = parseFloat(results[i + 1]);

        // Skip own entry and already voted
        if (entryUserId === userId || votedFor.includes(entryUserId)) {
            continue;
        }

        // Get entry details (image, tagline)
        const entryKey = type === 'weekly'
            ? `fitrate:event:thumb:${dateKey}:${entryUserId}`
            : `fitrate:daily:entries:${dateKey}:${entryUserId}`;

        const entryJson = await redis.get(entryKey);
        const entry = entryJson ? JSON.parse(entryJson) : {};

        // Get vote count for this entry
        const entryVotesKey = `${VOTES_PREFIX}${type}:${dateKey}:entries:${entryUserId}`;
        const voteCount = parseInt(await redis.get(entryVotesKey)) || 0;

        entries.push({
            entryId: entryUserId,
            score: Math.round(score * 10) / 10,
            displayName: entry.displayName || 'Anonymous',
            tagline: entry.tagline || null,
            imageThumb: entry.imageThumb || null,
            voteCount // Don't show this to users, but useful for debugging
        });
    }

    // Shuffle for fairness
    const shuffled = entries.sort(() => Math.random() - 0.5);

    return {
        success: true,
        entries: shuffled.slice(0, limit)
    };
}

/**
 * Calculate final score with community votes
 * Final Score = (AI Score × 70%) + (Vote Bonus × 30%)
 */
export async function calculateFinalScore(userId, aiScore, type = 'daily') {
    if (!isRedisAvailable()) {
        return aiScore; // Fallback to AI only
    }

    const dateKey = getChallengeKey(type);

    // Get this entry's votes
    const entryVotesKey = `${VOTES_PREFIX}${type}:${dateKey}:entries:${userId}`;
    const entryVotes = parseInt(await redis.get(entryVotesKey)) || 0;

    // Get total entries and total votes to normalize
    const scoresKey = type === 'weekly'
        ? `fitrate:event:scores:${dateKey}`
        : `fitrate:daily:scores:${dateKey}`;

    const totalEntries = await redis.zcard(scoresKey) || 1;
    const totalVotesKey = `${VOTES_PREFIX}${type}:${dateKey}:total`;
    const totalVotes = parseInt(await redis.get(totalVotesKey)) || 0;

    // Calculate vote bonus (0-100 scale)
    // Average votes per entry
    const avgVotes = totalVotes / totalEntries;

    // Vote bonus: 50 is average, scales up/down based on votes received
    let voteBonus = 50;
    if (avgVotes > 0) {
        // Scale: 2x average = 100, 0.5x average = 25, 0 votes = 0
        voteBonus = Math.min(100, Math.max(0, (entryVotes / avgVotes) * 50));
    } else if (entryVotes > 0) {
        voteBonus = 75; // Got votes when no average exists = good
    }

    // Final score: 70% AI + 30% community
    const finalScore = (aiScore * AI_WEIGHT) + (voteBonus * COMMUNITY_WEIGHT);

    console.log(`[VOTING] Final score for ${userId.slice(0, 8)}...: AI=${aiScore}, Votes=${entryVotes}, VoteBonus=${voteBonus.toFixed(1)}, Final=${finalScore.toFixed(1)}`);

    return Math.round(finalScore * 10) / 10;
}

/**
 * Check if user has entered a challenge (helper)
 */
async function checkUserHasEntered(userId, type) {
    const dateKey = getChallengeKey(type);

    const entryKey = type === 'weekly'
        ? `fitrate:event:entries:${dateKey}:${userId}`
        : `fitrate:daily:entries:${dateKey}:${userId}`;

    const entry = await redis.get(entryKey);
    return entry !== null;
}

/**
 * Get vote statistics for an entry
 */
export async function getEntryVotes(entryId, type = 'daily') {
    if (!isRedisAvailable()) {
        return { votes: 0 };
    }

    const dateKey = getChallengeKey(type);
    const entryVotesKey = `${VOTES_PREFIX}${type}:${dateKey}:entries:${entryId}`;
    const votes = parseInt(await redis.get(entryVotesKey)) || 0;

    return { votes };
}

export default {
    castVote,
    getVotingStatus,
    getVotableEntries,
    calculateFinalScore,
    getEntryVotes,
    MAX_VOTES_PER_USER,
    AI_WEIGHT,
    COMMUNITY_WEIGHT
};
