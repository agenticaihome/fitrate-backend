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

// Main analyze endpoint with rate limiting
router.post('/', scanLimiter, async (req, res) => {
  try {
    const { image, roastMode, occasion } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        error: 'No image provided'
      });
    }

    // Validate image size (rough estimate from base64)
    const imageSizeBytes = (image.length * 3) / 4;
    if (imageSizeBytes > 10 * 1024 * 1024) {
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

      // Add scan info to response
      result.scanInfo = {
        scansUsed: newCount,
        scansLimit: limit,
        scansRemaining: Math.max(0, limit - newCount),
        isPro
      };
    }

    return res.json(result);
  } catch (error) {
    console.error('Analyze route error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error. Please try again.'
    });
  }
});

export default router;

