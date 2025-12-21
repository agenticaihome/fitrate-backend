/**
 * Event Service
 * Core service for Weekly Event Mode + Leaderboard
 * 
 * Redis Keys:
 * - fitrate:event:current - Active event metadata (JSON)
 * - fitrate:event:scores:{weekId} - Sorted set (userId → composite score)
 * - fitrate:event:entries:{weekId}:{userId} - Entry details (JSON)
 * - fitrate:event:archive:{weekId} - Frozen leaderboard (JSON)
 * - fitrate:event:themes - List of theme configurations
 */

import { redis, isRedisAvailable } from './redisClient.js';

// Redis key patterns
const CURRENT_EVENT_KEY = 'fitrate:event:current';
const SCORES_PREFIX = 'fitrate:event:scores:';
const ENTRIES_PREFIX = 'fitrate:event:entries:';
const ARCHIVE_PREFIX = 'fitrate:event:archive:';
const FREE_ENTRIES_PREFIX = 'fitrate:event:free:';  // Track free user weekly entries
const PRO_ENTRIES_PREFIX = 'fitrate:event:pro:';    // Track pro user daily entries
const WINNERS_PREFIX = 'fitrate:event:winners:';     // Track past winners for cooldown

// Freemium limits
const FREE_EVENT_ENTRIES_WEEKLY = 1;   // Free users get 1 entry per week
const PRO_EVENT_ENTRIES_DAILY = 5;     // Pro users can submit up to 5/day
const WINNER_COOLDOWN_WEEKS = 4;       // Previous winners sit out 4 weeks

/**
 * Get today's date key (YYYY-MM-DD)
 */
function getTodayKey() {
    return new Date().toISOString().split('T')[0];
}

// Default themes to rotate through
const DEFAULT_THEMES = [
    { theme: 'Holiday Glam', emoji: '✨🎄', description: 'Sparkle, velvet, and festive elegance. Show us your holiday party best!' },
    { theme: 'Ugly Sweater Gala', emoji: '🎄🧶', description: 'The tackier, the better. Clashing colors, 3D elements, and festive chaos.' },
    { theme: 'Monochrome', emoji: '⬛⬜', description: 'Master the art of single-color styling.' },
    { theme: 'Streetwear', emoji: '🔥👟', description: 'Urban edge, oversized fits, sneaker culture.' },
    { theme: 'Office Chic', emoji: '💼✨', description: 'Professional but fashionable — power dressing.' },
    { theme: 'Date Night', emoji: '🌙💋', description: 'Romantic, polished, ready to impress.' },
    { theme: 'Athleisure', emoji: '🏃‍♀️💪', description: 'Sporty meets stylish — gym to street.' },
    { theme: 'Y2K Revival', emoji: '📱💿', description: 'Early 2000s nostalgia — low-rise, butterfly clips, and bold colors.' }
];

// Display name templates for anonymous users
const RANK_TITLES = [
    'Fashionista',
    'Style Icon',
    'Trend Setter',
    'Style Maven',
    'Fashion Forward',
    'Outfit Artist',
    'Drip Lord',
    'Fit Architect'
];

/**
 * Get ISO week ID for a given date
 * Format: YYYY-Www (e.g., 2025-W51)
 */
export function getWeekId(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Get the start of the current week (Monday 00:00 UTC)
 */
function getWeekStart(date = new Date()) {
    const d = new Date(date);
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    d.setUTCDate(diff);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

/**
 * Get the end of the current week (Sunday 23:59:59 UTC)
 */
function getWeekEnd(date = new Date()) {
    const start = getWeekStart(date);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);
    return end;
}

/**
 * Get default display name for a rank
 */
function getDefaultDisplayName(rank) {
    const titleIndex = (rank - 1) % RANK_TITLES.length;
    return `${RANK_TITLES[titleIndex]} #${rank}`;
}

/**
 * Create composite score for tie-breaking
 * Earlier submissions get higher composite scores (win ties)
 */
function createCompositeScore(score, timestamp) {
    const invertedTime = 9999999999999 - timestamp;
    const fraction = String(invertedTime).slice(0, 10);
    return parseFloat(`${Math.floor(score)}.${fraction}`);
}

/**
 * Extract real score from composite score
 */
function extractRealScore(compositeScore) {
    return parseFloat(compositeScore.toFixed(1));
}

/**
 * Get theme for a given week index
 */
function getThemeForWeek(weekIndex) {
    return DEFAULT_THEMES[weekIndex % DEFAULT_THEMES.length];
}

/**
 * Check if a user is a recent winner (within cooldown period)
 * Winners sit out WINNER_COOLDOWN_WEEKS after winning
 */
async function isRecentWinner(userId) {
    if (!isRedisAvailable() || !userId) return false;

    const winnerKey = `${WINNERS_PREFIX}${userId}`;
    const lastWinWeek = await redis.get(winnerKey);

    if (!lastWinWeek) return false;

    // Calculate weeks since last win
    const currentWeekId = getWeekId();
    const currentWeekNum = parseInt(currentWeekId.split('-W')[1]);
    const lastWinWeekNum = parseInt(lastWinWeek.split('-W')[1]);

    // Handle year rollover (simplified - assumes within same year for now)
    const weeksSinceWin = currentWeekNum - lastWinWeekNum;

    return weeksSinceWin >= 0 && weeksSinceWin < WINNER_COOLDOWN_WEEKS;
}

/**
 * Mark a user as a winner for the current week
 * Called when archiving event and recording top 5
 */
async function markWinner(userId, weekId) {
    if (!isRedisAvailable() || !userId) return;

    const winnerKey = `${WINNERS_PREFIX}${userId}`;
    await redis.set(winnerKey, weekId);

    // Set TTL to cover the cooldown period plus buffer (5 weeks)
    await redis.expire(winnerKey, (WINNER_COOLDOWN_WEEKS + 1) * 7 * 24 * 60 * 60);

    console.log(`🏆 Marked ${userId.slice(0, 8)}... as winner for ${weekId}`);
}

/**
 * Create a new event for the current week
 */
async function createNewEvent(weekId) {
    const weekIndex = parseInt(weekId.split('-W')[1]) - 1;
    const themeConfig = getThemeForWeek(weekIndex);

    const event = {
        weekId,
        theme: themeConfig.theme,
        themeDescription: themeConfig.description,
        themeEmoji: themeConfig.emoji,
        startDate: getWeekStart().toISOString(),
        endDate: getWeekEnd().toISOString(),
        status: 'active',
        createdAt: new Date().toISOString()
    };

    if (isRedisAvailable()) {
        await redis.set(CURRENT_EVENT_KEY, JSON.stringify(event));
    }

    console.log(`🎉 Created new event: ${event.theme} (${weekId})`);
    return event;
}

/**
 * Archive an event's leaderboard
*/
async function archiveEvent(weekId) {
    if (!isRedisAvailable()) return null;

    const scoresKey = `${SCORES_PREFIX}${weekId}`;
    const archiveKey = `${ARCHIVE_PREFIX}${weekId}`;

    // Get final leaderboard (top 5)
    const leaderboard = await getLeaderboard(weekId, 5);

    // WINNER COOLDOWN: Mark top 5 as winners so they sit out next 4 weeks
    // We need to get the FULL userIds (not truncated) from the raw leaderboard
    const raw = await redis.zrevrange(scoresKey, 0, 4);
    for (const winnerId of raw) {
        await markWinner(winnerId, weekId);
    }

    // Get total participants
    const totalParticipants = await redis.zcard(scoresKey);

    // Get event metadata
    const eventJson = await redis.get(CURRENT_EVENT_KEY);
    const event = eventJson ? JSON.parse(eventJson) : {};

    const archive = {
        weekId,
        theme: event.theme || 'Unknown',
        themeEmoji: event.themeEmoji || '',
        leaderboard,
        totalParticipants,
        winnersMarked: raw.length,
        archivedAt: new Date().toISOString()
    };

    // Store archive with 90 day TTL
    await redis.set(archiveKey, JSON.stringify(archive));
    await redis.expire(archiveKey, 90 * 24 * 60 * 60);

    console.log(`📦 Archived event ${weekId} with ${totalParticipants} participants, ${raw.length} winners marked`);
    return archive;
}

/**
 * Ensure current event exists and is valid
 * This is the lazy reset mechanism - called on every event-related request
 */
export async function ensureCurrentEvent() {
    const currentWeekId = getWeekId();

    if (!isRedisAvailable()) {
        // Fallback for local dev without Redis
        return {
            weekId: currentWeekId,
            theme: DEFAULT_THEMES[0].theme,
            themeDescription: DEFAULT_THEMES[0].description,
            themeEmoji: DEFAULT_THEMES[0].emoji,
            startDate: getWeekStart().toISOString(),
            endDate: getWeekEnd().toISOString(),
            status: 'active',
            createdAt: new Date().toISOString()
        };
    }

    const eventJson = await redis.get(CURRENT_EVENT_KEY);

    if (!eventJson) {
        // No event exists — create new
        return await createNewEvent(currentWeekId);
    }

    const event = JSON.parse(eventJson);

    if (event.weekId !== currentWeekId) {
        // Week changed — archive old, create new
        await archiveEvent(event.weekId);
        return await createNewEvent(currentWeekId);
    }

    return event;
}

/**
 * Get the active event (public-facing)
 */
export async function getActiveEvent() {
    const event = await ensureCurrentEvent();

    if (!isRedisAvailable()) {
        return { ...event, totalParticipants: 0 };
    }

    const scoresKey = `${SCORES_PREFIX}${event.weekId}`;
    const totalParticipants = await redis.zcard(scoresKey) || 0;

    return {
        ...event,
        totalParticipants
    };
}

/**
 * Get user's rank in the leaderboard (1-indexed)
 */
export async function getUserRank(weekId, userId) {
    if (!isRedisAvailable()) return null;

    const scoresKey = `${SCORES_PREFIX}${weekId}`;
    const rank = await redis.zrevrank(scoresKey, userId);

    if (rank === null) return null;
    return rank + 1; // Convert to 1-indexed
}

/**
 * Get leaderboard (top N users)
 */
export async function getLeaderboard(weekId, limit = 5) {
    if (!isRedisAvailable()) return [];

    const scoresKey = `${SCORES_PREFIX}${weekId}`;

    // Get top N with scores
    const raw = await redis.zrevrange(scoresKey, 0, limit - 1, 'WITHSCORES');

    const leaderboard = [];
    for (let i = 0; i < raw.length; i += 2) {
        const odlUserId = raw[i];
        const compositeScore = parseFloat(raw[i + 1]);
        const realScore = extractRealScore(compositeScore);
        const rank = (i / 2) + 1;

        // Get entry details
        const entryKey = `${ENTRIES_PREFIX}${weekId}:${odlUserId}`;
        const entryJson = await redis.get(entryKey);
        const entry = entryJson ? JSON.parse(entryJson) : {};

        leaderboard.push({
            rank,
            userId: odlUserId.slice(0, 8) + '...', // Truncated for privacy
            score: realScore,
            displayName: entry.displayName || getDefaultDisplayName(rank),
            isPro: entry.isPro || false,
            themeCompliant: entry.themeCompliant ?? true
        });
    }

    return leaderboard;
}

/**
 * Check if a free user can submit to the event this week
 * Returns { canSubmit: boolean, entriesUsed: number, entriesLimit: number }
 */
export async function canFreeUserSubmit(userId) {
    if (!userId || !isRedisAvailable()) {
        return { canSubmit: true, entriesUsed: 0, entriesLimit: FREE_EVENT_ENTRIES_WEEKLY };
    }

    const weekId = getWeekId();
    const freeEntryKey = `${FREE_ENTRIES_PREFIX}${weekId}:${userId}`;
    const entriesUsed = parseInt(await redis.get(freeEntryKey)) || 0;

    return {
        canSubmit: entriesUsed < FREE_EVENT_ENTRIES_WEEKLY,
        entriesUsed,
        entriesLimit: FREE_EVENT_ENTRIES_WEEKLY
    };
}

/**
 * Mark that a free user has used their weekly entry
 */
async function markFreeUserEntry(userId, weekId) {
    if (!isRedisAvailable()) return;

    const freeEntryKey = `${FREE_ENTRIES_PREFIX}${weekId}:${userId}`;
    await redis.incr(freeEntryKey);

    // Set TTL to expire after the week ends (7 days from Monday)
    await redis.expire(freeEntryKey, 7 * 24 * 60 * 60);
}

/**
 * Check if a Pro user can submit to the event today
 * Returns { canSubmit: boolean, entriesUsed: number, entriesLimit: number }
 */
export async function canProUserSubmit(userId) {
    if (!userId || !isRedisAvailable()) {
        return { canSubmit: true, entriesUsed: 0, entriesLimit: PRO_EVENT_ENTRIES_DAILY };
    }

    const today = getTodayKey();
    const proEntryKey = `${PRO_ENTRIES_PREFIX}${today}:${userId}`;
    const entriesUsed = parseInt(await redis.get(proEntryKey)) || 0;

    return {
        canSubmit: entriesUsed < PRO_EVENT_ENTRIES_DAILY,
        entriesUsed,
        entriesLimit: PRO_EVENT_ENTRIES_DAILY
    };
}

/**
 * Mark that a Pro user has used an entry today
 */
async function markProUserEntry(userId) {
    if (!isRedisAvailable()) return;

    const today = getTodayKey();
    const proEntryKey = `${PRO_ENTRIES_PREFIX}${today}:${userId}`;
    await redis.incr(proEntryKey);

    // Set TTL to expire at end of day (24 hours max)
    await redis.expire(proEntryKey, 24 * 60 * 60);
}

/**
 * Record a score for a user in the current event
 * FREEMIUM MODEL:
 * - Pro users: 5 entries/day, decimal precision
 * - Free users: 1 entry/week, whole number scores
 * 
 * SECURITY: Server-side validation of limits (don't trust frontend)
 */
export async function recordEventScore(userId, score, themeCompliant, isPro) {
    if (!userId || score === undefined) return { action: 'error', message: 'Missing userId or score' };

    if (!isRedisAvailable()) {
        return { action: 'skipped', message: 'Redis not available' };
    }

    const event = await ensureCurrentEvent();
    const weekId = event.weekId;

    // ============================================
    // SECURITY: Server-side limit enforcement
    // ============================================

    // Check winner cooldown (previous winners sit out 4 weeks)
    const isWinner = await isRecentWinner(userId);
    if (isWinner) {
        console.log(`🚫 Blocked recent winner ${userId.slice(0, 8)}... from event`);
        return { action: 'blocked', message: 'Previous winners sit out 4 weeks', reason: 'winner_cooldown' };
    }

    // Check free user weekly limit
    if (!isPro) {
        const freeStatus = await canFreeUserSubmit(userId);
        if (!freeStatus.canSubmit) {
            console.log(`🚫 Blocked free user ${userId.slice(0, 8)}... weekly limit reached`);
            return { action: 'blocked', message: 'Weekly entry limit reached', reason: 'free_limit' };
        }
    }

    // Check pro user daily limit
    if (isPro) {
        const proStatus = await canProUserSubmit(userId);
        if (!proStatus.canSubmit) {
            console.log(`🚫 Blocked Pro user ${userId.slice(0, 8)}... daily limit reached`);
            return { action: 'blocked', message: 'Daily entry limit reached', reason: 'pro_limit' };
        }
    }

    // ============================================
    // Score recording logic
    // ============================================

    const scoresKey = `${SCORES_PREFIX}${weekId}`;
    const entryKey = `${ENTRIES_PREFIX}${weekId}:${userId}`;
    const timestamp = Date.now();
    const now = new Date().toISOString();

    // FREEMIUM: Round score to whole number for free users (Pro gets decimal precision)
    const finalScore = isPro ? score : Math.round(score);
    const isFirstSubmission = (await redis.zscore(scoresKey, userId)) === null;

    // FREEMIUM: Mark free user's weekly entry as used (only on first submission)
    if (!isPro && isFirstSubmission) {
        await markFreeUserEntry(userId, weekId);
        console.log(`🎫 Free user ${userId.slice(0, 8)}... used their weekly entry`);
    }

    // PRO LIMIT: Mark Pro user's daily entry (every submission counts)
    if (isPro) {
        await markProUserEntry(userId);
        console.log(`⚡ Pro user ${userId.slice(0, 8)}... used an event entry`);
    }

    // Get current best (if any)
    const currentComposite = await redis.zscore(scoresKey, userId);

    if (currentComposite === null) {
        // First submission
        const composite = createCompositeScore(finalScore, timestamp);
        await redis.zadd(scoresKey, composite, userId);

        const entry = {
            userId,
            bestScore: finalScore,
            originalScore: score,  // Keep original for debugging
            themeCompliant,
            submissionCount: 1,
            bestSubmissionAt: now,
            firstSubmissionAt: now,
            displayName: null,
            isPro
        };
        await redis.set(entryKey, JSON.stringify(entry));

        console.log(`🏆 New event entry: ${userId.slice(0, 8)}... scored ${finalScore}${!isPro ? ' (rounded)' : ''}`);

        const rank = await getUserRank(weekId, userId);
        return { action: 'added', score: finalScore, rank, isPro };
    }

    const currentScore = extractRealScore(parseFloat(currentComposite));

    if (score > currentScore) {
        // New personal best
        const composite = createCompositeScore(score, timestamp);
        await redis.zadd(scoresKey, composite, userId);

        const entryJson = await redis.get(entryKey);
        const entry = entryJson ? JSON.parse(entryJson) : {};
        entry.bestScore = score;
        entry.themeCompliant = themeCompliant;
        entry.bestSubmissionAt = now;
        entry.submissionCount = (entry.submissionCount || 0) + 1;
        entry.isPro = isPro;
        await redis.set(entryKey, JSON.stringify(entry));

        console.log(`📈 Score improved: ${userId.slice(0, 8)}... ${currentScore} → ${score}`);

        const rank = await getUserRank(weekId, userId);
        return { action: 'improved', oldScore: currentScore, newScore: score, rank };
    }

    // Score not better — just increment count
    const entryJson = await redis.get(entryKey);
    const entry = entryJson ? JSON.parse(entryJson) : {};
    entry.submissionCount = (entry.submissionCount || 0) + 1;
    await redis.set(entryKey, JSON.stringify(entry));

    return { action: 'unchanged', bestScore: currentScore };
}

/**
 * Get user's full event status
 */
export async function getUserEventStatus(weekId, userId) {
    if (!isRedisAvailable() || !userId) {
        return { participating: false };
    }

    const rank = await getUserRank(weekId, userId);
    const entryKey = `${ENTRIES_PREFIX}${weekId}:${userId}`;
    const entryJson = await redis.get(entryKey);

    if (!entryJson) {
        return { participating: false };
    }

    const entry = JSON.parse(entryJson);
    const scoresKey = `${SCORES_PREFIX}${weekId}`;
    const totalParticipants = await redis.zcard(scoresKey) || 0;

    return {
        participating: true,
        rank,
        inTop5: rank !== null && rank <= 5,
        bestScore: entry.bestScore,
        submissionCount: entry.submissionCount,
        themeCompliant: entry.themeCompliant,
        totalParticipants
    };
}

/**
 * Get archived event leaderboard
 */
export async function getArchivedEvent(weekId) {
    if (!isRedisAvailable()) return null;

    const archiveKey = `${ARCHIVE_PREFIX}${weekId}`;
    const archiveJson = await redis.get(archiveKey);

    if (!archiveJson) return null;
    return JSON.parse(archiveJson);
}

/**
 * Get upcoming event (next week's theme) for preview
 * Creates anticipation - users can see what's coming!
 */
export function getUpcomingEvent() {
    const today = new Date();
    const nextWeekDate = new Date(today);
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);

    const nextWeekId = getWeekId(nextWeekDate);
    const nextWeekIndex = parseInt(nextWeekId.split('-W')[1]) - 1;
    const themeConfig = getThemeForWeek(nextWeekIndex);

    // Calculate next week's start (next Monday)
    const daysUntilMonday = (8 - today.getUTCDay()) % 7 || 7;
    const nextMonday = new Date(today);
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    nextMonday.setUTCHours(0, 0, 0, 0);

    // Calculate next week's end (next Sunday)
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextSunday.getDate() + 6);
    nextSunday.setUTCHours(23, 59, 59, 999);

    return {
        weekId: nextWeekId,
        theme: themeConfig.theme,
        themeDescription: themeConfig.description,
        themeEmoji: themeConfig.emoji,
        startDate: nextMonday.toISOString(),
        endDate: nextSunday.toISOString(),
        startsIn: daysUntilMonday,
        status: 'upcoming'
    };
}

/**
 * Get all available themes (for admin/preview)
 */
export function getAllThemes() {
    return DEFAULT_THEMES.map((theme, index) => ({
        index,
        ...theme
    }));
}

export default {
    getWeekId,
    ensureCurrentEvent,
    getActiveEvent,
    getUpcomingEvent,
    getAllThemes,
    recordEventScore,
    canFreeUserSubmit,
    canProUserSubmit,
    getUserRank,
    getLeaderboard,
    getUserEventStatus,
    getArchivedEvent
};
