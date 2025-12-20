# FitRate Backend - AI Agent Master Prompt

You are an expert AI assistant for the FitRate backend - an outfit rating API that uses AI (Gemini for free users, GPT-4o for Pro users) to analyze outfit photos and generate shareable scorecards.

## CRITICAL UNDERSTANDING

### What FitRate Does
- Users upload outfit photos
- AI analyzes the outfit and returns a score (0-100), verdict, roast lines, and celeb match
- Free users get 2 scans/day via Gemini
- Pro users get 25 scans/day via GPT-4o with additional modes (honest, savage)

### The Scan Flow (Where Things Can Fail)

```
REQUEST → scanLimiter middleware → analyze route → AI service → response

1. scanLimiter (src/middleware/scanLimiter.js)
   ├── Bot detection (User-Agent check)
   ├── Multi-account abuse detection
   ├── Invalid attempts block check
   ├── Pro status lookup
   └── Daily limit check

2. analyze route (src/routes/analyze.js)
   ├── Mode validation (nice/roast free, honest/savage pro-only)
   ├── Image validation (quickImageCheck → validateAndSanitizeImage)
   ├── Cache check (skip AI if duplicate)
   └── AI call (Gemini or OpenAI)

3. AI Service (src/services/geminiAnalyzer.js or outfitAnalyzer.js)
   ├── API key check
   ├── Build system prompt
   ├── Send image to AI
   ├── Parse JSON response
   └── Return result
```

## KEY FILES AND PURPOSES

| File | Purpose | Common Issues |
|------|---------|---------------|
| `src/config/systemPrompt.js` | AI prompts, limits, error messages | Prompt too long, wrong output format |
| `src/config/index.js` | Environment config (API keys) | Missing GEMINI_API_KEY or OPENAI_API_KEY |
| `src/middleware/scanLimiter.js` | Rate limiting, abuse detection | False positive bot detection, limit reached |
| `src/routes/analyze.js` | Main scan endpoint | Image validation failures |
| `src/services/geminiAnalyzer.js` | Gemini API calls (free tier) | API errors, JSON parse failures |
| `src/services/outfitAnalyzer.js` | OpenAI API calls (pro tier) | API errors, rate limits |
| `src/utils/fingerprint.js` | Device fingerprinting, bot detection | UA too short, bot pattern match |
| `src/utils/imageValidator.js` | Image validation | Size/dimension issues |
| `src/utils/contentSanitizer.js` | Filter banned terms from AI output | Over-sanitization |
| `src/services/redisClient.js` | Redis connection | Redis unavailable, using fallback |

## BLOCKING CONDITIONS (Why Scans Fail)

### 1. Missing API Keys (MOST COMMON)
```javascript
// Check in src/config/index.js or environment
GEMINI_API_KEY  // Required for free users
OPENAI_API_KEY  // Required for pro users
```
**Error:** `AI_SERVICE_UNAVAILABLE`
**Fix:** Set the environment variable

### 2. Bot Detection (User-Agent Issues)
```javascript
// src/utils/fingerprint.js lines 119-134
// Blocks if:
- User-Agent missing or < 20 characters → "missing_ua"
- Matches: /curl/i, /wget/i, /python/i, /scrapy/i, /bot/i, /spider/i → "bot_ua"
```
**Error:** `BOT_DETECTED` (403)
**Fix:** Use browser-like User-Agent header

### 3. Multi-Account Abuse
```javascript
// src/utils/fingerprint.js lines 89-108
// Same fingerprint (IP+headers) claiming >5 different userIds in 24h
```
**Error:** `ABUSE_DETECTED` (429)
**Fix:** Use consistent userId per device

### 4. Invalid Image Spam
```javascript
// src/middleware/scanLimiter.js lines 30-32
MAX_INVALID_ATTEMPTS = 20  // After 20 bad images
INVALID_BLOCK_DURATION = 3600  // 1 hour block
PERMANENT_BAN_DURATION = 604800  // 7 day ban for repeat offenders
```
**Error:** `INVALID_SPAM_BLOCKED` (429)
**Fix:** Wait 1 hour, use valid outfit photos

### 5. Daily Limit Reached
```javascript
// src/middleware/scanLimiter.js
Free: 2 scans/day
Pro: 25 scans/day
```
**Error:** 429 with `limitReached: true`
**Fix:** Wait for midnight reset or upgrade

### 6. Image Validation Failures
```javascript
// src/utils/imageValidator.js
- Size: 10KB - 10MB (base64 length 10000-15000000)
- Dimensions: 100px - 4096px
- Format: JPEG, PNG, WebP, GIF (validated via magic bytes)
```
**Error:** Various 400 errors
**Fix:** Resize/reformat image

### 7. Pro-Only Mode Access
```javascript
// src/routes/analyze.js lines 203-212
// Free users blocked from: "honest" and "savage" modes
```
**Error:** `PRO_MODE_REQUIRED` (403)
**Fix:** Use "nice" or "roast" mode, or upgrade to Pro

## AI PROMPT CONFIGURATION

### System Prompt Location
`src/config/systemPrompt.js` - `buildSystemPrompt()` function

### Key Settings
```javascript
// Output formats
Free tier: 8 fields (overall, text, verdict, lines, tagline, celebMatch, mode, isValidOutfit)
Pro tier: 12 fields (adds identityReflection, socialPerception, itemRoasts, proTip)

// Score ranges by mode
nice: 65-100
roast: 35-64.9
honest: 0-100
savage: 0-35

// Model routing
Free → Gemini (gemini-2.0-flash)
Pro → GPT-4o
```

### Banned Content (AI must not output)
```javascript
// src/utils/contentSanitizer.js
- Body comments: fat, skinny, weight, curves, body type
- Attractiveness: ugly, beautiful, hot, sexy
- Gender/identity references
- Age comments
- Race/ethnicity
- Explicit content
```

### Outfit Validation (LENIENT)
```
✅ ACCEPT: ANY clothing visible (partial ok, mirror selfie ok)
❌ REJECT: Zero clothing visible (face only, landscape, object)
```

## DEBUGGING CHECKLIST

When a scan fails, check in this order:

### Step 1: Environment
```bash
# Verify API keys are set
echo $GEMINI_API_KEY
echo $OPENAI_API_KEY
```

### Step 2: Use Diagnostic Endpoint
```bash
curl -X POST http://localhost:3001/api/diag/diagnose \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  -d '{"userId": "test", "mode": "nice", "image": "data:image/jpeg;base64,..."}'
```

### Step 3: Check Server Logs
Look for these patterns:
```
[scanLimiter] ===== CHECKING REQUEST =====
[scanLimiter] Suspicious check: {"suspicious":true,"reason":"..."}  ← BLOCKED HERE
[scanLimiter] isPro: false | limit: 2 | used: 2 | remaining: 0     ← LIMIT HIT
[scanLimiter] ✅ PASSED - proceeding to analyze                     ← PASSED
[req_xxx] ===== SCAN REQUEST =====
[req_xxx] Error: Invalid mode - xyz                                 ← MODE ERROR
[req_xxx] Error: Image validation failed                            ← IMAGE ERROR
[gemini_xxx] ❌ CRITICAL: GEMINI_API_KEY not set!                   ← NO API KEY
```

### Step 4: Test AI Directly
```bash
# Test Gemini
curl -X POST http://localhost:3001/api/diag/test-gemini

# Test OpenAI
curl -X POST http://localhost:3001/api/diag/test-openai
```

### Step 5: Clear Blocks (for testing)
```bash
curl -X POST http://localhost:3001/api/diag/clear-blocks \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 (Macintosh)" \
  -d '{"userId": "test-user"}'
```

## COMMON FIXES

### Issue: "Request blocked. Please use a web browser."
**Cause:** Bot detection triggered
**Fix in code:** `src/utils/fingerprint.js` - relax bot patterns or UA length check
**Fix for client:** Add proper User-Agent header

### Issue: "Unable to connect to AI service"
**Cause:** Missing API key
**Fix:** Set GEMINI_API_KEY (free) or OPENAI_API_KEY (pro) environment variable

### Issue: AI returns malformed JSON
**Cause:** Prompt too complex or token limit hit
**Fix in:** `src/services/geminiAnalyzer.js` - increase maxOutputTokens or simplify prompt

### Issue: "Too many failed attempts"
**Cause:** User submitted >20 invalid images
**Fix:** Wait 1 hour, or clear blocks via `/api/diag/clear-blocks`

### Issue: Scan counts not matching between status and analyze
**Cause:** Identity key mismatch (fingerprint vs userId)
**Fix in:** Ensure `getScanCountSecure()` is used consistently

## ARCHITECTURE NOTES

### Identity System
- **Primary:** `userId` (crypto-random UUID from client localStorage)
- **Fallback:** Fingerprint (hash of IP + headers) for anonymous users
- **Issue:** Fingerprints collide on same network/VPN

### Rate Limiting Layers
1. Express rate-limit (10 req/min general)
2. scanLimiter middleware (2/25 scans per day)
3. proRoastLimiter (3/min for expensive OpenAI calls)

### Redis vs In-Memory
- Production: Redis for persistence
- Development: In-memory Map (loses data on restart)
- Check: `isRedisAvailable()` in `src/services/redisClient.js`

## MODIFICATION GUIDELINES

### To Add a New Mode
1. Add to `MODE_CONFIGS` in `src/config/systemPrompt.js`
2. Add to `MODEL_ROUTING` tiers
3. Add to `VIRALITY_HOOKS`
4. Update validation in `src/routes/analyze.js`

### To Change Scan Limits
1. Update `SCAN_LIMITS` in `src/config/systemPrompt.js`
2. Update `LIMITS` in `src/middleware/scanLimiter.js`

### To Modify AI Output Format
1. Update `OUTPUT_FORMAT` in `src/config/systemPrompt.js`
2. Update response parsing in analyzers
3. Update content sanitizer if needed

### To Add Banned Terms
1. Add to arrays in `src/utils/contentSanitizer.js`
2. Add replacement patterns if needed

## QUICK REFERENCE

### Endpoints
```
POST /api/analyze          - Main scan endpoint
GET  /api/analyze/status   - Check remaining scans
POST /api/analyze/pro-roast - Use a Pro Roast
POST /api/diag/diagnose    - Full diagnostic
POST /api/diag/clear-blocks - Clear all blocks
GET  /api/diag/health      - Service status
POST /api/diag/test-gemini - Test Gemini API
POST /api/diag/test-openai - Test OpenAI API
```

### Error Codes
```
BOT_DETECTED         - User-Agent blocked
ABUSE_DETECTED       - Multi-account abuse
INVALID_SPAM_BLOCKED - Too many bad images
PRO_MODE_REQUIRED    - Free user tried pro mode
AI_SERVICE_UNAVAILABLE - Missing API key
AI_CONNECTION_FAILED - AI service error
```

### Environment Variables
```
GEMINI_API_KEY      - Required for free tier
OPENAI_API_KEY      - Required for pro tier
REDIS_URL           - Optional (uses in-memory fallback)
STRIPE_SECRET_KEY   - For payments
NODE_ENV            - development/production
PORT                - Server port (default 3001)
ALLOWED_ORIGINS     - CORS whitelist
```

---

**When debugging, always start with `/api/diag/diagnose` - it tells you exactly what's wrong.**
