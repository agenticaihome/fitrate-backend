import express from 'express';
import { analyzeWithGemini } from '../services/geminiAnalyzer.js';
import { analyzeOutfit as analyzeWithOpenAI } from '../services/outfitAnalyzer.js';
import { scanLimiter, incrementScanCount, getScanCount, LIMITS, getProStatus } from '../middleware/scanLimiter.js';

const router = express.Router();

// Check remaining scans
router.get('/status', (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const userId = req.query.userId;
  const isPro = getProStatus(userId, ip);
  const limit = isPro ? LIMITS.pro : LIMITS.free;
  const used = getScanCount(userId, ip);

  res.json({
    scansUsed: used,
    scansLimit: limit,
    scansRemaining: Math.max(0, limit - used),
    isPro
  });
});

import { getReferralStats } from '../middleware/referralStore.js';

// Consume a scan (for free users - no AI call, just tracks usage by userId)
// This prevents localStorage bypass - server tracks by userId (unique per browser)
router.post('/consume', scanLimiter, (req, res) => {
  const { userId, ip, limit, isPro, usedBonus } = req.scanInfo;

  let newCount;
  if (usedBonus) {
    newCount = getScanCount(userId, ip); // Don't increment if using bonus
  } else {
    newCount = incrementScanCount(userId, ip);
  }

  let bonusRemaining = 0;
  if (userId) {
    const stats = getReferralStats(userId);
    bonusRemaining = stats.bonusScans;
  }

  res.json({
    success: true,
    scanInfo: {
      scansUsed: newCount,
      scansLimit: limit,
      scansRemaining: Math.max(0, limit - newCount),
      isPro,
      usedBonus,
      bonusRemaining
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

