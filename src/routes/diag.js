import express from 'express';
import { config } from '../config/index.js';
import { redis, isRedisAvailable } from '../services/redisClient.js';
import { generateFingerprint, getClientIP, checkSuspiciousBehavior } from '../utils/fingerprint.js';
import { getScanCountSecure, getProStatus, isBlockedForInvalidAttempts } from '../middleware/scanLimiter.js';
import { getReferralStats } from '../middleware/referralStore.js';
import { quickImageCheck, validateAndSanitizeImage } from '../utils/imageValidator.js';

const router = express.Router();

/**
 * Diagnostic endpoint to verify OpenAI configuration
 * GET /api/diag
 * Returns boolean flags for security (never returns actual keys)
 */
router.get('/', (req, res) => {
    const hasOpenAIKey = !!(config.openai.apiKey && config.openai.apiKey.startsWith('sk-'));
    const hasGeminiKey = !!config.gemini.apiKey;

    // SECURITY: Only return boolean flags, never expose actual values or partial keys
    res.json({
        service: 'fitrate-api',
        timestamp: new Date().toISOString(),
        runtime: 'node',
        config: {
            hasOpenAIKey,
            hasGeminiKey,
            model: config.openai.model,
            nodeEnv: config.nodeEnv,
            rateLimitMax: config.rateLimit.maxRequests,
            // SECURITY: Don't expose allowedOrigins - helps attackers craft bypass attempts
        },
        envVarsLoaded: {
            PORT: !!process.env.PORT,
            NODE_ENV: !!process.env.NODE_ENV,
            OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
            GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
            ALLOWED_ORIGINS: !!process.env.ALLOWED_ORIGINS,
            STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
        }
    });
});

/**
 * Test OpenAI connection with a simple text-only request
 * POST /api/diag/test-openai
 */
router.post('/test-openai', async (req, res) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[${requestId}] Testing OpenAI connection...`);

    if (!config.openai.apiKey) {
        console.error(`[${requestId}] OPENAI_API_KEY not configured`);
        return res.status(500).json({
            requestId,
            success: false,
            error: 'OPENAI_API_KEY not configured'
        });
    }

    try {
        const { default: OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: config.openai.apiKey });

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 50,
            messages: [
                { role: 'user', content: 'Say "FitRate API connection successful!" and nothing else.' }
            ]
        });

        const message = response.choices[0]?.message?.content;
        console.log(`[${requestId}] OpenAI test successful: ${message}`);

        return res.json({
            requestId,
            success: true,
            message,
            model: response.model,
            usage: response.usage
        });
    } catch (error) {
        console.error(`[${requestId}] OpenAI test failed:`, error);

        // Map OpenAI error codes
        let errorType = 'unknown';
        let statusCode = 500;

        if (error.status === 401 || error.code === 'invalid_api_key') {
            errorType = 'invalid_api_key';
            statusCode = 401;
        } else if (error.status === 429) {
            errorType = 'rate_limit';
            statusCode = 429;
        } else if (error.status === 503) {
            errorType = 'openai_unavailable';
            statusCode = 503;
        }

        return res.status(statusCode).json({
            requestId,
            success: false,
            errorType,
            error: error.message || 'OpenAI test failed'
        });
    }
});

/**
 * Test Gemini connection with a simple text-only request
 * POST /api/diag/test-gemini
 */
router.post('/test-gemini', async (req, res) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[${requestId}] Testing Gemini connection...`);

    if (!config.gemini.apiKey) {
        console.error(`[${requestId}] GEMINI_API_KEY not configured`);
        return res.status(500).json({
            requestId,
            success: false,
            error: 'GEMINI_API_KEY not configured'
        });
    }

    try {
        const modelName = config.gemini.model || 'gemini-2.0-flash';
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': config.gemini.apiKey
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: 'Say "FitRate Gemini connection successful!" and nothing else.' }]
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 50
                }
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await response.json();

        if (!response.ok) {
            console.error(`[${requestId}] Gemini API error:`, data);

            // Map Gemini error codes
            let errorType = 'unknown';
            let statusCode = response.status;

            if (response.status === 400 && data.error?.message?.includes('API key')) {
                errorType = 'invalid_api_key';
                statusCode = 401;
            } else if (response.status === 403) {
                errorType = 'invalid_api_key';
            } else if (response.status === 429) {
                errorType = 'rate_limit';
            } else if (response.status === 503 || data.error?.status === 'UNAVAILABLE') {
                errorType = 'gemini_unavailable';
            } else if (response.status === 404) {
                errorType = 'model_not_found';
            }

            return res.status(statusCode).json({
                requestId,
                success: false,
                errorType,
                model: modelName,
                error: data.error?.message || `Gemini API returned ${response.status}`
            });
        }

        const message = data.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log(`[${requestId}] Gemini test successful: ${message}`);

        return res.json({
            requestId,
            success: true,
            message,
            model: modelName,
            usageMetadata: data.usageMetadata
        });
    } catch (error) {
        console.error(`[${requestId}] Gemini test failed:`, error);

        let errorType = 'unknown';
        if (error.name === 'AbortError') {
            errorType = 'timeout';
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            errorType = 'network_error';
        }

        return res.status(500).json({
            requestId,
            success: false,
            errorType,
            error: error.message || 'Gemini test failed'
        });
    }
});

/**
 * MASTER DIAGNOSTIC - Why can't I scan?
 * POST /api/diag/diagnose
 * Send the same payload you'd send to /api/analyze
 * Returns detailed breakdown of what would block the request
 */
router.post('/diagnose', async (req, res) => {
    const report = {
        timestamp: new Date().toISOString(),
        checks: [],
        canScan: true,
        blockers: [],
        warnings: []
    };

    const addCheck = (name, passed, detail, blocker = false) => {
        report.checks.push({ name, passed, detail });
        if (!passed && blocker) {
            report.canScan = false;
            report.blockers.push(`${name}: ${detail}`);
        } else if (!passed) {
            report.warnings.push(`${name}: ${detail}`);
        }
    };

    try {
        // === 1. ENVIRONMENT CHECKS ===
        addCheck(
            'GEMINI_API_KEY',
            !!config.gemini.apiKey,
            config.gemini.apiKey ? `Set (${config.gemini.apiKey.slice(0, 8)}...)` : 'NOT SET - Free users cannot scan!',
            true
        );

        addCheck(
            'OPENAI_API_KEY',
            !!config.openai.apiKey,
            config.openai.apiKey ? `Set (${config.openai.apiKey.slice(0, 8)}...)` : 'NOT SET - Pro users cannot scan!',
            false
        );

        addCheck(
            'Redis',
            isRedisAvailable(),
            isRedisAvailable() ? 'Connected' : 'Not available - using in-memory fallback (data lost on restart)',
            false
        );

        // === 2. REQUEST IDENTITY CHECKS ===
        const ip = getClientIP(req);
        const fingerprint = generateFingerprint(req);
        const userId = req.body?.userId || req.query?.userId;
        const userAgent = req.headers['user-agent'] || '';

        report.identity = {
            ip: ip,
            fingerprint: fingerprint.slice(0, 16) + '...',
            userId: userId || 'NOT PROVIDED',
            userAgent: userAgent.slice(0, 80) + (userAgent.length > 80 ? '...' : '')
        };

        addCheck(
            'User-Agent Length',
            userAgent.length >= 20,
            `Length: ${userAgent.length} (min 20 required)`,
            userAgent.length < 20
        );

        // Check for bot patterns
        const botPatterns = [/curl/i, /wget/i, /python/i, /scrapy/i, /bot/i, /spider/i];
        const matchedBot = botPatterns.find(p => p.test(userAgent));
        addCheck(
            'Bot Detection',
            !matchedBot,
            matchedBot ? `Matched bot pattern: ${matchedBot}` : 'No bot patterns detected',
            !!matchedBot
        );

        // === 3. ABUSE DETECTION CHECKS ===
        const suspiciousCheck = await checkSuspiciousBehavior(req, userId);
        addCheck(
            'Suspicious Behavior',
            !suspiciousCheck.suspicious,
            suspiciousCheck.suspicious
                ? `BLOCKED: ${suspiciousCheck.reason}${suspiciousCheck.userCount ? ` (${suspiciousCheck.userCount} userIds)` : ''}`
                : 'No suspicious behavior detected',
            suspiciousCheck.suspicious
        );

        const invalidBlocked = await isBlockedForInvalidAttempts(req);
        addCheck(
            'Invalid Attempts Block',
            !invalidBlocked,
            invalidBlocked ? 'BLOCKED: Too many invalid image attempts (wait 1 hour)' : 'Not blocked',
            invalidBlocked
        );

        // === 4. RATE LIMIT CHECKS ===
        const isPro = await getProStatus(userId, ip);
        const currentCount = await getScanCountSecure(req);
        const limit = isPro ? 25 : 2;
        const remaining = Math.max(0, limit - currentCount);

        report.scanStatus = {
            isPro,
            scansUsed: currentCount,
            scansLimit: limit,
            scansRemaining: remaining
        };

        addCheck(
            'Daily Scan Limit',
            remaining > 0,
            `${currentCount}/${limit} used, ${remaining} remaining`,
            remaining === 0
        );

        // Check for bonus scans
        if (userId && remaining === 0) {
            const stats = await getReferralStats(userId);
            if (stats.proRoasts > 0) {
                report.warnings.push(`User has ${stats.proRoasts} Pro Roasts available as backup`);
            }
        }

        // === 5. IMAGE VALIDATION (if provided) ===
        const { image, mode = 'nice' } = req.body;

        if (image) {
            // Quick check
            const quickPass = quickImageCheck(image);
            addCheck(
                'Image Quick Check',
                quickPass,
                quickPass
                    ? `Passed (length: ${image.length} chars)`
                    : `Failed - wrong format or size (length: ${image.length}, need 10KB-10MB base64)`,
                !quickPass
            );

            // Full validation
            if (quickPass) {
                try {
                    const validation = await validateAndSanitizeImage(image);
                    addCheck(
                        'Image Full Validation',
                        validation.valid,
                        validation.valid
                            ? `Valid: ${validation.width}x${validation.height} ${validation.originalType}`
                            : `Failed: ${validation.error}`,
                        !validation.valid
                    );
                } catch (e) {
                    addCheck('Image Full Validation', false, `Error: ${e.message}`, true);
                }
            }
        } else {
            addCheck('Image Provided', false, 'No image in request body', true);
        }

        // === 6. MODE VALIDATION ===
        const validModes = ['nice', 'roast', 'honest', 'savage'];
        const requestedMode = req.body?.mode || 'nice';
        addCheck(
            'Mode Valid',
            validModes.includes(requestedMode),
            `Mode: "${requestedMode}" ${validModes.includes(requestedMode) ? '(valid)' : '(invalid - use nice, roast, honest, or savage)'}`,
            !validModes.includes(requestedMode)
        );

        if (['honest', 'savage'].includes(requestedMode) && !isPro) {
            addCheck(
                'Pro Mode Access',
                false,
                `Mode "${requestedMode}" requires Pro subscription`,
                true
            );
        }

        // === SUMMARY ===
        report.summary = report.canScan
            ? '✅ All checks passed - scan should work!'
            : `❌ ${report.blockers.length} blocker(s) found - scan will fail`;

        // Add fix suggestions
        if (!report.canScan) {
            report.fixes = report.blockers.map(b => {
                if (b.includes('GEMINI_API_KEY')) return 'Set GEMINI_API_KEY environment variable';
                if (b.includes('User-Agent')) return 'Add a browser-like User-Agent header (min 20 chars)';
                if (b.includes('Bot Detection')) return 'Use a real browser User-Agent, not curl/python/etc';
                if (b.includes('Daily Scan Limit')) return 'Wait for reset or upgrade to Pro';
                if (b.includes('Invalid Attempts')) return 'Wait 1 hour, then use valid outfit photos';
                if (b.includes('multi_account')) return 'Use consistent userId from same device';
                if (b.includes('Image')) return 'Use JPEG/PNG/WebP between 100px-4096px and 10KB-10MB';
                if (b.includes('Mode')) return 'Use valid mode: nice, roast (free) or honest, savage (pro)';
                if (b.includes('Pro Mode')) return 'Upgrade to Pro for honest/savage modes';
                return 'Check the error detail';
            });
        }

        return res.json(report);

    } catch (error) {
        return res.status(500).json({
            error: 'Diagnostic failed',
            message: error.message,
            stack: config.nodeEnv !== 'production' ? error.stack : undefined
        });
    }
});

/**
 * Clear all blocks for current device (for testing)
 * POST /api/diag/clear-blocks
 */
router.post('/clear-blocks', async (req, res) => {
    const fingerprint = generateFingerprint(req);
    const userId = req.body?.userId;
    const today = new Date().toISOString().split('T')[0];

    const keysToDelete = [
        `fitrate:invalid:${fingerprint}`,
        `fitrate:banned:${fingerprint}`,
        `fitrate:suspicious:${fingerprint}`,
        `fitrate:fp:users:${fingerprint}`
    ];

    if (userId) {
        keysToDelete.push(`fitrate:scans:user:${userId}:${today}`);
    }
    keysToDelete.push(`fitrate:scans:fp:${fingerprint}:${today}`);

    if (isRedisAvailable()) {
        for (const key of keysToDelete) {
            await redis.del(key);
        }
        return res.json({
            success: true,
            message: `Cleared all blocks for fingerprint ${fingerprint.slice(0, 16)}...`,
            keysDeleted: keysToDelete
        });
    } else {
        return res.json({
            success: true,
            message: 'Redis not available - using in-memory (restart server to clear)',
            note: 'In-memory store clears on server restart'
        });
    }
});

/**
 * Quick health check with all service status
 * GET /api/diag/health
 */
router.get('/health', async (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            gemini: { configured: !!config.gemini.apiKey, model: config.gemini.model },
            openai: { configured: !!config.openai.apiKey, model: config.openai.model },
            redis: { available: isRedisAvailable() },
            stripe: { configured: !!config.stripe.secretKey }
        },
        env: config.nodeEnv
    });
});

export default router;
