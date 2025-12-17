/**
 * Referral Store
 * Tracks referrals and Pro Roast entitlements
 * Uses in-memory Map (for production, use Redis/database)
 */

// Stores referrerId -> { proRoasts: number, totalReferrals: number }
const referralStats = new Map();

// Stores processed referrals to prevent double-counting (refereeIp + referrerId)
// simplistic anti-abuse
const processedReferrals = new Set();

// Stores one-time Pro Roast purchases by userId
const proRoastStore = new Map();

/**
 * Add a referral claim - rewards a PRO ROAST (OpenAI)
 * ABUSE PREVENTION: Max 5 Pro Roasts from referrals
 * @param {string} referrerId - The ID of the user who shared the link
 * @param {string} refereeIp - The IP of the new user
 */
const MAX_REFERRAL_REWARDS = 5;  // Cap to prevent abuse

export function addReferral(referrerId, refereeIp) {
    if (!referrerId || !refereeIp) return false;

    const key = `${referrerId}:${refereeIp}`;

    if (processedReferrals.has(key)) {
        return false; // Already referred this IP
    }

    const stats = referralStats.get(referrerId) || { proRoasts: 0, totalReferrals: 0, bonusScans: 0 };

    // Abuse prevention: cap referral rewards
    if (stats.proRoasts >= MAX_REFERRAL_REWARDS) {
        console.log(`⚠️ Referral cap: ${referrerId} has maxed out referral rewards`);
        return false;
    }

    processedReferrals.add(key);
    stats.proRoasts += 1;
    stats.totalReferrals += 1;
    referralStats.set(referrerId, stats);

    console.log(`🎉 Referral: ${referrerId} referred ${refereeIp} -> +1 Pro Roast (${stats.proRoasts}/${MAX_REFERRAL_REWARDS})`);
    return true;
}

/**
 * Get stats for a user
 */
export function getReferralStats(userId) {
    const stats = referralStats.get(userId) || { proRoasts: 0, totalReferrals: 0, bonusScans: 0 };
    const purchased = proRoastStore.get(userId) || 0;
    return {
        ...stats,
        proRoasts: stats.proRoasts + purchased,  // Combine referral + purchased
        totalReferrals: stats.totalReferrals
    };
}

/**
 * Add a purchased Pro Roast (from $0.99 payment)
 */
export function addProRoast(userId) {
    const current = proRoastStore.get(userId) || 0;
    proRoastStore.set(userId, current + 1);
    console.log(`💰 Pro Roast purchased: ${userId} -> now has ${current + 1}`);
    return current + 1;
}

/**
 * Consume a Pro Roast (from referral or purchase)
 */
export function consumeProRoast(userId) {
    // First try purchased
    const purchased = proRoastStore.get(userId) || 0;
    if (purchased > 0) {
        proRoastStore.set(userId, purchased - 1);
        return true;
    }

    // Then try referral-earned
    const stats = referralStats.get(userId);
    if (stats && stats.proRoasts > 0) {
        stats.proRoasts -= 1;
        referralStats.set(userId, stats);
        return true;
    }

    return false;
}

/**
 * Check if user has any Pro Roasts available
 */
export function hasProRoast(userId) {
    const purchased = proRoastStore.get(userId) || 0;
    const stats = referralStats.get(userId) || { proRoasts: 0 };
    return purchased + stats.proRoasts > 0;
}

/**
 * Legacy: Consume a bonus scan (backwards compatibility)
 */
export function consumeBonusScan(userId) {
    const stats = referralStats.get(userId);
    if (!stats || stats.bonusScans <= 0) return false;

    stats.bonusScans -= 1;
    referralStats.set(userId, stats);
    return true;
}

