import express from 'express';
import { config } from '../config/index.js';

const router = express.Router();

// Admin key middleware - protects all diag routes
const requireAdminKey = (req, res, next) => {
    const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
    const validKey = process.env.ADMIN_API_KEY || process.env.API_KEY;

    if (!validKey || adminKey !== validKey) {
        return res.status(401).json({ error: 'Unauthorized - Admin key required' });
    }
    next();
};

// Apply admin key check to all diag routes
router.use(requireAdminKey);

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
            REDIS_URL: !!process.env.REDIS_URL,
        }
    });
});

/**
 * Test Redis connection and status
 * GET /api/diag/redis
 */
router.get('/redis', async (req, res) => {
    try {
        const { redis, isRedisAvailable } = await import('../services/redisClient.js');

        const result = {
            redisUrlSet: !!process.env.REDIS_URL,
            redisClientNull: redis === null,
            redisStatus: redis?.status || 'null',
            isAvailable: isRedisAvailable(),
        };

        // If Redis is available, try a simple operation
        if (isRedisAvailable()) {
            try {
                await redis.set('fitrate:diag:test', 'ok', 'EX', 10);
                const testValue = await redis.get('fitrate:diag:test');
                result.testWrite = testValue === 'ok';

                // Check current event key
                const eventKey = await redis.get('fitrate:event:current');
                result.hasEventKey = !!eventKey;
                if (eventKey) {
                    const event = JSON.parse(eventKey);
                    result.currentTheme = event.theme;
                    result.currentWeekId = event.weekId;
                }

                // Check leaderboard entries
                const weekId = result.currentWeekId || 'unknown';
                const leaderboardSize = await redis.zcard(`fitrate:event:scores:${weekId}`);
                result.leaderboardSize = leaderboardSize;

            } catch (opError) {
                result.operationError = opError.message;
            }
        }

        res.json({ success: true, redis: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
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
 * Test full scan pipeline with a test image
 * POST /api/diag/test-scan
 * Body: { image: "base64..." } (optional - uses test image if not provided)
 */
router.post('/test-scan', async (req, res) => {
    const requestId = `test_${Date.now()}`;
    console.log(`[${requestId}] === TEST SCAN STARTED ===`);

    try {
        // Use provided image or a simple test pattern
        const image = req.body?.image;

        if (!image) {
            return res.json({
                requestId,
                success: false,
                error: 'Please provide an image in the request body: { "image": "data:image/jpeg;base64,..." }'
            });
        }

        console.log(`[${requestId}] Image provided, length: ${image.length}`);

        // Import Gemini analyzer
        const { analyzeWithGemini } = await import('../services/geminiAnalyzer.js');

        console.log(`[${requestId}] Calling Gemini...`);
        const startTime = Date.now();

        const result = await analyzeWithGemini(image, {
            mode: 'nice',
            securityContext: { userId: 'test', scansUsed: 0, dailyLimit: 2 }
        });

        const duration = Date.now() - startTime;
        console.log(`[${requestId}] Gemini returned in ${duration}ms:`, JSON.stringify(result).slice(0, 500));

        return res.json({
            requestId,
            success: result.success,
            duration: `${duration}ms`,
            result: result.success ? {
                overall: result.scores?.overall,
                verdict: result.scores?.verdict,
                text: result.scores?.text?.slice(0, 100) + '...'
            } : {
                error: result.error
            }
        });
    } catch (error) {
        console.error(`[${requestId}] Test scan error:`, error);
        return res.status(500).json({
            requestId,
            success: false,
            error: error.message,
            stack: error.stack?.split('\n').slice(0, 5)
        });
    }
});

export default router;
