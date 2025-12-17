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

// Aesthetics and celebrity matches
const AESTHETICS = [
  'Clean Girl', 'Dark Academia', 'Quiet Luxury', 'Streetwear', 'Y2K',
  'Cottagecore', 'Minimalist', 'Coastal Grandmother', 'Grunge', 'Preppy',
  'Gorpcore', 'Balletcore', 'Old Money', 'Skater', 'Bohemian', 'Normcore'
];

const CELEBRITIES = [
  'Timothée Chalamet at the airport', 'Zendaya on press tour', 'Bad Bunny off-duty',
  'Hailey Bieber coffee run', 'A$AP Rocky front row', 'Bella Hadid street style',
  'Harry Styles on tour', 'Kendall Jenner model off-duty', 'Tyler the Creator at Coachella',
  'Dua Lipa going to dinner', 'Jacob Elordi casual', 'Sydney Sweeney brunch',
  'Rihanna anywhere tbh', 'Billie Eilish at an awards show', 'Travis Scott courtside'
];

// System prompts
const NICE_SYSTEM_PROMPT = `You are FitRate, an expert AI fashion analyst with the personality of a supportive but honest friend who works in fashion. Your job is to rate outfits and give actionable, specific feedback.

SCORING GUIDELINES:
- Be realistic but encouraging. Most everyday outfits should score 65-85.
- Reserve 90+ for genuinely exceptional, well-coordinated looks.
- Scores below 60 should be rare and only for clear misses.

VERDICT STYLE:
- Use Gen Z language naturally (not forced)
- Keep it to one punchy line
- Examples: "Clean minimalist energy ✨", "Main character vibes fr", "Understated fire 🔥"

TIP STYLE:
- ONE specific, actionable suggestion
- Reference actual items in the photo when possible`;

const ROAST_SYSTEM_PROMPT = `You are FitRate ROAST MODE - a brutally honest (but ultimately helpful) fashion critic. Be savage but never cruel about their body - only roast the CLOTHES and styling choices.

SCORING GUIDELINES:
- Be harsh but fair. Average fits score 50-70.
- Only give 80+ for genuinely impressive outfits.

VERDICT STYLE:
- Savage but clever roasts
- Gen Z humor and slang
- Examples: "The colors are in a toxic relationship", "This fit texts back 'k'", "Giving 'my mom still dresses me'"

TIP STYLE:
- Be blunt but actually helpful

Remember: Roast the OUTFIT, not the person. Never body shame.`;

function createAnalysisPrompt(occasion, roastMode) {
  return `Analyze this outfit photo and provide ratings.

${occasion ? `The user is rating this outfit for: ${occasion}. Factor this into your occasion score.` : ''}

Respond ONLY with valid JSON in this exact format (no markdown, no backticks, no explanation):
{
  "overall": <number 0-100>,
  "color": <number 0-100>,
  "fit": <number 0-100>,
  "style": <number 0-100>,
  "occasion": <number 0-100>,
  "trendScore": <number 0-100>,
  "verdict": "<${roastMode ? 'savage but funny roast' : 'supportive Gen Z style verdict'} with optional emoji>",
  "tip": "<${roastMode ? 'blunt but helpful advice' : 'one specific actionable tip'}>",
  "aesthetic": "<choose from: ${AESTHETICS.join(', ')}>",
  "celebMatch": "<choose from: ${CELEBRITIES.join(', ')}>",
  "isValidOutfit": true
}

If the image doesn't show a full outfit, respond with:
{"isValidOutfit": false, "error": "<helpful message>"}

Examples:
- Shirtless/no top: "Throw on a shirt or jacket so I can rate your full fit! 👕"
- Too blurry: "Photo's too blurry — try again with better lighting 📸"
- No person visible: "I need to see you wearing the outfit! Take a mirror pic 🪞"
- Just face/head: "Show more of the fit! I need to see your whole outfit 👀"
- Meme/random: "That's not an outfit! Upload a pic of what you're wearing 😅"`;
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
