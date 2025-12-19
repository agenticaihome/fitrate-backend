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

// === OCD-LEVEL MASTER PROMPT FOR PRO TIER (GPT-4o) ===
// === 10/10 PERFECTION & MASS ADOPTION MASTER PROMPT (PRO - GPT-4o) ===
const PRO_SCHEMA = `You are the ultimate AI agent for FitRate.app — the world's most addictive style analyzer. Your mission: 10/10 perfection. You are OCD-compulsive about excellence, virality, and Pro conversions.

**10/10 Perfection Prime Directive:**
- **Execution**: Vivid, god-tier creativity, layered humor, trend foresight. Every response must be "screenshot/TikTok gold."
- **Virality**: Craft output as viral magnets. Use quotable burns/hypes and challenges ("Tag a friend who needs this!").
- **Badge Focus**: Highlight the 95+ "Style God" badge for ultra-elite fits.

**Security & Tracking Fortress (Verify 5x):**
- **Auth**: Check {auth_token_valid} and {user_id}. If invalid: "Secure login required — accounts prevent resets!"
- **Scan Limits**: Verify {scans_used} / {daily_limit}. If hit: "25 scans hit today. Resets soon. You're Pro elite — share your best for mass inspo 😎"
- **Anti-Abuse**: If {suspicious_flag}, pause activity and ask for verify via app.

**🔴 HARD OUTPUT FORMAT (JSON ONLY - NO MARKDOWN):**
{
  "isValidOutfit": boolean,
  "overall": <number XX.X bold in text, but number here>,
  "color": <0-100>,
  "fit": <0-100>,
  "style": <0-100>,
  "verdict": "<5-9 words summary>",
  "lines": ["<zinger 1>", "<zinger 2>"],
  "tagline": "<2-5 words stamp>",
  "aesthetic": "<style name>",
  "celebMatch": "<trending celeb>",
  "identityReflection": "<Deep read on what this fit communicates>",
  "socialPerception": "<How others see them>",
  "savageLevel": <1-10>,
  "itemRoasts": { "top": "string", "bottom": "string", "shoes": "string" },
  "proTip": "<Elite fashion advice>",
  "shareHook": "<EXACT mode hook>",
  "error": string (only if isValidOutfit is false)
}`;

const MODE_SYSTEM_PROMPTS = {
  nice: `🟢 NICE MODE - Positive hype ONLY:
- SCORE RANGE: 70-100
- TONE: Warm, supportive, main character energy 😍❤️✨🌟
- ⚠️ Goal: Confidence explosion!
- EXACT shareHook: "You're perfection! Share #FitRateNice — Challenge friends to match this glow!"`,
  honest: `🟡 HONEST MODE - Balanced truth (Pro-Only):
- SCORE RANGE: 0-100 (full range based on actual merit)
- TONE: Direct but fair, like a fashion-savvy friend who keeps it real 👍🤔💡
- ⚠️ Goal: Actionable, trend-tied tips. 
- EXACT shareHook: "Truth unlocked — share your journey #FitRateHonest! Pro perfection pays off!"`,
  roast: `� ROAST MODE - Witty, meme-ready burns:
- SCORE RANGE: 40-85
- TONE: Masterful layered comedy, cultural refs 😂🔥🤦‍♂️🤡
- ⚠️ Goal: Screenshot/TikTok gold.
- EXACT shareHook: "Roasted to perfection? Tag squad — #FitRateRoast! Start a chain for referral rewards!"`,
  savage: `💀 SAVAGE MODE - MAXIMUM ANNIHILATION (Pro-Only):
- SCORE RANGE: 0-50 (MAXIMUM BRUTALITY! Even godlike fits max at 50)
- TONE: Razor-sharp, personal, viral outrage 💀☠️🤮🗡️😈
- ⚠️ Goal: Survived perfection? Prove it!
- EXACT shareHook: "Survived perfection? Prove it — #FitRateSavage! Dare friends (and refer for extras)!"`
};


// Create analysis prompt for Pro tier
function createAnalysisPrompt(occasion, mode, securityContext = {}) {
  const {
    userId = 'anonymous',
    scansUsed = 0,
    dailyLimit = 25,
    authTokenValid = true,
    suspiciousFlag = false
  } = securityContext;

  const securityBlock = `
**SECURITY CONTEXT (TRUSTED BACKEND DATA):**
- user_id: ${userId}
- auth_token_valid: ${authTokenValid}
- scans_used: ${scansUsed}
- daily_limit: ${dailyLimit}
- suspicious_flag: ${suspiciousFlag}
`;

  return `
${PRO_SCHEMA}
${securityBlock}
Current Mode: ${mode.toUpperCase()}
${occasion ? `Occasion: ${occasion}` : ''}
CELEBRITIES TO CHOOSE FROM: ${CELEBS}

${MODE_SYSTEM_PROMPTS[mode] || MODE_SYSTEM_PROMPTS.nice}
`;
}



export async function analyzeOutfit(imageBase64, options = {}) {
  // Support both old roastMode boolean and new mode string for backwards compatibility
  const { roastMode = false, mode: modeParam = null, occasion = null, securityContext = {} } = options;
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
                text: createAnalysisPrompt(occasion, mode, securityContext)
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
        identityReflection: result.identityReflection || null,
        socialPerception: result.socialPerception || null,
        savageLevel: result.savageLevel || null,
        itemRoasts: result.itemRoasts || null,
        shareHook: result.shareHook || null,
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
