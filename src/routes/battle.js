import express from 'express';
import { analyzeBattle } from '../services/outfitAnalyzer.js';

const router = express.Router();

router.post('/', async (req, res) => {
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
