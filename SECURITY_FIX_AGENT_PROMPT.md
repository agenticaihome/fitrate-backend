# FitRate Backend Security Remediation Master Prompt

## Agent Instructions

You are a security engineer tasked with fixing all vulnerabilities identified in the FitRate backend security audit. Work through each fix systematically, maintaining backward compatibility while hardening security. After each fix, verify the code still functions correctly.

**Important Guidelines:**
- Do NOT break existing functionality
- Add inline comments explaining security fixes using `// SECURITY:` prefix
- Create helper functions for reusable security patterns
- Run tests after each major fix if available
- Commit after each logical group of fixes

---

## Phase 1: CRITICAL Fixes (Do These First)

### Fix 1.1: Open Redirect in Checkout Session

**File:** `src/routes/checkout.js`
**Line:** 59
**Issue:** Origin header is used directly for redirect URLs without validation

**Required Changes:**
```javascript
// At the top of the file, add:
const ALLOWED_CHECKOUT_ORIGINS = [
    'https://fitrate.app',
    'https://www.fitrate.app'
];

// In the create-session route, replace lines 59-60 with:
// SECURITY: Validate origin against allowlist to prevent open redirect attacks
const safeOrigin = ALLOWED_CHECKOUT_ORIGINS.includes(req.headers.origin)
    ? req.headers.origin
    : 'https://fitrate.app';

success_url: `${safeOrigin}/?success=true`,
cancel_url: `${safeOrigin}/?canceled=true`,
```

### Fix 1.2: Webhook Payment Detection by Product Metadata

**File:** `src/routes/webhook.js`
**Lines:** 67-95
**Issue:** Using `amount_total` to differentiate products is insecure

**Required Changes:**
```javascript
// Replace the amount-based detection with metadata-based detection:

case 'checkout.session.completed': {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    const mode = session.mode;
    const userId = session.metadata?.userId || session.client_reference_id;

    // SECURITY: Use product metadata instead of amount for routing
    const productType = session.metadata?.product;

    // Mask PII in logs
    const maskedEmail = email ? `${email.slice(0, 3)}***@${email.split('@')[1] || '***'}` : 'none';
    const maskedUserId = userId ? `${userId.slice(0, 8)}...` : 'none';

    console.log(`✅ Payment: ${session.id} | product:${productType} | ${mode} | user:${maskedUserId}`);

    const targetUserId = userId || email;

    if (!targetUserId) {
        console.warn('⚠️ No userId or email found for purchase');
        break;
    }

    if (mode === 'payment') {
        // SECURITY: Route by product type, not amount
        switch (productType) {
            case 'scanPack5':
                await addPurchasedScans(targetUserId, 5);
                console.log(`📦 Scan Pack 5 added for user: ${maskedUserId}`);
                break;
            case 'scanPack15':
                await addPurchasedScans(targetUserId, 15);
                console.log(`📦 Scan Pack 15 added for user: ${maskedUserId}`);
                break;
            case 'scanPack50':
                await addPurchasedScans(targetUserId, 50);
                console.log(`📦 Scan Pack 50 added for user: ${maskedUserId}`);
                break;
            case 'proRoast':
                await addProRoast(targetUserId);
                console.log(`🔥 Pro Roast added for user: ${maskedUserId}`);
                break;
            default:
                console.warn(`⚠️ Unknown product type: ${productType}`);
        }
    } else {
        // Subscription
        console.log(`⚡ Pro subscription activated! userId:${maskedUserId} email:${maskedEmail}`);
        await EntitlementService.grantPro(userId, email, 'stripe_subscription');
    }

    break;
}
```

**Also update `src/routes/checkout.js`** to ensure metadata is always set:
```javascript
metadata: {
    userId: userId,
    product: product,  // This must match the switch cases above
},
```

### Fix 1.3: Add Image Validation to Battle Endpoint

**File:** `src/routes/battle.js`
**Issue:** No image validation before expensive OpenAI calls

**Required Changes:**
```javascript
import express from 'express';
import rateLimit from 'express-rate-limit';
import { analyzeBattle } from '../services/outfitAnalyzer.js';
// SECURITY: Import image validation utilities
import { validateAndSanitizeImage, quickImageCheck } from '../utils/imageValidator.js';
import { trackInvalidAttempt, isBlockedForInvalidAttempts } from '../middleware/scanLimiter.js';

const router = express.Router();

const battleLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 2,
    message: {
        success: false,
        error: 'Too many battles! Wait a minute and try again 🔥'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/', battleLimiter, async (req, res) => {
    try {
        const { outfit1, outfit2 } = req.body;

        if (!outfit1 || !outfit2) {
            return res.status(400).json({
                success: false,
                error: 'Two outfits required for battle'
            });
        }

        // SECURITY: Check if user is blocked for spam
        const isBlocked = await isBlockedForInvalidAttempts(req);
        if (isBlocked) {
            return res.status(429).json({
                success: false,
                error: 'Too many failed attempts. Please wait and try again.',
                code: 'INVALID_SPAM_BLOCKED'
            });
        }

        // SECURITY: Quick validation before expensive operations
        if (!quickImageCheck(outfit1) || !quickImageCheck(outfit2)) {
            await trackInvalidAttempt(req);
            return res.status(400).json({
                success: false,
                error: 'Invalid image format. Use JPEG, PNG, or WebP under 10MB.'
            });
        }

        // SECURITY: Full validation with EXIF stripping for both images
        const [validation1, validation2] = await Promise.all([
            validateAndSanitizeImage(outfit1),
            validateAndSanitizeImage(outfit2)
        ]);

        if (!validation1.valid) {
            await trackInvalidAttempt(req);
            return res.status(400).json({
                success: false,
                error: `Outfit 1: ${validation1.error}`
            });
        }

        if (!validation2.valid) {
            await trackInvalidAttempt(req);
            return res.status(400).json({
                success: false,
                error: `Outfit 2: ${validation2.error}`
            });
        }

        // Use sanitized images
        const result = await analyzeBattle(
            validation1.sanitizedImage,
            validation2.sanitizedImage
        );

        return res.json(result);
    } catch (error) {
        console.error('Battle route error:', error);
        return res.status(500).json({
            success: false,
            error: 'Battle failed. Please try again.'
        });
    }
});

export default router;
```

---

## Phase 2: HIGH Severity Fixes

### Fix 2.1: Create Security Utilities Module

**Create new file:** `src/utils/security.js`

```javascript
/**
 * Security Utilities
 * Centralized security helpers for the FitRate backend
 */

import crypto from 'crypto';

/**
 * Constant-time string comparison to prevent timing attacks
 * SECURITY: Use this for all secret comparisons (API keys, tokens, etc.)
 */
export function secureCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }

    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);

    if (aBuffer.length !== bBuffer.length) {
        // Still do comparison to maintain constant time
        crypto.timingSafeEqual(aBuffer, aBuffer);
        return false;
    }

    return crypto.timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Sanitize Redis keys to prevent injection
 * SECURITY: Only allow safe characters in Redis keys
 */
export function sanitizeRedisKey(key) {
    if (!key || typeof key !== 'string') {
        return 'invalid';
    }
    // Allow only alphanumeric, dash, underscore, period
    return key.replace(/[^a-zA-Z0-9_.\-]/g, '').slice(0, 128);
}

/**
 * Sanitize user ID for consistent handling
 * SECURITY: Prevents injection and ensures consistent format
 */
export function sanitizeUserId(userId) {
    if (!userId || typeof userId !== 'string') {
        return null;
    }
    const cleaned = userId.trim().slice(0, 128);
    // Allow alphanumeric, dash, underscore (common in UUIDs and custom IDs)
    if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
        return null;
    }
    return cleaned;
}

/**
 * Validate email format
 * SECURITY: More comprehensive email validation
 */
export function isValidEmail(email) {
    if (!email || typeof email !== 'string') {
        return false;
    }
    // RFC 5322 simplified
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    return emailRegex.test(email) && email.length <= 254;
}

/**
 * Generate cryptographically secure request ID
 * SECURITY: Don't use Math.random() for IDs
 */
export function generateRequestId(prefix = 'req') {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Sanitize string for safe storage/display
 * SECURITY: Remove potential XSS vectors
 */
export function sanitizeString(str, maxLength = 500) {
    if (!str || typeof str !== 'string') {
        return '';
    }

    return str
        // Remove null bytes
        .replace(/\0/g, '')
        // Remove HTML tags
        .replace(/<[^>]*>/g, '')
        // Remove javascript: protocol
        .replace(/javascript:/gi, '')
        // Remove data: protocol (except for safe image types)
        .replace(/data:(?!image\/(jpeg|png|webp|gif))/gi, '')
        // Escape remaining angle brackets
        .replace(/[<>]/g, (char) => char === '<' ? '&lt;' : '&gt;')
        // Limit length
        .slice(0, maxLength)
        .trim();
}

/**
 * Validate origin against allowlist
 * SECURITY: Case-insensitive, normalized matching
 */
export function isAllowedOrigin(origin, allowedOrigins) {
    if (!origin || typeof origin !== 'string') {
        return false;
    }

    const normalizedOrigin = origin.toLowerCase().trim();
    const normalizedAllowed = allowedOrigins.map(o => o.toLowerCase().trim());

    return normalizedAllowed.includes(normalizedOrigin);
}

/**
 * Safe JSON parse with prototype pollution protection
 * SECURITY: Prevents __proto__ injection attacks
 */
export function safeJsonParse(jsonString) {
    return JSON.parse(jsonString, (key, value) => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return undefined;
        }
        return value;
    });
}

/**
 * Allowed occasions for AI prompt (whitelist approach)
 * SECURITY: Prevents prompt injection via occasion parameter
 */
export const ALLOWED_OCCASIONS = [
    'casual', 'formal', 'business', 'date', 'party',
    'wedding', 'interview', 'workout', 'beach', 'travel',
    'concert', 'brunch', 'night out', 'office', 'graduation'
];

export function sanitizeOccasion(occasion) {
    if (!occasion || typeof occasion !== 'string') {
        return null;
    }
    const normalized = occasion.toLowerCase().trim();
    return ALLOWED_OCCASIONS.find(o => o === normalized) || null;
}
```

### Fix 2.2: Update Origin Validation

**File:** `src/middleware/apiKeyAuth.js`

```javascript
// Add import at top
import { isAllowedOrigin } from '../utils/security.js';

// Replace validateOrigin function:
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

    // SECURITY: In production, require origin header
    if (!origin) {
        if (process.env.NODE_ENV === 'production') {
            console.warn(`🚫 Missing origin header from ${req.ip}`);
            return res.status(403).json({
                success: false,
                error: 'Forbidden: Origin header required'
            });
        }
        return next();
    }

    // SECURITY: Case-insensitive origin matching
    if (!isAllowedOrigin(origin, allowedOrigins)) {
        console.warn(`🚫 Forbidden origin: ${origin} from ${req.ip}`);
        return res.status(403).json({
            success: false,
            error: 'Forbidden: Invalid origin'
        });
    }

    next();
}
```

### Fix 2.3: Fix Admin Key Timing Attack

**File:** `src/routes/pro.js`

```javascript
// Add import at top
import { secureCompare, isValidEmail } from '../utils/security.js';

// Update the /add route:
router.post('/add', adminLimiter, async (req, res) => {
    const devKey = req.headers['x-dev-key'];
    const expectedKey = process.env.DEV_API_KEY;

    // Block in production if no DEV_API_KEY is configured
    if (process.env.NODE_ENV === 'production' && !expectedKey) {
        return res.status(403).json({ error: 'Not allowed in production' });
    }

    // SECURITY: Constant-time comparison prevents timing attacks
    if (expectedKey && !secureCompare(devKey || '', expectedKey)) {
        return res.status(401).json({ error: 'Invalid dev key' });
    }

    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    // SECURITY: Use improved email validation
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    await EntitlementService.grantPro(null, email, 'admin_add');
    res.json({ success: true, email: email.toLowerCase().trim() });
});
```

**Also update `src/index.js`** for admin key on diag route:

```javascript
// Add import
import { secureCompare } from './utils/security.js';

// Update the diag route middleware:
app.use('/api/diag', (req, res, next) => {
    if (config.nodeEnv === 'production') {
        const adminKey = req.headers['x-admin-key'];
        const expectedKey = process.env.ADMIN_KEY;

        // SECURITY: Constant-time comparison
        if (!expectedKey || !secureCompare(adminKey || '', expectedKey)) {
            return res.status(403).json({ error: 'Admin access required' });
        }
    }
    next();
}, diagRoutes);
```

### Fix 2.4: Fix XSS in Feedback Endpoint

**File:** `src/routes/analyze.js`

```javascript
// Add import at top
import { sanitizeString, generateRequestId } from '../utils/security.js';

// Update the feedback endpoint:
router.post('/feedback', async (req, res) => {
    const { resultId, rating, comment, userId } = req.body;

    if (!resultId || !rating) {
        return res.status(400).json({ success: false, error: 'Result ID and rating required' });
    }

    if (rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, error: 'Rating must be 1-5' });
    }

    // SECURITY: Use centralized sanitization
    const feedback = {
        resultId: sanitizeString(resultId, 100),
        rating: Math.min(5, Math.max(1, parseInt(rating) || 3)),
        comment: sanitizeString(comment, 500),
        userId: sanitizeString(userId, 128) || 'anonymous',
        ts: Date.now()
    };

    if (isRedisAvailable()) {
        await redis.lpush('fitrate:feedback:ratings', JSON.stringify(feedback));
        await redis.ltrim('fitrate:feedback:ratings', 0, 999);
    }

    console.log(`📝 Feedback received: ${feedback.rating}/5 for ${feedback.resultId.slice(0, 20)}`);
    res.json({ success: true, message: 'Thanks for the feedback!' });
});
```

Also update the main analyze route to use `generateRequestId`:
```javascript
// Replace line ~180
const requestId = generateRequestId('req');
```

---

## Phase 3: MEDIUM Severity Fixes

### Fix 3.1: Sanitize Occasion Parameter (Prompt Injection Prevention)

**File:** `src/services/outfitAnalyzer.js`

```javascript
// Add import at top
import { sanitizeOccasion } from '../utils/security.js';

// Update createAnalysisPrompt function:
function createAnalysisPrompt(occasion, mode, securityContext = {}) {
    // ... existing code ...

    let prompt = buildSystemPrompt('pro', mode, fullSecurityContext);

    // SECURITY: Sanitize occasion to prevent prompt injection
    const safeOccasion = sanitizeOccasion(occasion);
    if (safeOccasion) {
        prompt += `\n\nOCCASION CONTEXT: Rate for "${safeOccasion}" appropriateness.`;
    }

    return prompt;
}
```

**File:** `src/services/geminiAnalyzer.js`

```javascript
// Add import at top
import { sanitizeOccasion } from '../utils/security.js';

// Update createGeminiPrompt function:
function createGeminiPrompt(mode, occasion, securityContext = {}) {
    // ... existing code ...

    let prompt = buildSystemPrompt('free', mode, fullSecurityContext);

    // SECURITY: Sanitize occasion to prevent prompt injection
    const safeOccasion = sanitizeOccasion(occasion);
    if (safeOccasion) {
        prompt += `\n\nOCCASION CONTEXT: Rate for "${safeOccasion}" appropriateness.`;
    }

    return prompt;
}
```

### Fix 3.2: Sanitize Redis Keys

**File:** `src/middleware/scanLimiter.js`

```javascript
// Add import at top
import { sanitizeRedisKey, sanitizeUserId } from '../utils/security.js';

// Update getSecureKey function:
function getSecureKey(req) {
    const fingerprint = generateFingerprint(req);
    const rawUserId = req?.body?.userId || req?.query?.userId;

    // SECURITY: Sanitize userId before using in Redis key
    const userId = sanitizeUserId(rawUserId);

    return userId ? `${fingerprint}:${sanitizeRedisKey(userId)}` : fingerprint;
}

// Update getLegacyKey function:
function getLegacyKey(userId, ip) {
    // SECURITY: Sanitize inputs for Redis keys
    const safeUserId = sanitizeUserId(userId);
    const safeIp = ip ? sanitizeRedisKey(ip) : null;
    return safeUserId || safeIp || 'unknown';
}
```

**File:** `src/middleware/referralStore.js`

```javascript
// Add import at top
import { sanitizeRedisKey, sanitizeUserId } from '../utils/security.js';

// Update addReferral function:
export async function addReferral(referrerId, refereeFingerprint, refereeUserId = null) {
    // SECURITY: Sanitize all inputs
    const safeReferrerId = sanitizeUserId(referrerId);
    const safeFingerprint = sanitizeRedisKey(refereeFingerprint);
    const safeRefereeUserId = sanitizeUserId(refereeUserId);

    if (!safeReferrerId || !safeFingerprint) {
        return { success: false, reason: 'invalid_params' };
    }

    // Block self-referral
    if (safeRefereeUserId && safeRefereeUserId === safeReferrerId) {
        console.warn(`⚠️ FRAUD: Self-referral attempt blocked: ${safeReferrerId}`);
        return { success: false, reason: 'self_referral' };
    }

    const key = `${safeReferrerId}:${safeFingerprint}`;

    // ... rest of function uses safeReferrerId instead of referrerId
}
```

### Fix 3.3: Safe JSON Parsing for AI Responses

**File:** `src/services/geminiAnalyzer.js`

```javascript
// Add import at top
import { safeJsonParse } from '../utils/security.js';

// Update the JSON parsing section (around line 164-200):
let parsed;
try {
    // SECURITY: Use safe JSON parse to prevent prototype pollution
    parsed = safeJsonParse(jsonStr);
} catch (parseError) {
    console.warn(`[${requestId}] JSON parse failed, attempting repair: ${parseError.message}`);

    let repaired = jsonStr;

    // Count brackets and close any that are open
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;

    if (repaired.match(/"[^"]*$/)) {
        repaired += '"';
    }

    for (let i = 0; i < openBrackets - closeBrackets; i++) {
        repaired += ']';
    }

    for (let i = 0; i < openBraces - closeBraces; i++) {
        repaired += '}';
    }

    try {
        // SECURITY: Use safe parse for repaired JSON too
        parsed = safeJsonParse(repaired);
        console.log(`[${requestId}] JSON repair successful`);
    } catch (repairError) {
        throw parseError;
    }
}
```

### Fix 3.4: Reduce JSON Body Limits

**File:** `src/index.js`

```javascript
// Replace the current body parsing middleware:

// Body parsing with appropriate limits
// 1. Webhook needs RAW body for signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// 2. SECURITY: Per-endpoint body limits
app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api/webhook')) {
        return next();
    }

    // Image endpoints need larger limit
    if (req.originalUrl.startsWith('/api/analyze') ||
        req.originalUrl.startsWith('/api/battle')) {
        return express.json({ limit: '5mb' })(req, res, next);
    }

    // All other endpoints get minimal limit
    express.json({ limit: '100kb' })(req, res, next);
});
```

### Fix 3.5: Secure Entitlements File Storage

**File:** `src/services/entitlements.js`

```javascript
// Update ensureDataDir function:
async function ensureDataDir() {
    try {
        // SECURITY: Create with restrictive permissions
        await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });

        // SECURITY: Verify we're in expected location
        const realPath = await fs.realpath(DATA_DIR);
        const expectedBase = path.resolve(__dirname, '../..');

        if (!realPath.startsWith(expectedBase)) {
            console.error('SECURITY: Data directory outside expected path!');
            throw new Error('Invalid data directory path');
        }
    } catch (err) {
        if (err.code !== 'EEXIST') {
            console.error('Failed to create data dir:', err);
        }
    }
}

// Update persist function:
async function persist() {
    if (isRedisAvailable()) return;

    try {
        const data = {
            entitlements: Object.fromEntries(cache.entitlements),
            identityMap: Object.fromEntries(
                Array.from(cache.identityMap.entries()).map(([k, v]) => [k, Array.from(v)])
            )
        };

        // SECURITY: Write with restrictive permissions
        await fs.writeFile(ENTITLEMENTS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (err) {
        console.error('Failed to save entitlements:', err);
    }
}
```

---

## Phase 4: LOW Severity Fixes

### Fix 4.1: Add Missing Security Headers

**File:** `src/index.js`

```javascript
// Update helmet configuration:
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    noSniff: true,
    frameguard: { action: 'deny' },
    // SECURITY: Add Content Security Policy
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "https://api.stripe.com"],
            frameSrc: ["https://js.stripe.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        }
    },
    // SECURITY: Add Permissions Policy
    permissionsPolicy: {
        features: {
            geolocation: [],
            microphone: [],
            camera: [],
            magnetometer: [],
            gyroscope: [],
            accelerometer: [],
        }
    }
}));
```

### Fix 4.2: Improve Email Validation

**File:** `src/routes/pro.js`

Already fixed in Phase 2 with `isValidEmail` import.

### Fix 4.3: Add Rate Limiting to Feedback Endpoint

**File:** `src/routes/analyze.js`

```javascript
// Add near the top with other rate limiters:
const feedbackLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many feedback submissions' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Update the feedback route:
router.post('/feedback', feedbackLimiter, async (req, res) => {
    // ... existing code
});
```

### Fix 4.4: Remove Sensitive Info from Diag Endpoint in Production

**File:** `src/routes/diag.js`

```javascript
router.get('/', (req, res) => {
    // SECURITY: Minimal info in production
    if (process.env.NODE_ENV === 'production') {
        return res.json({
            service: 'fitrate-api',
            status: 'ok',
            timestamp: new Date().toISOString()
        });
    }

    // Development only - detailed info
    const hasOpenAIKey = !!(config.openai.apiKey && config.openai.apiKey.startsWith('sk-'));
    const hasGeminiKey = !!config.gemini.apiKey;

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
```

---

## Phase 5: Validation & Testing

After completing all fixes:

1. **Run the application:**
   ```bash
   npm run dev
   ```

2. **Test critical endpoints:**
   - POST /api/analyze with valid image
   - POST /api/battle with two images
   - POST /api/checkout/create-session
   - POST /api/pro/check
   - GET /api/analyze/status

3. **Test security fixes:**
   - Try Origin header manipulation on checkout
   - Verify admin endpoints reject invalid keys
   - Test image validation on battle endpoint
   - Verify occasion parameter is sanitized

4. **Commit all changes:**
   ```bash
   git add -A
   git commit -m "security: implement comprehensive vulnerability fixes

   - Fix open redirect in checkout (CRITICAL)
   - Add image validation to battle endpoint (CRITICAL)
   - Use product metadata for webhook routing (CRITICAL)
   - Add constant-time string comparison (HIGH)
   - Fix origin validation case sensitivity (HIGH)
   - Add XSS protection to feedback (HIGH)
   - Sanitize occasion parameter for AI (MEDIUM)
   - Sanitize Redis keys (MEDIUM)
   - Add safe JSON parsing (MEDIUM)
   - Reduce JSON body limits (MEDIUM)
   - Add CSP and security headers (LOW)
   - Add rate limiting to feedback (LOW)
   - Create centralized security utilities
   "
   ```

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `src/utils/security.js` | **NEW** - Centralized security utilities |
| `src/routes/checkout.js` | Fix open redirect |
| `src/routes/webhook.js` | Use product metadata |
| `src/routes/battle.js` | Add image validation |
| `src/routes/analyze.js` | XSS fix, rate limiting, request IDs |
| `src/routes/pro.js` | Timing attack fix, email validation |
| `src/routes/diag.js` | Remove sensitive info |
| `src/middleware/apiKeyAuth.js` | Origin case sensitivity |
| `src/middleware/scanLimiter.js` | Redis key sanitization |
| `src/middleware/referralStore.js` | Input sanitization |
| `src/services/outfitAnalyzer.js` | Occasion sanitization |
| `src/services/geminiAnalyzer.js` | Occasion sanitization, safe JSON |
| `src/services/entitlements.js` | File permission security |
| `src/index.js` | Body limits, headers, timing fix |

---

## Post-Fix Recommendations

1. **Add automated security testing** with OWASP ZAP or similar
2. **Set up dependency vulnerability scanning** with Snyk or npm audit in CI
3. **Implement request signing** for additional frontend-backend trust
4. **Add structured logging** with log levels for production
5. **Consider Web Application Firewall (WAF)** for additional protection
