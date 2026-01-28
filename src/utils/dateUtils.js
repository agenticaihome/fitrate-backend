/**
 * Date Utilities for Consistent EST Timezone Handling
 * 
 * FitRate resets all daily limits at midnight EST (05:00 UTC).
 * This module provides a single source of truth for EST date calculations.
 * 
 * NOTE: Uses fixed EST offset (UTC-5), not adjusting for DST for consistency.
 * This means during EDT (summer), reset is technically at 1am local.
 */

// EST offset: UTC-5 (fixed, no DST adjustment for predictable behavior)
const EST_OFFSET_HOURS = 5;

/**
 * Get the current time (or provided time) adjusted to EST
 * @param {Date} date - Optional date to convert to EST (defaults to now)
 * @returns {Date} Time in EST as a Date object
 */
export function getESTDate(date = new Date()) {
    const timestamp = date instanceof Date ? date.getTime() : Date.now();
    return new Date(timestamp - (EST_OFFSET_HOURS * 60 * 60 * 1000));
}

/**
 * Get today's date key (YYYY-MM-DD) in EST
 * Used for Redis key generation and daily limit tracking
 * @returns {string} Date string like "2026-01-04"
 */
export function getTodayKeyEST() {
    return getESTDate().toISOString().split('T')[0];
}

/**
 * Get yesterday's date key (YYYY-MM-DD) in EST
 * Used for reward distribution and leaderboard finalization
 * @returns {string} Date string like "2026-01-03"
 */
export function getYesterdayKeyEST() {
    const estNow = getESTDate();
    const yesterday = new Date(estNow.getTime() - (24 * 60 * 60 * 1000));
    return yesterday.toISOString().split('T')[0];
}

/**
 * Get midnight EST reset time (returned as UTC ISO string)
 * This is when the next daily reset will occur
 * @returns {string} ISO timestamp like "2026-01-05T05:00:00.000Z"
 */
export function getMidnightResetTimeEST() {
    const estNow = getESTDate();
    // Get tomorrow's date in EST
    const tomorrowEST = new Date(estNow);
    tomorrowEST.setUTCDate(tomorrowEST.getUTCDate() + 1);
    tomorrowEST.setUTCHours(0, 0, 0, 0);
    // Convert back to UTC by adding EST offset
    return new Date(tomorrowEST.getTime() + (EST_OFFSET_HOURS * 60 * 60 * 1000)).toISOString();
}

/**
 * Get current week key (YYYY-Www) in EST
 * Used for weekly challenge tracking
 * @returns {string} Week string like "2026-W02"
 */
export function getCurrentWeekKeyEST() {
    const estDate = getESTDate();
    const d = new Date(Date.UTC(estDate.getFullYear(), estDate.getMonth(), estDate.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Get the EST offset in hours (exported for services that need it)
 */
export const EST_OFFSET = EST_OFFSET_HOURS;

export default {
    getESTDate,
    getTodayKeyEST,
    getYesterdayKeyEST,
    getCurrentWeekKeyEST,
    getMidnightResetTimeEST,
    EST_OFFSET
};
