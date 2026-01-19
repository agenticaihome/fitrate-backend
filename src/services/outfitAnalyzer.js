import { config } from '../config/index.js';
import {
  buildSystemPrompt,
  ERROR_MESSAGES,
  MODE_CONFIGS,
  OUTPUT_LENGTHS,
  getViralityHooks
} from '../config/systemPrompt.js';

// Lazy-loaded OpenAI client - only initialized on first Pro scan request
// COST OPTIMIZATION: Saves ~5MB memory at startup when Pro tier is not in use
let openai = null;
let openaiInitAttempted = false;

async function getOpenAIClient() {
  if (openai) return openai;
  if (openaiInitAttempted) return null;

  openaiInitAttempted = true;

  if (!config.openai?.apiKey) {
    console.warn('OpenAI client not initialized: OPENAI_API_KEY not configured');
    return null;
  }

  try {
    const OpenAI = (await import('openai')).default;
    openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    console.log('✅ OpenAI client initialized (lazy-loaded on first Pro request)');
    return openai;
  } catch (e) {
    console.warn('OpenAI client initialization failed:', e.message);
    return null;
  }
}

// Create analysis prompt for Pro tier using centralized config
function createAnalysisPrompt(occasion, mode, securityContext = {}, eventContext = null, dailyChallengeContext = null) {
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

  // Use centralized system prompt builder (now includes dailyChallengeContext)
  let prompt = buildSystemPrompt('pro', mode, fullSecurityContext, eventContext, dailyChallengeContext);

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
  const { roastMode = false, mode: modeParam = null, occasion = null, securityContext = {}, eventContext = null, dailyChallengeContext = null } = options;
  const mode = modeParam || (roastMode ? 'roast' : 'nice');
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Lazy-load OpenAI client on first Pro scan request
  const client = await getOpenAIClient();
  if (!client) {
    console.error(`[${requestId}] ❌ CRITICAL: OpenAI not configured - OPENAI_API_KEY missing`);
    return {
      success: false,
      error: 'Unable to connect to premium AI service. Please contact support.',
      code: 'AI_SERVICE_UNAVAILABLE'
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
      client.chat.completions.create({
        model: config.openai.model,
        max_tokens: 1000,  // Pro tier needs more tokens for rich analysis
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
                text: createAnalysisPrompt(occasion, mode, securityContext, eventContext, dailyChallengeContext)
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
        error: result.error || 'Could not analyze this image',
        code: 'INVALID_OUTFIT'
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
        judgedBy: result.judgedBy || null,  // Character archetype who judged (for celeb mode share cards)
        identityReflection: result.identityReflection || null,
        socialPerception: result.socialPerception || null,
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
    let errorMessage = 'Unable to analyze outfit. Please try again.';
    let errorCode = 'AI_CONNECTION_FAILED';

    if (error.message === 'OpenAI request timeout') {
      errorMessage = 'Connection timeout. Please try again with a smaller image.';
      errorCode = 'AI_TIMEOUT';
    } else if (error.status === 401 || error.code === 'invalid_api_key') {
      errorMessage = 'Unable to connect to AI service. Please contact support.';
      errorCode = 'AI_SERVICE_UNAVAILABLE';
      console.error(`[${requestId}] ❌ CRITICAL: Invalid OpenAI API key`);
    } else if (error.status === 429) {
      errorMessage = 'AI service is busy. Please try again in a moment. 🔄';
      errorCode = 'AI_RATE_LIMITED';
    } else if (error.message?.includes('JSON')) {
      errorMessage = 'Failed to process AI response. Please try again.';
      errorCode = 'AI_PARSE_ERROR';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      errorMessage = 'Unable to connect to AI service. Please check your internet connection and try again.';
      errorCode = 'NETWORK_ERROR';
    }

    return {
      success: false,
      error: errorMessage,
      code: errorCode
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
