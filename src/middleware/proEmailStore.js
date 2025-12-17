/**
 * Pro Email Store
 * Stores emails of users who have paid for Pro
 * Uses Redis with in-memory fallback for local dev
 */

import { redis, isRedisAvailable } from '../services/redisClient.js';

// In-memory fallback for local dev (when Redis not configured)
const proEmailsFallback = new Map();

const REDIS_KEY = 'fitrate:pro:emails';

/**
 * Add an email as Pro (called when payment succeeds)
 */
export async function addProEmail(email) {
    if (!email) return false;
    const normalized = email.toLowerCase().trim();
    const data = JSON.stringify({
        addedAt: new Date().toISOString(),
        active: true
    });

    if (isRedisAvailable()) {
        await redis.hset(REDIS_KEY, normalized, data);
    } else {
        proEmailsFallback.set(normalized, JSON.parse(data));
    }

    console.log(`✅ Added Pro email: ${normalized}`);
    return true;
}

/**
 * Check if an email has Pro status
 */
export async function isProEmail(email) {
    if (!email) return false;
    const normalized = email.toLowerCase().trim();

    if (isRedisAvailable()) {
        const data = await redis.hget(REDIS_KEY, normalized);
        if (data) {
            const parsed = JSON.parse(data);
            return parsed.active || false;
        }
        return false;
    } else {
        const data = proEmailsFallback.get(normalized);
        return data?.active || false;
    }
}

/**
 * Remove Pro status (for cancellations)
 */
export async function removeProEmail(email) {
    if (!email) return false;
    const normalized = email.toLowerCase().trim();

    if (isRedisAvailable()) {
        const data = await redis.hget(REDIS_KEY, normalized);
        if (data) {
            const parsed = JSON.parse(data);
            parsed.active = false;
            await redis.hset(REDIS_KEY, normalized, JSON.stringify(parsed));
            console.log(`❌ Removed Pro email: ${normalized}`);
            return true;
        }
    } else {
        const data = proEmailsFallback.get(normalized);
        if (data) {
            data.active = false;
            proEmailsFallback.set(normalized, data);
            console.log(`❌ Removed Pro email: ${normalized}`);
            return true;
        }
    }
    return false;
}

/**
 * Get all Pro emails (for debugging)
 */
export async function getAllProEmails() {
    if (isRedisAvailable()) {
        const all = await redis.hgetall(REDIS_KEY);
        return Object.entries(all).map(([email, data]) => ({
            email,
            ...JSON.parse(data)
        }));
    } else {
        return Array.from(proEmailsFallback.entries()).map(([email, data]) => ({
            email,
            ...data
        }));
    }
}
