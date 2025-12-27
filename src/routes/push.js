/**
 * Push Notification Routes
 * 
 * Endpoints for managing push subscriptions and sending notifications.
 */

import express from 'express';
import { PushService } from '../services/pushService.js';

const router = express.Router();

/**
 * GET /api/push/vapid-public-key
 * Get the VAPID public key for subscription
 */
router.get('/vapid-public-key', (req, res) => {
    const publicKey = PushService.getPublicKey();

    if (!publicKey) {
        return res.status(503).json({
            error: 'Push notifications not configured'
        });
    }

    res.json({ publicKey });
});

/**
 * POST /api/push/subscribe
 * Save a push subscription
 * Body: { userId, subscription }
 */
router.post('/subscribe', async (req, res) => {
    try {
        const { userId, subscription } = req.body;

        if (!userId || !subscription) {
            return res.status(400).json({
                error: 'Missing userId or subscription'
            });
        }

        if (!subscription.endpoint || !subscription.keys) {
            return res.status(400).json({
                error: 'Invalid subscription format'
            });
        }

        await PushService.saveSubscription(userId, subscription);

        res.json({
            success: true,
            message: 'Subscription saved'
        });
    } catch (err) {
        console.error('Subscribe error:', err);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

/**
 * DELETE /api/push/unsubscribe
 * Remove a push subscription
 * Body: { userId }
 */
router.delete('/unsubscribe', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'Missing userId' });
        }

        await PushService.removeSubscription(userId);

        res.json({
            success: true,
            message: 'Subscription removed'
        });
    } catch (err) {
        console.error('Unsubscribe error:', err);
        res.status(500).json({ error: 'Failed to remove subscription' });
    }
});

/**
 * POST /api/push/test
 * Send a test notification (for admin/debugging)
 * Body: { userId, title?, body? }
 */
router.post('/test', async (req, res) => {
    try {
        const { userId, title, body } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'Missing userId' });
        }

        const success = await PushService.sendNotification(userId, {
            title: title || '🔥 Test Notification',
            body: body || 'Push notifications are working!',
            data: { type: 'test' }
        });

        res.json({
            success,
            message: success ? 'Notification sent' : 'Failed to send (user may not be subscribed)'
        });
    } catch (err) {
        console.error('Test push error:', err);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

/**
 * POST /api/push/broadcast
 * Send notification to all subscribers (admin only)
 * Body: { title, body, adminKey }
 */
router.post('/broadcast', async (req, res) => {
    try {
        const { title, body, adminKey } = req.body;

        // Simple admin key check
        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        if (!title || !body) {
            return res.status(400).json({ error: 'Missing title or body' });
        }

        const count = await PushService.sendBroadcast({ title, body });

        res.json({
            success: true,
            sentCount: count,
            message: `Broadcast sent to ${count} users`
        });
    } catch (err) {
        console.error('Broadcast error:', err);
        res.status(500).json({ error: 'Failed to broadcast' });
    }
});

/**
 * POST /api/push/daily-ootd
 * Send daily "Rate your OOTD" notification to all subscribers
 * Called by Railway cron job at 9am
 * Body: { adminKey }
 */
router.post('/daily-ootd', async (req, res) => {
    try {
        const { adminKey } = req.body;

        // Admin key check
        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Rotating motivational messages
        const messages = [
            { title: '🔥 Rate Your OOTD!', body: 'What are you wearing today? Get your fit rated!' },
            { title: '👀 Fit Check Time!', body: 'Show us what you got — rate your outfit now!' },
            { title: '✨ Daily Fit Rating', body: 'Your outfit deserves a score. Let\'s see it!' },
            { title: '📸 OOTD Alert!', body: 'Snap your fit and get rated by AI!' },
            { title: '🎯 How Hard Is Your Fit?', body: 'Find out your score — tap to rate!' }
        ];

        const message = messages[Math.floor(Math.random() * messages.length)];
        const count = await PushService.sendBroadcast({
            ...message,
            data: { type: 'daily_ootd', action: 'open_camera' }
        });

        res.json({
            success: true,
            sentCount: count,
            message: `Daily OOTD sent to ${count} users`,
            notificationUsed: message.title
        });
    } catch (err) {
        console.error('Daily OOTD error:', err);
        res.status(500).json({ error: 'Failed to send daily OOTD' });
    }
});

export default router;
