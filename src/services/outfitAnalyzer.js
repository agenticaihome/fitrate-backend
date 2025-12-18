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

// PRO-exclusive schema (more detailed than free tier)
const PRO_SCHEMA = `Rate outfit. JSON only. Match celebMatch to person's vibe/energy.
{"overall":<0-100>,"color":<0-100>,"fit":<0-100>,"style":<0-100>,"verdict":"<≤8 words, 1-2 emoji>","tip":"<1 fix>","aesthetic":"<Clean Girl|Dark Academia|Quiet Luxury|Mob Wife|Y2K|Coquette|Old Money|Streetwear|Gorpcore|Indie Sleaze>","celebMatch":"<match to person: ${CELEBS}>","savageLevel":<1-10>,"itemRoasts":{"top":"<roast>","bottom":"<roast>","shoes":"<roast or 'N/A'>"},"worstCelebComparison":"<who they're NOT giving>","isValidOutfit":true}
Invalid:{"isValidOutfit":false,"error":"<fun retry>"}`;

// Mode-specific system prompts for OpenAI PRO
const MODE_SYSTEM_PROMPTS = {
  nice: `FitRate PRO ⚡ Premium analysis. Verdicts get screenshotted.
NICE✨ Main character energy. Focus on positives and encouragement. Score:72-90.
Verdict: ≤8 words, quotable. Match celeb to person's actual vibe.
PRO EXCLUSIVE: savageLevel (keep low 1-3), itemRoasts (gentle improvements), worstCelebComparison (light-hearted).`,

  honest: `FitRate PRO ⚡ Premium analysis. Verdicts get screenshotted.
HONEST📊 Be balanced and truthful. Give real, unbiased feedback - no inflation or deflation.
Score naturally based on the actual outfit quality. Point out both what works and what doesn't.
Verdict: ≤8 words, direct but fair. Match celeb to person's actual vibe.
PRO EXCLUSIVE: savageLevel (honest 4-6), itemRoasts (constructive criticism), worstCelebComparison (honest comparison).`,

  roast: `FitRate PRO ROAST🔥 Premium savage analysis.
Clothes only. Never body-shame. Score:40-65.
Verdict: ≤8 words, brutal, must get screenshotted.
PRO EXCLUSIVE: savageLevel (1-10 brutality), itemRoasts (roast top/bottom/shoes), worstCelebComparison (who they're NOT giving).`
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
        overall: Math.round(result.overall),
        color: Math.round(result.color),
        fit: Math.round(result.fit),
        style: Math.round(result.style),
        occasion: Math.round(result.occasion ?? result.overall ?? 70),
        trendScore: Math.round(result.trendScore ?? result.overall ?? 70),
        verdict: result.verdict,
        tip: result.tip,
        aesthetic: result.aesthetic,
        celebMatch: result.celebMatch,
        mode: mode,
        roastMode: mode === 'roast' // backwards compatibility
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
