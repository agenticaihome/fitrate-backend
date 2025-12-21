/**
 * Entitlement Service
 * Single Source of Truth for User Access & Purchases
 * 
 * Features:
 * - Dual Identity: Tracks by userId AND email
 * - Durable Persistence: Uses Redis (primary) or JSON file (fallback)
 * - Purchase Guarantee: Ensures paid users are never blocked
 */

import fs from 'fs/promises';
import path from 'path';
import { redis, isRedisAvailable } from './redisClient.js';
import { fileURLToPath } from 'url';

// Persistence path for local fallback
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const ENTITLEMENTS_FILE = path.join(DATA_DIR, 'entitlements.json');

// In-memory cache
const cache = {
    // Map<userId|email, { pro: boolean, active: boolean, expiresAt: string, ... }>
    entitlements: new Map(),
    // Map<email, Set<userId>> - Link emails to userIds
    identityMap: new Map()
};

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') console.error('Failed to create data dir:', err);
    }
}

// Load from disk on startup (for fallback mode)
let initialized = false;
async function init() {
    if (initialized) return;
    initialized = true;

    if (isRedisAvailable()) {
        console.log('✅ EntitlementService: Using Redis for storage');
    } else {
        console.log('⚠️ EntitlementService: Redis unavailable, using local file storage');
        await ensureDataDir();
        try {
            const data = await fs.readFile(ENTITLEMENTS_FILE, 'utf8');
            const json = JSON.parse(data);

            // Hydrate cache
            if (json.entitlements) {
                Object.entries(json.entitlements).forEach(([key, val]) => cache.entitlements.set(key, val));
            }
            if (json.identityMap) {
                Object.entries(json.identityMap).forEach(([email, ids]) => {
                    cache.identityMap.set(email, new Set(ids));
                });
            }
            console.log(`📦 Loaded ${cache.entitlements.size} entitlements from disk`);
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('Error loading entitlements:', err);
        }
    }
}

// Save to disk (for fallback mode)
async function persist() {
    if (isRedisAvailable()) return;

    try {
        const data = {
            entitlements: Object.fromEntries(cache.entitlements),
            identityMap: Object.fromEntries(Array.from(cache.identityMap.entries()).map(([k, v]) => [k, Array.from(v)]))
        };
        await fs.writeFile(ENTITLEMENTS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Failed to save entitlements:', err);
    }
}

// Initialize on import
init().catch(err => console.error('EntitlementService init failed:', err));

export const EntitlementService = {
    /**
     * Grant Pro status to a user
     * @param {string} userId - Anonymous User ID (optional)
     * @param {string} email - User Email (optional)
     * @param {string} source - 'stripe_sub', 'stripe_one_time', 'manual'
     */
    async grantPro(userId, email, source = 'unknown') {
        if (!userId && !email) return false;

        const now = new Date().toISOString();
        const entitlement = {
            active: true,
            grantedAt: now,
            source,
            lastVerified: now
        };

        // Update Redis
        if (isRedisAvailable()) {
            const pipeline = redis.pipeline();
            if (userId) pipeline.set(`entitlement:pro:${userId}`, JSON.stringify(entitlement));
            if (email) pipeline.set(`entitlement:pro:${email.toLowerCase()}`, JSON.stringify(entitlement));
            // Link them
            if (userId && email) pipeline.sadd(`identity:${email.toLowerCase()}`, userId);
            await pipeline.exec();
        }
        // Update Local Cache + File
        else {
            if (userId) cache.entitlements.set(userId, entitlement);
            if (email) {
                const normalizedEmail = email.toLowerCase();
                cache.entitlements.set(normalizedEmail, entitlement);

                // Link identity
                if (userId) {
                    if (!cache.identityMap.has(normalizedEmail)) {
                        cache.identityMap.set(normalizedEmail, new Set());
                    }
                    cache.identityMap.get(normalizedEmail).add(userId);
                }
            }
            await persist();
        }

        console.log(`👑 Granted Pro: ${userId || 'no-id'} / ${email || 'no-email'} (${source})`);
        return true;
    },

    /**
     * Revoke Pro status (e.g. subscription cancelled)
     */
    async revokePro(email) {
        if (!email) return;
        const normalizedEmail = email.toLowerCase();

        if (isRedisAvailable()) {
            // Find linked userIds and revoke them too
            const userIds = await redis.smembers(`identity:${normalizedEmail}`);

            const pipeline = redis.pipeline();
            pipeline.del(`entitlement:pro:${normalizedEmail}`);
            userIds.forEach(id => pipeline.del(`entitlement:pro:${id}`));
            await pipeline.exec();
        } else {
            cache.entitlements.delete(normalizedEmail);

            // Revoke linked userIds
            const linkedIds = cache.identityMap.get(normalizedEmail);
            if (linkedIds) {
                linkedIds.forEach(id => cache.entitlements.delete(id));
            }

            await persist();
        }
        console.log(`🚫 Revoked Pro: ${email}`);
    },

    /**
     * Check if a user has Pro access
     * Checks userId, email, and any linked identities
     */
    async isPro(userId, email) {
        const checks = [];
        if (userId) checks.push(userId);
        if (email) checks.push(email.toLowerCase());

        if (isRedisAvailable()) {
            // Check directly provided keys
            for (const key of checks) {
                const data = await redis.get(`entitlement:pro:${key}`);
                if (data) return true;
            }

            // If we have userId, check if it's linked to a Pro email?
            // (Usually grants are synced, so checking direct key is enough)
            return false;
        } else {
            // Check memory cache
            for (const key of checks) {
                const ent = cache.entitlements.get(key);
                if (ent && ent.active) return true;
            }

            // Check if userId is linked to a pro email (reverse lookup)
            // Actually, grants propagate, so if userId is linked, it should have the entry.
            // But let's be safe: Find if this userId belongs to any Pro email map
            if (userId) {
                for (const [em, ids] of cache.identityMap.entries()) {
                    if (ids.has(userId)) {
                        const ent = cache.entitlements.get(em);
                        if (ent && ent.active) return true;
                    }
                }
            }

            return false;
        }
    },

    /**
     * Get all data (for debug/dashboard)
     */
    async debugDump() {
        if (isRedisAvailable()) {
            return { source: 'redis', note: 'Use redis-cli to inspect' };
        }
        return {
            source: 'memory/file',
            entitlements: Object.fromEntries(cache.entitlements),
            identityMap: Object.fromEntries(Array.from(cache.identityMap.entries()).map(([k, v]) => [k, Array.from(v)]))
        };
    },

    /**
     * Restore Pro by email - SINGLE DEVICE ENFORCEMENT
     * 1. Check if email has Pro entitlement
     * 2. Revoke ALL previously linked userIds  
     * 3. Grant Pro to the new userId only
     * 
     * @param {string} newUserId - The new device's userId
     * @param {string} email - Email to restore Pro from
     * @returns {object} { success, message, revokedDevices }
     */
    async restoreProByEmail(newUserId, email) {
        if (!newUserId || !email) {
            return { success: false, message: 'Missing userId or email' };
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Step 1: Check if this email has Pro
        let hasPro = false;
        let oldUserIds = [];

        if (isRedisAvailable()) {
            const emailEntitlement = await redis.get(`entitlement:pro:${normalizedEmail}`);
            if (emailEntitlement) {
                const parsed = JSON.parse(emailEntitlement);
                hasPro = parsed.active === true;
            }

            // Get old linked userIds
            oldUserIds = await redis.smembers(`identity:${normalizedEmail}`) || [];
        } else {
            const ent = cache.entitlements.get(normalizedEmail);
            hasPro = ent && ent.active === true;

            const linkedSet = cache.identityMap.get(normalizedEmail);
            oldUserIds = linkedSet ? Array.from(linkedSet) : [];
        }

        if (!hasPro) {
            console.log(`🚫 Restore failed: ${normalizedEmail} has no Pro entitlement`);
            return { success: false, message: 'No Pro subscription found for this email' };
        }

        // Step 2: Revoke ALL old userIds (single device enforcement)
        const revokedCount = oldUserIds.length;

        if (isRedisAvailable()) {
            const pipeline = redis.pipeline();

            // Delete all old userId entitlements
            for (const oldId of oldUserIds) {
                pipeline.del(`entitlement:pro:${oldId}`);
            }

            // Clear the identity set and add only the new userId
            pipeline.del(`identity:${normalizedEmail}`);
            pipeline.sadd(`identity:${normalizedEmail}`, newUserId);

            // Grant Pro to new userId
            const now = new Date().toISOString();
            const entitlement = {
                active: true,
                grantedAt: now,
                source: 'restore',
                lastVerified: now,
                restoredFrom: normalizedEmail
            };
            pipeline.set(`entitlement:pro:${newUserId}`, JSON.stringify(entitlement));

            await pipeline.exec();
        } else {
            // Local cache mode
            for (const oldId of oldUserIds) {
                cache.entitlements.delete(oldId);
            }

            // Clear and reset identity map
            cache.identityMap.set(normalizedEmail, new Set([newUserId]));

            // Grant to new userId
            const now = new Date().toISOString();
            cache.entitlements.set(newUserId, {
                active: true,
                grantedAt: now,
                source: 'restore',
                lastVerified: now,
                restoredFrom: normalizedEmail
            });

            await persist();
        }

        console.log(`🔄 Pro restored: ${normalizedEmail} → ${newUserId.slice(0, 8)}... (revoked ${revokedCount} old devices)`);

        return {
            success: true,
            message: 'Pro restored successfully',
            revokedDevices: revokedCount
        };
    },

    /**
     * Check if email has active Pro (for restore validation)
     */
    async hasProByEmail(email) {
        if (!email) return false;
        const normalizedEmail = email.toLowerCase().trim();

        if (isRedisAvailable()) {
            const data = await redis.get(`entitlement:pro:${normalizedEmail}`);
            if (data) {
                const parsed = JSON.parse(data);
                return parsed.active === true;
            }
            return false;
        } else {
            const ent = cache.entitlements.get(normalizedEmail);
            return ent && ent.active === true;
        }
    }
};
