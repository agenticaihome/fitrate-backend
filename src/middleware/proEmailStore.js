/**
 * Pro Email Store
 * Stores emails of users who have paid for Pro
 * Uses in-memory Map (for production, use Redis/database)
 */

// In-memory store for Pro emails
const proEmails = new Map();

/**
 * Add an email as Pro (called when payment succeeds)
 */
export function addProEmail(email) {
    if (!email) return false;
    const normalized = email.toLowerCase().trim();
    proEmails.set(normalized, {
        addedAt: new Date().toISOString(),
        active: true
    });
    console.log(`✅ Added Pro email: ${normalized}`);
    return true;
}

/**
 * Check if an email has Pro status
 */
export function isProEmail(email) {
    if (!email) return false;
    const normalized = email.toLowerCase().trim();
    const data = proEmails.get(normalized);
    return data?.active || false;
}

/**
 * Remove Pro status (for cancellations)
 */
export function removeProEmail(email) {
    if (!email) return false;
    const normalized = email.toLowerCase().trim();
    const data = proEmails.get(normalized);
    if (data) {
        data.active = false;
        proEmails.set(normalized, data);
        console.log(`❌ Removed Pro email: ${normalized}`);
        return true;
    }
    return false;
}

/**
 * Get all Pro emails (for debugging)
 */
export function getAllProEmails() {
    return Array.from(proEmails.entries()).map(([email, data]) => ({
        email,
        ...data
    }));
}
