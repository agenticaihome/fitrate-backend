/**
 * Push Notification Service
 * 
 * Manages Web Push subscriptions and notifications.
 * Uses VAPID for authentication.
 * Stores subscriptions in Redis.
 */

import webpush from 'web-push';
import { getRedisClient } from './redisClient.js';

// Redis key prefix for push subscriptions
const PUSH_KEY_PREFIX = 'push:sub:';

// Initialize VAPID keys from environment
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@fitrate.app';

// Configure web-push if keys are available
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('✅ Web Push configured with VAPID keys');
} else {
    console.warn('⚠️  VAPID keys not configured - Push notifications disabled');
}

/**
 * Check if push notifications are enabled
 */
export const isPushEnabled = () => {
    return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
};

/**
 * Get the public VAPID key (for frontend)
 */
export const getPublicKey = () => VAPID_PUBLIC_KEY;

/**
 * Save a push subscription
 * @param {string} userId - User ID
 * @param {object} subscription - PushSubscription object from browser
 */
export const saveSubscription = async (userId, subscription) => {
    const redis = getRedisClient();
    if (redis) {
        await redis.set(
            `${PUSH_KEY_PREFIX}${userId}`,
            JSON.stringify(subscription),
            'EX',
            60 * 60 * 24 * 365 // 1 year TTL
        );
    }
    return true;
};

/**
 * Get a push subscription
 * @param {string} userId - User ID
 * @returns {object|null} PushSubscription or null
 */
export const getSubscription = async (userId) => {
    const redis = getRedisClient();
    if (!redis) return null;

    const data = await redis.get(`${PUSH_KEY_PREFIX}${userId}`);
    return data ? JSON.parse(data) : null;
};

/**
 * Remove a push subscription
 * @param {string} userId - User ID
 */
export const removeSubscription = async (userId) => {
    const redis = getRedisClient();
    if (redis) {
        await redis.del(`${PUSH_KEY_PREFIX}${userId}`);
    }
    return true;
};

/**
 * Send a push notification to a specific user
 * @param {string} userId - User ID
 * @param {object} payload - { title, body, icon?, badge?, data? }
 * @returns {boolean} Success status
 */
export const sendNotification = async (userId, payload) => {
    if (!isPushEnabled()) {
        console.warn('Push not enabled, skipping notification');
        return false;
    }

    const subscription = await getSubscription(userId);
    if (!subscription) {
        console.log(`No subscription found for user ${userId}`);
        return false;
    }

    try {
        await webpush.sendNotification(subscription, JSON.stringify({
            title: payload.title || 'FitRate',
            body: payload.body || 'You have a new notification',
            icon: payload.icon || '/icon-192.png',
            badge: payload.badge || '/icon-192.png',
            data: payload.data || {}
        }));
        console.log(`✅ Push sent to ${userId}`);
        return true;
    } catch (err) {
        console.error(`Push failed for ${userId}:`, err.message);

        // If subscription is invalid, remove it
        if (err.statusCode === 410 || err.statusCode === 404) {
            await removeSubscription(userId);
            console.log(`Removed invalid subscription for ${userId}`);
        }
        return false;
    }
};

/**
 * Send notification to all subscribed users
 * @param {object} payload - { title, body, icon?, badge?, data? }
 * @returns {number} Number of successful sends
 */
export const sendBroadcast = async (payload) => {
    if (!isPushEnabled()) return 0;

    const redis = getRedisClient();
    if (!redis) return 0;

    // Get all push subscription keys
    const keys = await redis.keys(`${PUSH_KEY_PREFIX}*`);
    let successCount = 0;

    for (const key of keys) {
        const userId = key.replace(PUSH_KEY_PREFIX, '');
        const success = await sendNotification(userId, payload);
        if (success) successCount++;
    }

    console.log(`📢 Broadcast sent to ${successCount}/${keys.length} users`);
    return successCount;
};

export const PushService = {
    isPushEnabled,
    getPublicKey,
    saveSubscription,
    getSubscription,
    removeSubscription,
    sendNotification,
    sendBroadcast
};
