/**
 * Redis Client
 * Central Redis connection with graceful fallback to in-memory for local dev
 */

import Redis from 'ioredis';

// Initialize Redis connection (only if REDIS_URL is configured)
let redis = null;

if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        connectTimeout: 10000,
        // COST OPTIMIZATION: Reduce memory overhead
        lazyConnect: false,           // Connect immediately to detect issues early
        keepAlive: 30000,             // 30s keepalive reduces reconnection overhead
        enableOfflineQueue: true,     // Queue commands while reconnecting
    });

    redis.on('connect', () => {
        console.log('✅ Redis connected');
    });

    redis.on('error', (err) => {
        console.error('❌ Redis error:', err.message);
    });

    redis.on('reconnecting', () => {
        console.log('🔄 Redis reconnecting...');
    });
} else {
    console.log('⚠️ REDIS_URL not set - using in-memory fallback (not recommended for production)');
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable() {
    return redis !== null && redis.status === 'ready';
}

/**
 * Get Redis client (or null if not available)
 */
export function getRedis() {
    return redis;
}

export { redis };
