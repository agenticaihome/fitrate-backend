import OpenAI from 'openai';
import { config } from '../config/index.js';
import {
    buildSystemPrompt,
    ERROR_MESSAGES,
    MODE_CONFIGS,
    OUTPUT_LENGTHS,
    getViralityHooks
} from '../config/systemPrompt.js';

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

// Create analysis prompt for Pro tier using centralized config
function createAnalysisPrompt(occasion, mode, securityContext = {}) {
  const {
    userId = 'anonymous',
    scansUsed = 0,
    dailyLimit = 25,
    authTokenValid = true,
    suspiciousFlag = false,
    fingerprintHash = ''
  } = securityContext;

  // Build full security context for the prompt
  const fullSecurityContext = {
    auth_token_valid: authTokenValid,
    user_id: userId,
    scans_used: scansUsed,
    daily_limit: dailyLimit,
    referral_extras_earned: 0,
    suspicious_flag: suspiciousFlag,
    fingerprint_hash: fingerprintHash
  };

  // Use centralized system prompt builder
  let prompt = buildSystemPrompt('pro', mode, fullSecurityContext);

  // Add occasion context if provided
  if (occasion) {
    prompt += `\n\nOCCASION CONTEXT: Rate for "${occasion}" appropriateness.`;
  }

  return prompt;
}

// Get mode-specific system prompt for OpenAI (used as system message)
function getModeSystemPrompt(mode) {
  const modeConfig = MODE_CONFIGS[mode] || MODE_CONFIGS.nice;
  const wordRange = OUTPUT_LENGTHS.pro;

  return `${modeConfig.emojis} ${modeConfig.name.toUpperCase()} MODE - ${modeConfig.tone}:
- SCORE RANGE: ${modeConfig.scoreRange[0]}-${modeConfig.scoreRange[1]}
- TONE: ${modeConfig.tone} ${modeConfig.emojis}
- GOAL: ${modeConfig.goal}
- OUTPUT LENGTH: ${wordRange.min}-${wordRange.max} words
- EXACT shareHook: "${modeConfig.shareHook}"`;
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
        max_tokens: 500,  // Increased for Pro tier's richer 200-300 word output
        messages: [
          {
            role: 'system',
            content: getModeSystemPrompt(mode)
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

    // Get virality hooks for this mode
    const viralityHooks = getViralityHooks(mode);
    const modeConfig = MODE_CONFIGS[mode];

    return {
      success: true,
      scores: {
        overall: result.overall,
        rating: `${result.overall}`,  // String format for consistency
        color: result.color,
        fit: result.fit,
        style: result.style,
        text: result.text || result.verdict,  // Analysis text
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
        shareHook: result.shareHook || modeConfig?.shareHook,
        mode: mode,
        roastMode: mode === 'roast',
        virality_hooks: result.virality_hooks || viralityHooks
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
