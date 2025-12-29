/**
 * Restore Routes
 * API endpoint for Pro account and scan pack restoration
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { EntitlementService } from '../services/entitlements.js';
import { redis, isRedisAvailable } from '../services/redisClient.js';
import { getPurchasedScans, addPurchasedScans } from '../middleware/referralStore.js';

const router = express.Router();

// Strict rate limit - prevent abuse attempts
const restoreLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 attempts per hour per IP
    message: { success: false, error: 'Too many restore attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * POST /api/restore
 * Restore Pro status AND purchased scans by email
 * 
 * Body: { userId: string, email: string }
 * 
 * This will:
 * 1. Restore Pro subscription if associated with email
 * 2. Transfer any scans stored under email to new userId
 * 3. Link the new userId to email for future recovery
 */
router.post('/', restoreLimiter, async (req, res) => {
    try {
        const { userId, email } = req.body;

        if (!userId || !email) {
            return res.status(400).json({
                success: false,
                error: 'Both userId and email are required'
            });
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        let restoredPro = false;
        let restoredScans = 0;
        let revokedDevices = 0;

        // 1. Try to restore Pro subscription
        const proResult = await EntitlementService.restoreProByEmail(userId, email);
        if (proResult.success) {
            restoredPro = true;
            revokedDevices = proResult.revokedDevices || 0;
        }

        // 2. Restore purchased scans from email backup
        if (isRedisAvailable()) {
            // Check if there are scans stored under the email
            const emailScans = await getPurchasedScans(normalizedEmail);

            if (emailScans > 0) {
                // Transfer scans from email to new userId
                await addPurchasedScans(userId, emailScans);
                // Clear the email-based scans (now transferred)
                await redis.set(`fitrate:scans:${normalizedEmail}`, 0);
                restoredScans = emailScans;
                console.log(`🔄 Restored ${emailScans} scans from email ${normalizedEmail.slice(0, 3)}*** to user ${userId.slice(0, 8)}...`);
            }

            // 3. Check for linked userId and transfer those scans too
            const linkedUserId = await redis.get(`fitrate:email:user:${normalizedEmail}`);
            if (linkedUserId && linkedUserId !== userId) {
                const linkedScans = await getPurchasedScans(linkedUserId);
                if (linkedScans > 0) {
                    await addPurchasedScans(userId, linkedScans);
                    // Clear old userId scans (now transferred)
                    await redis.set(`fitrate:scans:${linkedUserId}`, 0);
                    restoredScans += linkedScans;
                    console.log(`🔄 Transferred ${linkedScans} scans from old userId ${linkedUserId.slice(0, 8)}... to ${userId.slice(0, 8)}...`);
                }
            }

            // 4. Link new userId to email for future
            await redis.set(`fitrate:email:user:${normalizedEmail}`, userId);
            await redis.set(`fitrate:user:email:${userId}`, normalizedEmail);
        }

        // Check if anything was restored
        if (restoredPro || restoredScans > 0) {
            return res.json({
                success: true,
                message: restoredPro && restoredScans > 0
                    ? `Pro restored + ${restoredScans} scans recovered! 🎉`
                    : restoredPro
                        ? 'Pro restored! Previous devices signed out.'
                        : `${restoredScans} scans recovered! 🎉`,
                restoredPro,
                restoredScans,
                revokedDevices
            });
        } else {
            return res.status(404).json({
                success: false,
                error: 'No purchases found for this email. Make sure you\'re using the same email from checkout.'
            });
        }
    } catch (error) {
        console.error('Restore error:', error);
        return res.status(500).json({
            success: false,
            error: 'Something went wrong. Please try again.'
        });
    }
});

/**
 * GET /api/restore/check
 * Check if an email has Pro or purchased scans
 * 
 * Query: ?email=xxx
 */
router.get('/check', restoreLimiter, async (req, res) => {
    try {
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const hasPro = await EntitlementService.hasProByEmail(email);

        let purchasedScans = 0;
        if (isRedisAvailable()) {
            // Check scans under email
            purchasedScans = await getPurchasedScans(normalizedEmail);

            // Also check linked userId
            const linkedUserId = await redis.get(`fitrate:email:user:${normalizedEmail}`);
            if (linkedUserId) {
                purchasedScans += await getPurchasedScans(linkedUserId);
            }
        }

        return res.json({
            success: true,
            hasPro,
            purchasedScans,
            hasAnything: hasPro || purchasedScans > 0
        });
    } catch (error) {
        console.error('Check error:', error);
        return res.status(500).json({
            success: false,
            error: 'Something went wrong'
        });
    }
});

export default router;
