/**
 * Referral Store
 * Tracks referrals and bonus scans
 * Uses in-memory Map (for production, use Redis/database)
 */

// Stores referrerId -> { bonusScans: number, totalReferrals: number }
const referralStats = new Map();

// Stores processed referrals to prevent double-counting (refereeIp + referrerId)
// simplistic anti-abuse
const processedReferrals = new Set();

/**
 * Add a referral claim
 * @param {string} referrerId - The ID of the user who shared the link
 * @param {string} refereeIp - The IP of the new user
 */
export function addReferral(referrerId, refereeIp) {
    if (!referrerId || !refereeIp) return false;

    const key = `${referrerId}:${refereeIp}`;

    // Prevent self-referral (basic IP check - not perfect but okay for MVP)
    // In real app, we'd check against referrer's IP, but we don't track that persistently here yet.
    // relying on 'processedReferrals' to prevent spamming same referral.

    if (processedReferrals.has(key)) {
        return false; // Already referred this IP
    }

    processedReferrals.add(key);

    const stats = referralStats.get(referrerId) || { bonusScans: 0, totalReferrals: 0 };
    stats.bonusScans += 1;
    stats.totalReferrals += 1;
    referralStats.set(referrerId, stats);

    console.log(`🎉 Referral: ${referrerId} referred ${refereeIp} -> +1 bonus scan`);
    return true;
}

/**
 * Get stats for a user
 */
export function getReferralStats(userId) {
    return referralStats.get(userId) || { bonusScans: 0, totalReferrals: 0 };
}

/**
 * Consume a bonus scan
 */
export function consumeBonusScan(userId) {
    const stats = referralStats.get(userId);
    if (!stats || stats.bonusScans <= 0) return false;

    stats.bonusScans -= 1;
    referralStats.set(userId, stats);
    return true;
}
