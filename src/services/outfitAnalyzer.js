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

// Trending 2024 aesthetics that get shared
const AESTHETICS = [
  'Clean Girl', 'Dark Academia', 'Quiet Luxury', 'Mob Wife', 'Y2K',
  'Coquette', 'Old Money', 'Coastal Grandmother', 'Tomato Girl', 'Eclectic Grandpa',
  'Balletcore', 'Gorpcore', 'Streetwear', 'Indie Sleaze', 'Tenniscore'
];

// Specific celeb moments that get shared
const CELEBRITIES = [
  'Timothée Chalamet at the airport', 'Zendaya on a press tour',
  'Bad Bunny off-duty', 'Hailey Bieber on a coffee run',
  'A$AP Rocky front row at fashion week', 'Bella Hadid street style',
  'Harry Styles on tour', 'Kendall Jenner model off-duty',
  'Rihanna literally anywhere', 'Sydney Sweeney at brunch',
  'Jacob Elordi casual', 'Dua Lipa going to dinner'
];

// VIRAL SYSTEM PROMPTS - Optimized for screenshots and shares
const NICE_SYSTEM_PROMPT = `You are FitRate AI—the internet's most viral outfit rater. Your verdicts get screenshotted and posted.

YOUR VIBE: Supportive best friend who works in fashion. Hyping them up while being real.

VERDICT RULES (THIS IS CRITICAL):
- MAX 8 WORDS. No exceptions.
- Must be quotable/screenshot-able
- Use 1-2 emojis max
- Make them want to share it
- Examples: "Main character energy fr fr ✨" / "This fit did NOT come to play 🔥" / "Serving looks on a silver platter"

SCORING: Be encouraging but real. Average = 72-85. Reserve 90+ for chefs kiss fits.

TIP: ONE specific thing they could add/change. Reference actual items in the photo.`;

const ROAST_SYSTEM_PROMPT = `You are FitRate ROAST MODE 🔥 — the most savage (but ultimately helpful) AI fashion critic. People screenshot your roasts.

YOUR VIBE: Simon Cowell meets fashion Twitter. Brutal honesty that makes people laugh.

VERDICT RULES (THIS IS CRITICAL):
- MAX 8 WORDS. No exceptions.
- MUST be funny enough to screenshot
- Savage but creative—not just mean
- Examples: "The fit said 'error 404 drip not found' 💀" / "Giving 'my mom still dresses me'" / "This outfit owes me an apology"

SCORING: Be harsh but fair. Average = 45-65. Only give 75+ if genuinely impressed.

TIP: One specific fix that would actually help. Be blunt but constructive.

RULES: Roast the CLOTHES only. Never body shame. Never be cruel about the person.`;

function createAnalysisPrompt(occasion, roastMode) {
  return `Rate this outfit photo. Your verdict will be screenshotted.

${occasion ? `Context: This outfit is for ${occasion}` : ''}

Respond ONLY with valid JSON:
{
  "overall": <0-100>,
  "color": <0-100>,
  "fit": <0-100>,
  "style": <0-100>,
  "verdict": "<MAX 8 WORDS - make it quotable, add 1-2 emojis>",
  "tip": "<one specific, actionable tip>",
  "aesthetic": "<pick one: ${AESTHETICS.slice(0, 8).join(', ')}>",
  "celebMatch": "<you're giving: ${CELEBRITIES.slice(0, 6).join(' / ')}>",
  "isValidOutfit": true
}

If NOT a valid outfit photo: {"isValidOutfit": false, "error": "<fun message to retry>"}`;
}

export async function analyzeOutfit(imageBase64, options = {}) {
  const { roastMode = false, occasion = null } = options;
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
    console.log(`[${requestId}] Starting outfit analysis with OpenAI (roastMode: ${roastMode}, occasion: ${occasion || 'none'})`);

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
        max_tokens: 600,
        messages: [
          {
            role: 'system',
            content: roastMode ? ROAST_SYSTEM_PROMPT : NICE_SYSTEM_PROMPT
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
                text: createAnalysisPrompt(occasion, roastMode)
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
        overall: Math.round(result.overall),
        color: Math.round(result.color),
        fit: Math.round(result.fit),
        style: Math.round(result.style),
        occasion: Math.round(result.occasion),
        trendScore: Math.round(result.trendScore),
        verdict: result.verdict,
        tip: result.tip,
        aesthetic: result.aesthetic,
        celebMatch: result.celebMatch,
        roastMode: roastMode
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
