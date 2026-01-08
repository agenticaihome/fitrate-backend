/**
 * Fashion Wars Service
 * Global alliance-based fashion competition
 * 
 * Features:
 * - 6 alliances (continents) competing for style dominance
 * - Every scan contributes points to user's alliance
 * - Daily battles between paired alliances
 * - 14-day "war" seasons with champion crowning
 */

import { redis, isRedisAvailable } from './redisClient.js';

// ============================================
// ALLIANCE CONFIGURATION
// ============================================
const ALLIANCES = ['north_america', 'europe', 'asia', 'africa', 'south_america', 'oceania'];

// 15-day battle rotation - each day has 3 simultaneous battles
const BATTLE_ROTATION = [
    ['north_america', 'europe'],
    ['asia', 'oceania'],
    ['africa', 'south_america'],
    ['north_america', 'asia'],
    ['europe', 'africa'],
    ['south_america', 'oceania'],
    ['north_america', 'africa'],
    ['europe', 'oceania'],
    ['asia', 'south_america'],
    ['north_america', 'south_america'],
    ['europe', 'asia'],
    ['africa', 'oceania'],
    ['north_america', 'oceania'],
    ['europe', 'south_america'],
    ['asia', 'africa']
];

const WAR_DURATION_DAYS = 14;
const WAR_START_DATE = new Date('2024-01-01').getTime();

// In-memory fallback storage
const memoryStore = {
    memberships: new Map(),      // userId -> { allianceId, warId, joinedAt }
    dailyScores: new Map(),      // date:allianceId -> score
    contributions: new Map(),    // date:userId -> { scans, totalPoints }
    seasonStandings: new Map(),  // warId:allianceId -> { wins, totalScore }
    dailyResults: new Map()      // date -> [{ alliance1, alliance2, winner, ... }]
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

function getDayOfYear() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / (1000 * 60 * 60 * 24));
}

function getTodayKey() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function getCurrentWarId() {
    const daysSinceStart = Math.floor((Date.now() - WAR_START_DATE) / (1000 * 60 * 60 * 24));
    return `war_${Math.floor(daysSinceStart / WAR_DURATION_DAYS)}`;
}

function getWarDayNumber() {
    const daysSinceStart = Math.floor((Date.now() - WAR_START_DATE) / (1000 * 60 * 60 * 24));
    return (daysSinceStart % WAR_DURATION_DAYS) + 1;
}

function getTodayBattles() {
    const dayOfYear = getDayOfYear();
    const cycleDay = dayOfYear % 15;
    const battleIndex = (cycleDay % 5) * 3;

    return [
        BATTLE_ROTATION[battleIndex % 15],
        BATTLE_ROTATION[(battleIndex + 1) % 15],
        BATTLE_ROTATION[(battleIndex + 2) % 15]
    ];
}

// Anti-spam: diminishing returns for high scan counts
function calculateContribution(rawScore, scansToday) {
    let contribution = rawScore;

    // Diminishing returns after 5 scans/day
    if (scansToday >= 5) {
        const diminishFactor = Math.pow(0.85, scansToday - 4);
        contribution *= diminishFactor;
    }

    // Soft cap at 10 scans (20% of score)
    if (scansToday >= 10) {
        contribution *= 0.2;
    }

    // Hard cap at 15 scans (10% of score)
    if (scansToday >= 15) {
        contribution *= 0.1;
    }

    return Math.round(contribution);
}

// ============================================
// ALLIANCE MEMBERSHIP
// ============================================

/**
 * Join an alliance (locked for current war)
 */
export async function joinAlliance(userId, allianceId) {
    if (!ALLIANCES.includes(allianceId)) {
        throw new Error(`Invalid alliance: ${allianceId}`);
    }

    const warId = getCurrentWarId();
    const key = `war:membership:${userId}`;
    const data = {
        allianceId,
        warId,
        joinedAt: Date.now(),
        joinedDay: getWarDayNumber()
    };

    if (isRedisAvailable()) {
        // Check if already has alliance this war
        const existing = await redis.get(key);
        if (existing) {
            const parsed = JSON.parse(existing);
            if (parsed.warId === warId) {
                throw new Error('Already joined an alliance this war');
            }
        }
        await redis.set(key, JSON.stringify(data));
        // Expire at end of war + 1 day buffer
        const daysLeft = WAR_DURATION_DAYS - getWarDayNumber() + 1;
        await redis.expire(key, daysLeft * 24 * 60 * 60);
    } else {
        const existing = memoryStore.memberships.get(userId);
        if (existing && existing.warId === warId) {
            throw new Error('Already joined an alliance this war');
        }
        memoryStore.memberships.set(userId, data);
    }

    console.log(`[WarService] User ${userId.slice(0, 12)}... joined ${allianceId}`);
    return data;
}

/**
 * Get user's current alliance
 */
export async function getUserAlliance(userId) {
    const key = `war:membership:${userId}`;

    if (isRedisAvailable()) {
        const data = await redis.get(key);
        if (!data) return null;
        const parsed = JSON.parse(data);
        // Check if still valid for current war
        if (parsed.warId !== getCurrentWarId()) return null;
        return parsed;
    } else {
        const data = memoryStore.memberships.get(userId);
        if (!data || data.warId !== getCurrentWarId()) return null;
        return data;
    }
}

// ============================================
// CONTRIBUTIONS
// ============================================

/**
 * Record a score contribution
 */
export async function recordContribution(userId, allianceId, rawScore, mode = 'nice') {
    const today = getTodayKey();
    const warId = getCurrentWarId();

    // Get user's current scan count for today
    const userDayKey = `war:contrib:${today}:${userId}`;
    let userStats = { scans: 0, totalPoints: 0 };

    if (isRedisAvailable()) {
        const existing = await redis.get(userDayKey);
        if (existing) {
            userStats = JSON.parse(existing);
        }
    } else {
        userStats = memoryStore.contributions.get(`${today}:${userId}`) || { scans: 0, totalPoints: 0 };
    }

    // Calculate contribution with anti-spam
    const contribution = calculateContribution(rawScore, userStats.scans);

    // Update user's daily stats
    userStats.scans += 1;
    userStats.totalPoints += contribution;

    if (isRedisAvailable()) {
        await redis.set(userDayKey, JSON.stringify(userStats));
        await redis.expire(userDayKey, 48 * 60 * 60); // 48h TTL

        // Update alliance daily score
        const allianceDayKey = `war:score:${today}:${allianceId}`;
        await redis.incrby(allianceDayKey, contribution);
        await redis.expire(allianceDayKey, 48 * 60 * 60);

        // Update season total
        const seasonKey = `war:season:${warId}:${allianceId}`;
        await redis.hincrby(seasonKey, 'totalScore', contribution);
        await redis.expire(seasonKey, (WAR_DURATION_DAYS + 7) * 24 * 60 * 60);
    } else {
        memoryStore.contributions.set(`${today}:${userId}`, userStats);

        const allianceKey = `${today}:${allianceId}`;
        const currentScore = memoryStore.dailyScores.get(allianceKey) || 0;
        memoryStore.dailyScores.set(allianceKey, currentScore + contribution);

        const seasonKey = `${warId}:${allianceId}`;
        const seasonData = memoryStore.seasonStandings.get(seasonKey) || { wins: 0, totalScore: 0 };
        seasonData.totalScore += contribution;
        memoryStore.seasonStandings.set(seasonKey, seasonData);
    }

    console.log(`[WarService] Contribution: ${userId.slice(0, 8)}... +${contribution}pts to ${allianceId} (scan #${userStats.scans})`);

    return {
        contribution,
        totalToday: userStats.totalPoints,
        scansToday: userStats.scans,
        allianceId
    };
}

/**
 * Get user's daily contribution stats
 */
export async function getUserDailyStats(userId) {
    const today = getTodayKey();
    const key = `war:contrib:${today}:${userId}`;

    if (isRedisAvailable()) {
        const data = await redis.get(key);
        return data ? JSON.parse(data) : { scans: 0, totalPoints: 0 };
    } else {
        return memoryStore.contributions.get(`${today}:${userId}`) || { scans: 0, totalPoints: 0 };
    }
}

// ============================================
// STANDINGS
// ============================================

/**
 * Get current war standings
 */
export async function getStandings(userId = null) {
    const today = getTodayKey();
    const warId = getCurrentWarId();
    const todayBattles = getTodayBattles();

    // Get all alliance scores for today
    const dailyScores = {};
    const seasonStandings = [];

    for (const alliance of ALLIANCES) {
        // Daily score
        if (isRedisAvailable()) {
            const score = await redis.get(`war:score:${today}:${alliance}`);
            dailyScores[alliance] = parseInt(score) || 0;

            // Season stats
            const seasonData = await redis.hgetall(`war:season:${warId}:${alliance}`);
            seasonStandings.push({
                allianceId: alliance,
                wins: parseInt(seasonData.wins) || 0,
                totalScore: parseInt(seasonData.totalScore) || 0
            });
        } else {
            dailyScores[alliance] = memoryStore.dailyScores.get(`${today}:${alliance}`) || 0;

            const seasonData = memoryStore.seasonStandings.get(`${warId}:${alliance}`) || { wins: 0, totalScore: 0 };
            seasonStandings.push({
                allianceId: alliance,
                wins: seasonData.wins,
                totalScore: seasonData.totalScore
            });
        }
    }

    // Build today's battles with scores
    const todayBattlesData = todayBattles.map(([a1, a2]) => ({
        alliance1: a1,
        alliance2: a2,
        score1: dailyScores[a1] || 0,
        score2: dailyScores[a2] || 0,
        endsAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString()
    }));

    // Get user stats if userId provided
    let userStats = null;
    if (userId) {
        const membership = await getUserAlliance(userId);
        if (membership) {
            const dailyStats = await getUserDailyStats(userId);
            userStats = {
                allianceId: membership.allianceId,
                todayContribution: dailyStats.totalPoints,
                todayScans: dailyStats.scans,
                warContribution: 0, // Would need to track this separately
            };
        }
    }

    return {
        warId,
        dayNumber: getWarDayNumber(),
        totalDays: WAR_DURATION_DAYS,
        todayBattles: todayBattlesData,
        seasonStandings: seasonStandings.sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            return b.totalScore - a.totalScore;
        }),
        userStats
    };
}

/**
 * Get daily battle results (for showing yesterday's winners)
 */
export async function getDailyResults(date) {
    const key = `war:results:${date}`;

    if (isRedisAvailable()) {
        const data = await redis.get(key);
        return data ? JSON.parse(data) : null;
    } else {
        return memoryStore.dailyResults.get(date) || null;
    }
}

/**
 * Calculate and store daily battle winners (called by scheduler at midnight)
 */
export async function finalizeDailyBattles(date) {
    const todayBattles = getTodayBattles();
    const results = [];
    const warId = getCurrentWarId();

    for (const [a1, a2] of todayBattles) {
        let score1, score2;

        if (isRedisAvailable()) {
            score1 = parseInt(await redis.get(`war:score:${date}:${a1}`)) || 0;
            score2 = parseInt(await redis.get(`war:score:${date}:${a2}`)) || 0;
        } else {
            score1 = memoryStore.dailyScores.get(`${date}:${a1}`) || 0;
            score2 = memoryStore.dailyScores.get(`${date}:${a2}`) || 0;
        }

        const winner = score1 > score2 ? a1 : score2 > score1 ? a2 : null;
        results.push({ alliance1: a1, alliance2: a2, score1, score2, winner });

        // Update season wins
        if (winner) {
            if (isRedisAvailable()) {
                await redis.hincrby(`war:season:${warId}:${winner}`, 'wins', 1);
            } else {
                const key = `${warId}:${winner}`;
                const data = memoryStore.seasonStandings.get(key) || { wins: 0, totalScore: 0 };
                data.wins += 1;
                memoryStore.seasonStandings.set(key, data);
            }
        }
    }

    // Store results
    const key = `war:results:${date}`;
    if (isRedisAvailable()) {
        await redis.set(key, JSON.stringify(results));
        await redis.expire(key, 30 * 24 * 60 * 60); // 30 days
    } else {
        memoryStore.dailyResults.set(date, results);
    }

    console.log(`[WarService] Daily battles finalized for ${date}:`, results.map(r => `${r.alliance1} vs ${r.alliance2}: ${r.winner || 'tie'}`));
    return results;
}

// Export alliance list for validation
export { ALLIANCES, getCurrentWarId, getWarDayNumber };
