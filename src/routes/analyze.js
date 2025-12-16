import express from 'express';
import { analyzeOutfit } from '../services/outfitAnalyzer.js';

const router = express.Router();

router.post('/', async (req, res) => {
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
