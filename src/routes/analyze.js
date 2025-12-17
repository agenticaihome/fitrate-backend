import express from 'express';
import { analyzeWithGemini } from '../services/geminiAnalyzer.js';
import { analyzeOutfit as analyzeWithOpenAI } from '../services/outfitAnalyzer.js';
import { scanLimiter, incrementScanCount, getScanCount, LIMITS, getProStatus } from '../middleware/scanLimiter.js';
import { getReferralStats, consumeProRoast, hasProRoast, addProRoast } from '../middleware/referralStore.js';

const router = express.Router();

// Check remaining scans + Pro Roasts
router.get('/status', (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const userId = req.query.userId;
  const isPro = getProStatus(userId, ip);
  const limit = isPro ? LIMITS.pro : LIMITS.free;
  const used = getScanCount(userId, ip);
  const stats = userId ? getReferralStats(userId) : { proRoasts: 0, totalReferrals: 0 };

  res.json({
    scansUsed: used,
    scansLimit: limit,
    scansRemaining: Math.max(0, limit - used),
    isPro,
    proRoasts: stats.proRoasts,  // New: Pro Roasts available
    referrals: stats.totalReferrals
  });
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
  if (!hasProRoast(userId)) {
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
      roastMode: true,  // Pro Roasts are always roast mode
      occasion: null
    });

    if (result.success) {
      // Consume the Pro Roast
      consumeProRoast(userId);
      const remaining = getReferralStats(userId).proRoasts;
      console.log(`[${requestId}] Pro Roast consumed - ${remaining} remaining`);

      result.proRoastsRemaining = remaining;
      result.isProRoast = true;
    }

    return res.json(result);
  } catch (error) {
    console.error(`[${requestId}] Pro Roast error:`, error);
    return res.status(500).json({ success: false, error: 'Pro Roast failed. Please try again.' });
  }
});

// Consume a scan (for free users - no AI call, just tracks usage by userId)
router.post('/consume', scanLimiter, (req, res) => {
  const { userId, ip, limit, isPro, usedBonus } = req.scanInfo;

  let newCount;
  if (usedBonus) {
    newCount = getScanCount(userId, ip);
  } else {
    newCount = incrementScanCount(userId, ip);
  }

  const stats = userId ? getReferralStats(userId) : { proRoasts: 0 };

  res.json({
    success: true,
    scanInfo: {
      scansUsed: newCount,
      scansLimit: limit,
      scansRemaining: Math.max(0, limit - newCount),
      isPro,
      usedBonus,
      proRoasts: stats.proRoasts  // New: show Pro Roasts available
    }
  });
});

// Main analyze endpoint with rate limiting (for Pro users - real AI)
router.post('/', scanLimiter, async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    console.log(`[${requestId}] POST /api/analyze - IP: ${req.ip || 'unknown'}`);
    const { image, roastMode, occasion } = req.body;

    if (!image) {
      console.log(`[${requestId}] Error: No image provided`);
      return res.status(400).json({
        success: false,
        error: 'No image provided'
      });
    }

    // Validate image size (rough estimate from base64)
    const imageSizeBytes = (image.length * 3) / 4;
    const imageSizeMB = (imageSizeBytes / (1024 * 1024)).toFixed(2);
    console.log(`[${requestId}] Image size: ${imageSizeMB}MB`);

    if (imageSizeBytes > 10 * 1024 * 1024) {
      console.log(`[${requestId}] Error: Image too large (${imageSizeMB}MB)`);
      return res.status(400).json({
        success: false,
        error: 'Image too large. Please use an image under 10MB.'
      });
    }

    // Route to appropriate AI based on user tier
    const { isPro } = req.scanInfo;
    const analyzer = isPro ? analyzeWithOpenAI : analyzeWithGemini;
    const serviceName = isPro ? 'OpenAI GPT-4o' : 'Gemini';
    console.log(`[${requestId}] Using ${serviceName} (isPro: ${isPro})`);

    const result = await analyzer(image, {
      roastMode: roastMode || false,
      occasion: occasion || null
    });

    // Only increment count on successful analysis
    if (result.success) {
      const { userId, ip, limit, isPro } = req.scanInfo;
      const newCount = incrementScanCount(userId, ip);

      console.log(`[${requestId}] Success - Scan count: ${newCount}/${limit} (isPro: ${isPro}, userId: ${userId || 'none'})`);

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

