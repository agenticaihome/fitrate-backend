/**
 * Referral Store
 * Tracks referrals and Pro Roast entitlements
 * Uses Redis with in-memory fallback for local dev
 * SECURITY: Uses fingerprint to prevent VPN abuse and self-referral
 */

import { redis, isRedisAvailable } from '../services/redisClient.js';

// In-memory fallbacks for local dev
const referralStatsFallback = new Map();
const processedReferralsFallback = new Set();
const proRoastStoreFallback = new Map();

const REFERRAL_STATS_PREFIX = 'fitrate:referral:stats:';
const PROCESSED_REFERRALS_KEY = 'fitrate:referral:processed';
const PRO_ROAST_PREFIX = 'fitrate:proroast:';
const FINGERPRINT_REFERRER_KEY = 'fitrate:referral:fingerprints:';

// New model: 3 shares = 1 Savage Roast
const SHARES_PER_REWARD = 3;
const MAX_REFERRAL_REWARDS = 100; // Effectively no cap

/**
 * Add a referral claim - rewards a SAVAGE ROAST (GPT-4o) for every 3 referrals
 * SECURITY: Uses fingerprint to prevent VPN abuse
 * @param {string} referrerId - The user who shared the link
 * @param {string} refereeFingerprint - Device fingerprint of the person clicking
 * @param {string} refereeUserId - UserId of the referee (optional, for self-referral check)
 */
export async function addReferral(referrerId, refereeFingerprint, refereeUserId = null) {
    if (!referrerId || !refereeFingerprint) return { success: false, reason: 'missing_params' };

    // SECURITY: Block self-referral
    if (refereeUserId && refereeUserId === referrerId) {
        console.warn(`⚠️ FRAUD: Self-referral attempt blocked: ${referrerId}`);
        return { success: false, reason: 'self_referral' };
    }

    // Use fingerprint as the unique identifier (VPN-resistant)
    const key = `${referrerId}:${refereeFingerprint}`;

    // Check if already processed (same device can't claim twice)
    if (isRedisAvailable()) {
        const exists = await redis.sismember(PROCESSED_REFERRALS_KEY, key);
        if (exists) return { success: false, reason: 'already_claimed' };

        // SECURITY: Check if this fingerprint has referred themselves before
        const fingerprintReferrer = await redis.get(`${FINGERPRINT_REFERRER_KEY}${refereeFingerprint}`);
        if (fingerprintReferrer && fingerprintReferrer === referrerId) {
            console.warn(`⚠️ FRAUD: Same device referral loop detected: ${refereeFingerprint.slice(0, 12)}`);
            return { success: false, reason: 'device_loop' };
        }
    } else {
        if (processedReferralsFallback.has(key)) return { success: false, reason: 'already_claimed' };
    }

    // Get current stats
    let stats;
    if (isRedisAvailable()) {
        const data = await redis.get(`${REFERRAL_STATS_PREFIX}${referrerId}`);
        stats = data ? JSON.parse(data) : { proRoasts: 0, totalReferrals: 0 };
    } else {
        stats = referralStatsFallback.get(referrerId) || { proRoasts: 0, totalReferrals: 0 };
    }

    // Check cap
    if (stats.proRoasts >= MAX_REFERRAL_REWARDS) {
        console.log(`⚠️ Referral cap: ${referrerId} has maxed out referral rewards`);
        return { success: false, reason: 'cap_reached' };
    }

    // Increment total referrals
    stats.totalReferrals += 1;

    // NEW MODEL: Grant 1 Savage Roast for every 3 referrals
    let newRoastEarned = false;
    if (stats.totalReferrals % SHARES_PER_REWARD === 0) {
        stats.proRoasts += 1;
        newRoastEarned = true;
        console.log(`🔥 SAVAGE ROAST UNLOCKED: ${referrerId} reached ${stats.totalReferrals} referrals -> +1 Savage Roast!`);
    }

    if (isRedisAvailable()) {
        await redis.sadd(PROCESSED_REFERRALS_KEY, key);
        await redis.set(`${REFERRAL_STATS_PREFIX}${referrerId}`, JSON.stringify(stats));
        // Track which fingerprint claimed from which referrer (for loop detection)
        await redis.set(`${FINGERPRINT_REFERRER_KEY}${refereeFingerprint}`, referrerId);
    } else {
        processedReferralsFallback.add(key);
        referralStatsFallback.set(referrerId, stats);
    }

    const sharesUntilNext = SHARES_PER_REWARD - (stats.totalReferrals % SHARES_PER_REWARD);
    console.log(`🎉 Referral: ${referrerId} -> ${stats.totalReferrals} total (${sharesUntilNext} more for next Savage Roast)`);

    return {
        success: true,
        proRoasts: stats.proRoasts,
        totalReferrals: stats.totalReferrals,
        newRoastEarned,
        sharesUntilNext: sharesUntilNext === SHARES_PER_REWARD ? 0 : sharesUntilNext
    };
}

/**
 * Check if user has unlocked via referrals (3+ successful referrals)
 */
export async function hasUnlockedViaReferrals(userId) {
    if (!userId) return false;

    let stats;
    if (isRedisAvailable()) {
        const data = await redis.get(`${REFERRAL_STATS_PREFIX}${userId}`);
        stats = data ? JSON.parse(data) : { totalReferrals: 0 };
    } else {
        stats = referralStatsFallback.get(userId) || { totalReferrals: 0 };
    }

    return stats.totalReferrals >= 3;
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

// ============================================
// SCAN PACK TRACKING
// ============================================

const PURCHASED_SCANS_PREFIX = 'fitrate:scans:';
const purchasedScansFallback = new Map();

/**
 * Add purchased scans (from scan pack purchase)
 * @param {string} userId - User ID
 * @param {number} count - Number of scans to add
 */
export async function addPurchasedScans(userId, count) {
    if (isRedisAvailable()) {
        const newCount = await redis.incrby(`${PURCHASED_SCANS_PREFIX}${userId}`, count);
        console.log(`💰 Scan pack purchased: ${userId} -> +${count} scans (total: ${newCount})`);
        return newCount;
    } else {
        const current = purchasedScansFallback.get(userId) || 0;
        purchasedScansFallback.set(userId, current + count);
        console.log(`💰 Scan pack purchased: ${userId} -> +${count} scans (total: ${current + count})`);
        return current + count;
    }
}

/**
 * Get purchased scans balance
 */
export async function getPurchasedScans(userId) {
    if (isRedisAvailable()) {
        const count = await redis.get(`${PURCHASED_SCANS_PREFIX}${userId}`);
        return parseInt(count) || 0;
    } else {
        return purchasedScansFallback.get(userId) || 0;
    }
}

/**
 * Consume a purchased scan
 * Returns true if successful, false if no scans available
 */
export async function consumePurchasedScan(userId) {
    if (isRedisAvailable()) {
        const current = await redis.get(`${PURCHASED_SCANS_PREFIX}${userId}`);
        if (parseInt(current) > 0) {
            await redis.decr(`${PURCHASED_SCANS_PREFIX}${userId}`);
            return true;
        }
    } else {
        const current = purchasedScansFallback.get(userId) || 0;
        if (current > 0) {
            purchasedScansFallback.set(userId, current - 1);
            return true;
        }
    }
    return false;
}

// ============================================
// SHARE TRACKING
// ============================================

const SHARE_STATS_PREFIX = 'fitrate:shares:';
const shareStatsFallback = new Map();

/**
 * Track a share event (user copied/shared their link)
 */
export async function trackShare(userId) {
    if (!userId) return;

    if (isRedisAvailable()) {
        await redis.hincrby(`${SHARE_STATS_PREFIX}${userId}`, 'totalShares', 1);
    } else {
        const stats = shareStatsFallback.get(userId) || { totalShares: 0, clicks: 0, conversions: 0 };
        stats.totalShares += 1;
        shareStatsFallback.set(userId, stats);
    }
}

/**
 * Get share stats for a user
 */
export async function getShareStats(userId) {
    if (!userId) return { totalShares: 0, clicks: 0, conversions: 0 };

    if (isRedisAvailable()) {
        const stats = await redis.hgetall(`${SHARE_STATS_PREFIX}${userId}`);
        return {
            totalShares: parseInt(stats?.totalShares) || 0,
            clicks: parseInt(stats?.clicks) || 0,
            conversions: parseInt(stats?.conversions) || 0
        };
    } else {
        return shareStatsFallback.get(userId) || { totalShares: 0, clicks: 0, conversions: 0 };
    }
}

// ============================================
// NOTIFICATIONS
// ============================================

const NOTIFICATION_PREFIX = 'fitrate:notify:';
const notificationFallback = new Map();

/**
 * Set a notification for a user (called when their referral is claimed)
 */
export async function setReferralNotification(userId, notification) {
    if (!userId) return;

    if (isRedisAvailable()) {
        await redis.lpush(`${NOTIFICATION_PREFIX}${userId}`, JSON.stringify(notification));
        await redis.expire(`${NOTIFICATION_PREFIX}${userId}`, 86400); // 24h TTL
    } else {
        const notifications = notificationFallback.get(userId) || [];
        notifications.push(notification);
        notificationFallback.set(userId, notifications);
    }
}

/**
 * Check and clear notifications for a user
 */
export async function checkReferralNotifications(userId) {
    if (!userId) return [];

    if (isRedisAvailable()) {
        const notifications = await redis.lrange(`${NOTIFICATION_PREFIX}${userId}`, 0, -1);
        if (notifications.length > 0) {
            await redis.del(`${NOTIFICATION_PREFIX}${userId}`);
            return notifications.map(n => JSON.parse(n));
        }
        return [];
    } else {
        const notifications = notificationFallback.get(userId) || [];
        notificationFallback.delete(userId);
        return notifications;
    }
}

