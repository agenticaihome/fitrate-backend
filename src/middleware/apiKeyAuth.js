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
 * Detect if request is from a mobile app based on User-Agent
 * Mobile apps (Capacitor, React Native, Expo) often don't send Origin headers
 */
function isMobileAppRequest(req) {
    const userAgent = req.headers['user-agent'] || '';
    const ua = userAgent.toLowerCase();

    // Common mobile app indicators
    const mobileIndicators = [
        'capacitor',           // Capacitor apps (iOS/Android)
        'ionic',               // Ionic framework
        'expo',                // Expo apps
        'react-native',        // React Native
        'fitrate',             // Our app identifier
        'darwin',              // iOS native
        'cfnetwork',           // iOS native HTTP
        'okhttp',              // Android native HTTP
        // Standard mobile browser indicators
        'mobile',
        'android',
        'iphone',
        'ipad',
        'ipod'
    ];

    return mobileIndicators.some(indicator => ua.includes(indicator));
}

/**
 * Origin validation middleware
 * Ensures requests come from allowed origins
 * SECURITY: Uses exact matching, with mobile app exception
 *
 * Mobile apps (Capacitor, React Native, Expo) often don't send Origin headers
 * or send non-standard ones. We detect these via User-Agent and allow them.
 */
export function validateOrigin(req, res, next) {
    // Skip for webhooks, health checks, and diagnostics
    if (req.path === '/health' || req.path.startsWith('/api/webhook') || req.path.startsWith('/api/diag')) {
        return next();
    }

    const origin = req.headers.origin;

    // Extended allowed origins including mobile app schemes
    const defaultOrigins = [
        'https://fitrate.app',
        'https://www.fitrate.app',
        'http://localhost:5173',
        'http://localhost:3000',
        // Mobile app schemes (Capacitor, Ionic, Expo)
        'capacitor://localhost',
        'ionic://localhost',
        'http://localhost',        // React Native / Expo dev
        'exp://localhost',         // Expo Go
        'exp://192.168',           // Expo on local network (prefix match handled below)
    ];

    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || defaultOrigins;

    // MOBILE APP EXCEPTION: Allow requests without Origin from mobile apps
    // Mobile apps (Capacitor, React Native, etc.) don't always send Origin headers
    if (!origin) {
        if (process.env.NODE_ENV === 'production') {
            // Check if this looks like a mobile app request
            if (isMobileAppRequest(req)) {
                console.log(`📱 Mobile app request allowed without Origin (UA: ${req.headers['user-agent']?.slice(0, 50)}...)`);
                return next();
            }

            console.warn(`🚫 Missing origin header from ${req.ip} (UA: ${req.headers['user-agent']?.slice(0, 50)})`);
            return res.status(403).json({
                success: false,
                error: 'Forbidden: Origin header required'
            });
        }
        // In development, allow missing origin for easier testing
        return next();
    }

    // SECURITY: Use exact matching, not startsWith (prevents fitrate.app.evil.com bypass)
    // Exception: Allow Expo local network origins (exp://192.168.x.x)
    const isAllowed = allowedOrigins.includes(origin) ||
                      origin.startsWith('exp://192.168.') ||
                      origin.startsWith('exp://10.') ||
                      origin.startsWith('http://192.168.') ||
                      origin.startsWith('http://10.');

    if (!isAllowed) {
        // If not in allowed list but looks like a mobile app, allow it
        if (isMobileAppRequest(req)) {
            console.log(`📱 Mobile app request with non-standard origin allowed: ${origin}`);
            return next();
        }

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
