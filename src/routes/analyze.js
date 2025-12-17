import express from 'express';
import { analyzeWithGemini } from '../services/geminiAnalyzer.js';
import { analyzeOutfit as analyzeWithOpenAI } from '../services/outfitAnalyzer.js';
import { scanLimiter, incrementScanCountSecure, getScanCount, LIMITS, getProStatus } from '../middleware/scanLimiter.js';
import { getReferralStats, consumeProRoast, hasProRoast } from '../middleware/referralStore.js';
import { getImageHash, getCachedResult, cacheResult } from '../services/imageHasher.js';
import { redis, isRedisAvailable } from '../services/redisClient.js';
import { validateAndSanitizeImage, quickImageCheck } from '../utils/imageValidator.js';

const router = express.Router();

// Check remaining scans + Pro Roasts
router.get('/status', async (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const userId = req.query.userId;
  const isPro = await getProStatus(userId, ip);
  const limit = isPro ? LIMITS.pro : LIMITS.free;
  const used = await getScanCount(userId, ip);
  const stats = userId ? await getReferralStats(userId) : { proRoasts: 0, totalReferrals: 0 };

  res.json({
    scansUsed: used,
    scansLimit: limit,
    scansRemaining: Math.max(0, limit - used),
    isPro,
    proRoasts: stats.proRoasts,
    referrals: stats.totalReferrals
  });
});

// Feedback endpoint - collect ratings for AI improvement
router.post('/feedback', async (req, res) => {
  const { resultId, rating, comment, userId } = req.body;

  if (!resultId || !rating) {
    return res.status(400).json({ success: false, error: 'Result ID and rating required' });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, error: 'Rating must be 1-5' });
  }

  const feedback = {
    resultId,
    rating,
    comment: comment || '',
    userId: userId || 'anonymous',
    ts: Date.now()
  };

  if (isRedisAvailable()) {
    await redis.lpush('fitrate:feedback:ratings', JSON.stringify(feedback));
    // Keep last 1000 ratings
    await redis.ltrim('fitrate:feedback:ratings', 0, 999);
  }

  console.log(`📝 Feedback received: ${rating}/5 for ${resultId}`);
  res.json({ success: true, message: 'Thanks for the feedback!' });
});

// Use a Pro Roast (from referral or $0.99 purchase) - uses OpenAI
router.post('/pro-roast', async (req, res) => {
  const requestId = `proroast_${Date.now()}`;
  const { image, roastMode, userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'User ID required' });
  }

  if (!image) {
    return res.status(400).json({ success: false, error: 'No image provided' });
  }

  // Check if user has a Pro Roast
  const hasRoast = await hasProRoast(userId);
  if (!hasRoast) {
    return res.status(403).json({
      success: false,
      error: 'No Pro Roasts available',
      needsProRoast: true
    });
  }

  try {
    console.log(`[${requestId}] Pro Roast requested by ${userId}`);

    // Use OpenAI for Pro Roasts (premium quality)
    const result = await analyzeWithOpenAI(image, {
      mode: 'roast',
      roastMode: true,
      occasion: null
    });

    if (result.success) {
      // Consume the Pro Roast
      await consumeProRoast(userId);
      const stats = await getReferralStats(userId);
      console.log(`[${requestId}] Pro Roast consumed - ${stats.proRoasts} remaining`);

      result.proRoastsRemaining = stats.proRoasts;
      result.isProRoast = true;
    }

    return res.json(result);
  } catch (error) {
    console.error(`[${requestId}] Pro Roast error:`, error);
    return res.status(500).json({ success: false, error: 'Pro Roast failed. Please try again.' });
  }
});

// Consume a scan (for free users - no AI call, just tracks usage by userId)
router.post('/consume', scanLimiter, async (req, res) => {
  const { userId, ip, limit, isPro, usedBonus } = req.scanInfo;

  let newCount;
  if (usedBonus) {
    newCount = await getScanCount(userId, ip);
  } else {
    newCount = await incrementScanCount(userId, ip);
  }

  const stats = userId ? await getReferralStats(userId) : { proRoasts: 0 };

  res.json({
    success: true,
    scanInfo: {
      scansUsed: newCount,
      scansLimit: limit,
      scansRemaining: Math.max(0, limit - newCount),
      isPro,
      usedBonus,
      proRoasts: stats.proRoasts
    }
  });
});

// Main analyze endpoint with rate limiting
router.post('/', scanLimiter, async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    console.log(`[${requestId}] POST /api/analyze - IP: ${req.ip || 'unknown'}`);
    const { image, roastMode, mode: modeParam, occasion } = req.body;
    // Support both new mode string and legacy roastMode boolean
    const mode = modeParam || (roastMode ? 'roast' : 'nice');

    if (!image) {
      console.log(`[${requestId}] Error: No image provided`);
      return res.status(400).json({
        success: false,
        error: 'No image provided'
      });
    }

    // SECURITY: Quick check before expensive validation
    if (!quickImageCheck(image)) {
      console.log(`[${requestId}] Error: Quick image check failed`);
      return res.status(400).json({
        success: false,
        error: 'Invalid image. Please use JPEG, PNG, or WebP under 10MB.'
      });
    }

    // SECURITY: Full image validation with MIME check and EXIF stripping
    const validation = await validateAndSanitizeImage(image);
    if (!validation.valid) {
      console.log(`[${requestId}] Error: Image validation failed - ${validation.error}`);
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    // Use sanitized image (EXIF stripped, validated)
    const sanitizedImage = validation.sanitizedImage;
    console.log(`[${requestId}] Image validated: ${validation.width}x${validation.height} (${validation.originalType})`);

    // Image hash for caching (prevents duplicate API calls)
    const imageHash = await getImageHash(sanitizedImage);
    const cacheKey = `${imageHash}:${mode}:${occasion || 'none'}`;

    // Check cache first
    const cachedResult = await getCachedResult(cacheKey);
    if (cachedResult) {
      console.log(`[${requestId}] Cache hit - returning cached result`);
      // Still count the scan (using secure fingerprint-based counting)
      const { limit, isPro } = req.scanInfo;
      const newCount = await incrementScanCountSecure(req);
      cachedResult.scanInfo = {
        scansUsed: newCount,
        scansLimit: limit,
        scansRemaining: Math.max(0, limit - newCount),
        isPro,
        cached: true
      };
      return res.json(cachedResult);
    }

    // Route to appropriate AI based on user tier
    const { isPro } = req.scanInfo;
    const analyzer = isPro ? analyzeWithOpenAI : analyzeWithGemini;
    const serviceName = isPro ? 'OpenAI GPT-4o' : 'Gemini';
    console.log(`[${requestId}] Using ${serviceName} (isPro: ${isPro})`);

    const result = await analyzer(sanitizedImage, {
      mode: mode,
      roastMode: mode === 'roast', // backwards compatibility
      occasion: occasion || null
    });

    // SECURITY: Validate AI response structure
    if (result.success && result.scores) {
      // Ensure scores are within expected ranges
      if (result.scores.overall < 0 || result.scores.overall > 100) {
        console.warn(`[${requestId}] SECURITY: Suspicious AI score: ${result.scores.overall}`);
        result.scores.overall = Math.min(100, Math.max(0, result.scores.overall));
      }
    }

    // Only increment count and cache on successful analysis
    if (result.success) {
      const { limit, isPro } = req.scanInfo;
      const newCount = await incrementScanCountSecure(req);

      console.log(`[${requestId}] Success - Scan count: ${newCount}/${limit} (isPro: ${isPro})`);

      // Cache the result for future duplicate requests
      await cacheResult(cacheKey, result);

      // Add result ID for feedback
      result.resultId = requestId;

      // Add scan info to response
      result.scanInfo = {
        scansUsed: newCount,
        scansLimit: limit,
        scansRemaining: Math.max(0, limit - newCount),
        isPro
      };
    } else {
      console.log(`[${requestId}] Analysis failed: ${result.error}`);
    }

    return res.json(result);
  } catch (error) {
    console.error(`[${requestId}] Analyze route error:`, {
      message: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      success: false,
      error: 'Server error. Please try again.'
    });
  }
});

export default router;
