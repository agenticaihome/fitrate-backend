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

export default router;
