/**
 * Referral Store
 * Tracks referrals and Pro Roast entitlements
 * Uses Redis with in-memory fallback for local dev
 */

import { redis, isRedisAvailable } from '../services/redisClient.js';

// In-memory fallbacks for local dev
const referralStatsFallback = new Map();
const processedReferralsFallback = new Set();
const proRoastStoreFallback = new Map();

// Redis key patterns
const REFERRAL_STATS_PREFIX = 'fitrate:referral:stats:';
const PROCESSED_REFERRALS_KEY = 'fitrate:referral:processed';
const PRO_ROAST_PREFIX = 'fitrate:proroast:';

const MAX_REFERRAL_REWARDS = 5;

/**
 * Add a referral claim - rewards a PRO ROAST (OpenAI)
 */
export async function addReferral(referrerId, refereeIp) {
    if (!referrerId || !refereeIp) return false;

    const key = `${referrerId}:${refereeIp}`;

    // Check if already processed
    if (isRedisAvailable()) {
        const exists = await redis.sismember(PROCESSED_REFERRALS_KEY, key);
        if (exists) return false;
    } else {
        if (processedReferralsFallback.has(key)) return false;
    }

    // Get current stats
    let stats;
    if (isRedisAvailable()) {
        const data = await redis.get(`${REFERRAL_STATS_PREFIX}${referrerId}`);
        stats = data ? JSON.parse(data) : { proRoasts: 0, totalReferrals: 0, bonusScans: 0 };
    } else {
        stats = referralStatsFallback.get(referrerId) || { proRoasts: 0, totalReferrals: 0, bonusScans: 0 };
    }

    // Check cap
    if (stats.proRoasts >= MAX_REFERRAL_REWARDS) {
        console.log(`⚠️ Referral cap: ${referrerId} has maxed out referral rewards`);
        return false;
    }

    // Mark as processed and update stats
    stats.proRoasts += 1;
    stats.totalReferrals += 1;

    if (isRedisAvailable()) {
        await redis.sadd(PROCESSED_REFERRALS_KEY, key);
        await redis.set(`${REFERRAL_STATS_PREFIX}${referrerId}`, JSON.stringify(stats));
    } else {
        processedReferralsFallback.add(key);
        referralStatsFallback.set(referrerId, stats);
    }

    console.log(`🎉 Referral: ${referrerId} referred ${refereeIp} -> +1 Pro Roast (${stats.proRoasts}/${MAX_REFERRAL_REWARDS})`);
    return true;
}

/**
 * Get stats for a user
 */
export async function getReferralStats(userId) {
    let stats, purchased;

    if (isRedisAvailable()) {
        const [statsData, purchasedData] = await Promise.all([
            redis.get(`${REFERRAL_STATS_PREFIX}${userId}`),
            redis.get(`${PRO_ROAST_PREFIX}${userId}`)
        ]);
        stats = statsData ? JSON.parse(statsData) : { proRoasts: 0, totalReferrals: 0, bonusScans: 0 };
        purchased = parseInt(purchasedData) || 0;
    } else {
        stats = referralStatsFallback.get(userId) || { proRoasts: 0, totalReferrals: 0, bonusScans: 0 };
        purchased = proRoastStoreFallback.get(userId) || 0;
    }

    return {
        ...stats,
        proRoasts: stats.proRoasts + purchased,
        totalReferrals: stats.totalReferrals
    };
}

/**
 * Add a purchased Pro Roast (from $0.99 payment)
 */
export async function addProRoast(userId) {
    let current;

    if (isRedisAvailable()) {
        const newCount = await redis.incr(`${PRO_ROAST_PREFIX}${userId}`);
        console.log(`💰 Pro Roast purchased: ${userId} -> now has ${newCount}`);
        return newCount;
    } else {
        current = proRoastStoreFallback.get(userId) || 0;
        proRoastStoreFallback.set(userId, current + 1);
        console.log(`💰 Pro Roast purchased: ${userId} -> now has ${current + 1}`);
        return current + 1;
    }
}

/**
 * Consume a Pro Roast (from referral or purchase)
 */
export async function consumeProRoast(userId) {
    // First try purchased
    if (isRedisAvailable()) {
        const purchased = await redis.get(`${PRO_ROAST_PREFIX}${userId}`);
        if (parseInt(purchased) > 0) {
            await redis.decr(`${PRO_ROAST_PREFIX}${userId}`);
            return true;
        }

        // Then try referral-earned
        const statsData = await redis.get(`${REFERRAL_STATS_PREFIX}${userId}`);
        if (statsData) {
            const stats = JSON.parse(statsData);
            if (stats.proRoasts > 0) {
                stats.proRoasts -= 1;
                await redis.set(`${REFERRAL_STATS_PREFIX}${userId}`, JSON.stringify(stats));
                return true;
            }
        }
    } else {
        const purchased = proRoastStoreFallback.get(userId) || 0;
        if (purchased > 0) {
            proRoastStoreFallback.set(userId, purchased - 1);
            return true;
        }

        const stats = referralStatsFallback.get(userId);
        if (stats && stats.proRoasts > 0) {
            stats.proRoasts -= 1;
            referralStatsFallback.set(userId, stats);
            return true;
        }
    }

    return false;
}

/**
 * Check if user has any Pro Roasts available
 */
export async function hasProRoast(userId) {
    if (isRedisAvailable()) {
        const [purchased, statsData] = await Promise.all([
            redis.get(`${PRO_ROAST_PREFIX}${userId}`),
            redis.get(`${REFERRAL_STATS_PREFIX}${userId}`)
        ]);
        const purchasedCount = parseInt(purchased) || 0;
        const stats = statsData ? JSON.parse(statsData) : { proRoasts: 0 };
        return purchasedCount + stats.proRoasts > 0;
    } else {
        const purchased = proRoastStoreFallback.get(userId) || 0;
        const stats = referralStatsFallback.get(userId) || { proRoasts: 0 };
        return purchased + stats.proRoasts > 0;
    }
}

/**
 * Legacy: Consume a bonus scan (backwards compatibility)
 */
export async function consumeBonusScan(userId) {
    if (isRedisAvailable()) {
        const statsData = await redis.get(`${REFERRAL_STATS_PREFIX}${userId}`);
        if (statsData) {
            const stats = JSON.parse(statsData);
            if (stats.bonusScans > 0) {
                stats.bonusScans -= 1;
                await redis.set(`${REFERRAL_STATS_PREFIX}${userId}`, JSON.stringify(stats));
                return true;
            }
        }
    } else {
        const stats = referralStatsFallback.get(userId);
        if (stats && stats.bonusScans > 0) {
            stats.bonusScans -= 1;
            referralStatsFallback.set(userId, stats);
            return true;
        }
    }
    return false;
}
