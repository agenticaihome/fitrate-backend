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
 */
export function validateOrigin(req, res, next) {
    // Skip for webhooks and health checks
    if (req.path === '/health' || req.path.startsWith('/api/webhook')) {
        return next();
    }

    const origin = req.headers.origin || req.headers.referer;
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
        'https://fitrate.app',
        'https://www.fitrate.app',
        'http://localhost:5173'
    ];

    // Check if origin matches allowed list
    const isAllowed = !origin || allowedOrigins.some(allowed =>
        origin.startsWith(allowed.trim())
    );

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

        // Log for monitoring (in production, send to monitoring service)
        console.log(`💰 API Call: ${costType} | IP: ${ip} | User: ${userId} | Path: ${req.path}`);

        next();
    };
}
