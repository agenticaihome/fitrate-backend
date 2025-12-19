import OpenAI from 'openai';
import { config } from '../config/index.js';

// Only initialize OpenAI if API key is configured (Gemini is primary analyzer)
let openai = null;
try {
  if (config.openai?.apiKey) {
    openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }
} catch (e) {
  console.warn('OpenAI client not initialized:', e.message);
}

// Diverse celeb list (male/female, all backgrounds, 2025 trending)
const CELEBS = `
Men: Timothée Chalamet|Bad Bunny|Pedro Pascal|Jacob Elordi|Idris Elba|Simu Liu|Dev Patel|A$AP Rocky|Jaden Smith|Central Cee|BTS Jungkook|Omar Apollo
Women: Zendaya|Jenna Ortega|Ice Spice|Sabrina Carpenter|Hailey Bieber|Jennie|Sydney Sweeney|SZA|Ayo Edebiri|Florence Pugh|Maitreyi Ramakrishnan|Emma Chamberlain
`.trim();

// === MASTER PROMPT: SMILE TEST VIRAL OUTPUT SYSTEM (PRO) ===
const PRO_SCHEMA = `You are FitRate PRO — an AI whose primary goal is to make people smile or laugh when they see a scorecard.

accuracy matters less than delight. entertainment comes first.

🔴 THE SMILE RULE (NON-NEGOTIABLE):
If someone wouldn't screenshot this because it's funny or feels good, you failed.

🔴 HARD OUTPUT FORMAT (JSON ONLY):
{
  "isValidOutfit": true,
  "overall": <56.0-99.0 range, UNEVEN decimal required (e.g. 87.4, 94.2)>,
  "color": <56-99 score>,
  "fit": <56-99 score>,
  "style": <56-99 score>,
  "verdict": "<5-9 words, punchy emotional validation>",
  "lines": ["<3-6 words line 1>", "<3-6 words line 2>"],
  "tagline": "<2-5 words, quotable stamp of approval>",
  "proTip": "<ONE extra playful upgrade idea — max 8 words>",
  "aesthetic": "<Clean Girl|Dark Academia|Quiet Luxury|Streetwear|etc>",
  "celebMatch": "<Random trending celeb matching vibe>",
  "savageLevel": <1-10 level for roasting>,
  "itemRoasts": {
    "top": "<funny comment>",
    "bottom": "<funny comment>",
    "shoes": "<funny comment>"
  },
  "error": null
}

🔴 HUMOR & TONE:
- Voice: Confident, casual, slightly mischievous.
- Style: A funny friend reacting instantly.
- Emotional Triggers: Exaggeration, stamps of approval, "yeah that tracks" observations.
- PRO TIER: Use emojis sparingly for personality.

🔴 IMAGE VALIDATION:
- Be generous. If any clothing is visible, rank it. 
- Only reject if literally NO clothing (face closeup, wall, etc).`;

const MODE_SYSTEM_PROMPTS = {
  nice: `NICE MODE ✨: Main character energy. Exaggerate their confidence. Make them feel like fashion royalty.`,
  honest: `HONEST MODE 📊: Real talk without the sugar. The friend who keeps it 100 but makes them smile at the truth.`,
  roast: `ROAST MODE 🔥: Playfully brutal. Clever, mischievous observations. Funny, not mean.`,
  savage: `SAVAGE MODE 💀: Max comedy destruction. Make them question their wardrobe in a too-funny-to-be-mad-at way.`
};


function createAnalysisPrompt(occasion, mode) {
  return `${PRO_SCHEMA}${occasion ? ` For:${occasion}` : ''}`;
}



export async function analyzeOutfit(imageBase64, options = {}) {
  // Support both old roastMode boolean and new mode string for backwards compatibility
  const { roastMode = false, mode: modeParam = null, occasion = null } = options;
  const mode = modeParam || (roastMode ? 'roast' : 'nice');
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Check if OpenAI is configured
  if (!openai) {
    console.error(`[${requestId}] OpenAI not configured - OPENAI_API_KEY missing`);
    return {
      success: false,
      error: 'Premium AI service not configured. Contact support.'
    };
  }

  try {
    console.log(`[${requestId}] Starting outfit analysis with OpenAI (mode: ${mode}, occasion: ${occasion || 'none'})`);

    // Clean base64 data
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageSizeKB = Math.round((base64Data.length * 3) / 4 / 1024);
    console.log(`[${requestId}] Image size: ${imageSizeKB}KB`);

    // Create a timeout promise
    const timeoutMs = 25000; // 25 seconds timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI request timeout')), timeoutMs);
    });

    // Race between OpenAI call and timeout
    const response = await Promise.race([
      openai.chat.completions.create({
        model: config.openai.model,
        max_tokens: 400,  // Reduced from 600 - actual responses are ~200-300 tokens
        messages: [
          {
            role: 'system',
            content: MODE_SYSTEM_PROMPTS[mode] || MODE_SYSTEM_PROMPTS.nice
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Data}`,
                  detail: 'low' // Use 'low' for faster/cheaper, 'high' for better accuracy
                }
              },
              {
                type: 'text',
                text: createAnalysisPrompt(occasion, mode)
              }
            ]
          }
        ]
      }),
      timeoutPromise
    ]);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error(`[${requestId}] No content in OpenAI response`);
      throw new Error('No response from GPT-4o');
    }

    console.log(`[${requestId}] Received response from OpenAI (${content.length} chars)`);

    // Parse JSON response (handle potential markdown wrapping)
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const result = JSON.parse(jsonStr);

    if (!result.isValidOutfit) {
      console.log(`[${requestId}] Invalid outfit detected: ${result.error}`);
      return {
        success: false,
        error: result.error || 'Could not analyze this image'
      };
    }

    console.log(`[${requestId}] Analysis successful - Overall score: ${result.overall}`);

    return {
      success: true,
      scores: {
        overall: result.overall,
        color: result.color,
        fit: result.fit,
        style: result.style,
        verdict: result.verdict,
        lines: result.lines,
        tagline: result.tagline,
        proTip: result.proTip || null,
        aesthetic: result.aesthetic,
        celebMatch: result.celebMatch,
        savageLevel: result.savageLevel || null,
        itemRoasts: result.itemRoasts || null,
        mode: mode,
        roastMode: mode === 'roast'
      }
    };
  } catch (error) {
    console.error(`[${requestId}] Analysis error:`, {
      message: error.message,
      type: error.constructor.name,
      status: error.status,
      code: error.code
    });

    // Return more specific error messages
    let errorMessage = 'Failed to analyze outfit. Please try again.';

    if (error.message === 'OpenAI request timeout') {
      errorMessage = 'Analysis is taking too long. Please try again with a smaller image.';
    } else if (error.status === 401 || error.code === 'invalid_api_key') {
      errorMessage = 'Service configuration error. Please contact support.';
      console.error(`[${requestId}] CRITICAL: Invalid OpenAI API key`);
    } else if (error.status === 429) {
      errorMessage = 'OpenAI service is busy. Please try again in a moment.';
    } else if (error.message?.includes('JSON')) {
      errorMessage = 'Failed to parse analysis results. Please try again.';
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

export async function analyzeBattle(image1Base64, image2Base64) {
  try {
    const [result1, result2] = await Promise.all([
      analyzeOutfit(image1Base64),
      analyzeOutfit(image2Base64)
    ]);

    if (!result1.success || !result2.success) {
      return {
        success: false,
        error: 'Failed to analyze one or both outfits'
      };
    }

    const score1 = result1.scores.overall;
    const score2 = result2.scores.overall;
    const winner = score1 > score2 ? 1 : score2 > score1 ? 2 : 0;

    return {
      success: true,
      battle: {
        outfit1: result1.scores,
        outfit2: result2.scores,
        winner,
        margin: Math.abs(score1 - score2),
        commentary: winner === 0
          ? "It's a tie! Both fits are equally fire 🔥"
          : `Outfit ${winner} takes the crown by ${Math.abs(score1 - score2)} points!`
      }
    };
  } catch (error) {
    console.error('Battle analysis error:', error);
    return {
      success: false,
      error: 'Battle failed. Please try again.'
    };
  }
}
