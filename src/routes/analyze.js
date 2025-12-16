import express from 'express';
import { analyzeOutfit } from '../services/outfitAnalyzer.js';
import { scanLimiter, incrementScanCount, getScanCount, LIMITS, getProStatus } from '../middleware/scanLimiter.js';

const router = express.Router();

// Check remaining scans
router.get('/status', (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const isPro = getProStatus(ip);
  const limit = isPro ? LIMITS.pro : LIMITS.free;
  const used = getScanCount(ip);

  res.json({
    scansUsed: used,
    scansLimit: limit,
    scansRemaining: Math.max(0, limit - used),
    isPro
  });
});

// Consume a scan (for free users - no AI call, just tracks usage by IP)
// This prevents localStorage bypass - server tracks by IP
router.post('/consume', scanLimiter, (req, res) => {
  const { ip, limit, isPro } = req.scanInfo;
  const newCount = incrementScanCount(ip);

  res.json({
    success: true,
    scanInfo: {
      scansUsed: newCount,
      scansLimit: limit,
      scansRemaining: Math.max(0, limit - newCount),
      isPro
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

    const result = await analyzeOutfit(image, {
      roastMode: roastMode || false,
      occasion: occasion || null
    });

    // Only increment count on successful analysis
    if (result.success) {
      const { ip, limit, isPro } = req.scanInfo;
      const newCount = incrementScanCount(ip);

      console.log(`[${requestId}] Success - Scan count: ${newCount}/${limit} (isPro: ${isPro})`);

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

