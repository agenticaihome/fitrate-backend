/**
 * API Key Authentication Middleware
 * Verifies that requests come from legitimate frontend applications
 */

export function apiKeyAuth(req, res, next) {
    // Skip for health checks and webhooks (Stripe has its own auth)
    if (req.path === '/health' || req.path.startsWith('/api/webhook')) {
        return next();
    }

    const apiKey = req.headers['x-api-key'];
    const validKeys = process.env.FRONTEND_API_KEYS?.split(',') || [];

    // In development, allow requests without API key if no keys configured
    if (validKeys.length === 0 && process.env.NODE_ENV !== 'production') {
        console.warn('⚠️ No FRONTEND_API_KEYS configured - allowing request in dev mode');
        return next();
    }

    // In production, require valid API key
    if (!apiKey || !validKeys.includes(apiKey)) {
        console.warn(`🚫 Unauthorized API request from ${req.ip} - Invalid or missing API key`);
        return res.status(403).json({
            success: false,
            error: 'Unauthorized: Invalid API key'
        });
    }

    next();
}

/**
 * Origin validation middleware
 * Ensures requests come from allowed origins
 * SECURITY: Uses exact matching and requires origin in production
 */
export function validateOrigin(req, res, next) {
    // Skip for webhooks and health checks
    if (req.path === '/health' || req.path.startsWith('/api/webhook')) {
        return next();
    }

    const origin = req.headers.origin;
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [
        'https://fitrate.app',
        'https://www.fitrate.app',
        'http://localhost:5173'
    ];

    // SECURITY: In production, require origin header to prevent curl/Postman bypass
    if (!origin) {
        if (process.env.NODE_ENV === 'production') {
            console.warn(`🚫 Missing origin header from ${req.ip}`);
            return res.status(403).json({
                success: false,
                error: 'Forbidden: Origin header required'
            });
        }
        // In development, allow missing origin for easier testing
        return next();
    }

    // SECURITY: Use exact matching, not startsWith (prevents fitrate.app.evil.com bypass)
    const isAllowed = allowedOrigins.includes(origin);

    if (!isAllowed) {
        console.warn(`🚫 Forbidden origin: ${origin} from ${req.ip}`);
        return res.status(403).json({
            success: false,
            error: 'Forbidden: Invalid origin'
        });
    }

    next();
}

/**
 * Cost tracking middleware
 * Tracks API usage to prevent abuse
 */
export function costTracker(costType = 'scan') {
    return async (req, res, next) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
        const userId = req.body?.userId || req.query?.userId || 'anonymous';

        // SECURITY: Mask user ID in logs (only show first 8 chars)
        const maskedUserId = userId === 'anonymous' ? 'anon' : `${userId.slice(0, 8)}...`;
        console.log(`💰 API: ${costType} | IP: ${ip?.slice(-8)} | User: ${maskedUserId}`);

        next();
    };
}
