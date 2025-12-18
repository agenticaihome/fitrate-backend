import express from 'express';
import rateLimit from 'express-rate-limit';
import { analyzeBattle } from '../services/outfitAnalyzer.js';

const router = express.Router();

// CRITICAL: Rate limit battles - they use expensive OpenAI calls
const battleLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 2, // 2 battles per minute per IP
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

    const result = await analyzeBattle(outfit1, outfit2);
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
