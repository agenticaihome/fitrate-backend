/**
 * Image Hasher
 * Generates perceptual hashes for duplicate detection and caching
 */

import sharp from 'sharp';
import { redis, isRedisAvailable } from './redisClient.js';

const CACHE_PREFIX = 'fitrate:cache:';
const CACHE_TTL = 3600; // 1 hour cache

/**
 * Generate a perceptual hash from base64 image
 * Uses downsizing + grayscale for consistent fingerprint
 */
export async function getImageHash(base64Image) {
    try {
        // Remove data URL prefix if present
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        // Resize to 8x8 grayscale for perceptual hash
        const { data } = await sharp(buffer)
            .resize(8, 8, { fit: 'fill' })
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Convert to simple hash string
        return Buffer.from(data).toString('base64');
    } catch (error) {
        console.error('Image hash error:', error.message);
        return null;
    }
}

/**
 * Get cached result for an image hash
 */
export async function getCachedResult(hash) {
    if (!hash || !isRedisAvailable()) return null;

    try {
        const cached = await redis.get(`${CACHE_PREFIX}${hash}`);
        if (cached) {
            console.log(`📦 Cache hit for hash: ${hash.substring(0, 10)}...`);
            return JSON.parse(cached);
        }
    } catch (error) {
        console.error('Cache get error:', error.message);
    }
    return null;
}

/**
 * Cache a result for an image hash
 */
export async function cacheResult(hash, result) {
    if (!hash || !isRedisAvailable() || !result) return;

    try {
        await redis.setex(`${CACHE_PREFIX}${hash}`, CACHE_TTL, JSON.stringify(result));
        console.log(`💾 Cached result for hash: ${hash.substring(0, 10)}...`);
    } catch (error) {
        console.error('Cache set error:', error.message);
    }
}
