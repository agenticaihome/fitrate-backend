/**
 * Restore Routes
 * API endpoint for Pro account restoration
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { EntitlementService } from '../services/entitlements.js';

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
 * Restore Pro status by email - SINGLE DEVICE ENFORCEMENT
 * 
 * Body: { userId: string, email: string }
 * 
 * Security:
 * - Revokes all previously linked devices
 * - Only the requesting device gets Pro
 * - Rate limited to 5 attempts/hour
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

        // Call the restore function with single-device enforcement
        const result = await EntitlementService.restoreProByEmail(userId, email);

        if (result.success) {
            return res.json({
                success: true,
                message: 'Pro restored! Your previous devices have been signed out.',
                revokedDevices: result.revokedDevices
            });
        } else {
            return res.status(404).json({
                success: false,
                error: result.message
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
 * Check if an email has Pro (pre-validation before restore)
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

        const hasPro = await EntitlementService.hasProByEmail(email);

        return res.json({
            success: true,
            hasPro
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
