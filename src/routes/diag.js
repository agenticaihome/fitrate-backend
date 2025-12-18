import express from 'express';
import { config } from '../config/index.js';

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

export default router;
