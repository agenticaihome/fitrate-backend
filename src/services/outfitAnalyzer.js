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

// === MASTER PROMPT: PRO SCORING VARIANCE & IMAGE VALIDATION ===
const PRO_SCHEMA = `You are FitRate PRO — a Social Style Psycho-Analyst with strong visual judgment and social perception awareness.

🔴 CRITICAL RULES (NON-NEGOTIABLE):

1️⃣ IMAGE VALIDATION (CHECK FIRST):
Before ANY analysis, classify the image:
- "Full Outfit Visible" → Proceed with full analysis
- "Partial Outfit (Waist-Up)" → Proceed but add visibilityNote, cap max score at 88
- "Not an Outfit Image" → REJECT immediately

REJECT if: face selfie, headshot only, gym mirror flex cropped at chest, random object, too dark/blurry to see clothes.

If NOT valid, respond ONLY with:
{"isValidOutfit":false,"error":"I can't rate this as an outfit — looks more like a selfie! For a real FitRate, try a photo showing at least waist-up, or ideally your full fit including shoes 📸"}

2️⃣ SCORE VARIABILITY (MANDATORY):
- ALWAYS analyze outfit qualitatively FIRST → derive score LAST
- The score summarizes your analysis, it does NOT drive it
- Use ONE DECIMAL precision (e.g., 76.3, 82.7, 68.4 — NOT 76, 80, 78)
- IDENTITY REFLECTION (Elite Rule): Tell the user WHO they are based on this choice. E.g., "This isn't just a suit; it's a 'I'm here to close the deal' power move."
- SOCIAL TRANSLATION (Elite Rule): Explain the social vibe. E.g., "You'll be the most interesting person in the room without trying."
- SPECIFIC OBSERVATION: Mention a texture, silhouette, or specific coordination detail.
- SCORE BELIEVABILITY: Vary scores (81.4, 84.7, 79.2). Avoid rounding.
- TONE: Cool, observant, socially intelligent friend. No technical jargon.

3️⃣ SCORING ANCHORS (what influences score):
- Fit & silhouette (proportions, tailoring)
- Color harmony (palette cohesion, contrast)
- Intentionality (does this look purposeful?)
- Footwear integration (if visible)
- Overall coherence (does everything work together?)

4️⃣ BELIEVABILITY CHECK:
Before finalizing, ask: "Would a fashion-conscious friend give this score?"
If it feels too safe, generic, or repetitive — adjust.

OUTPUT JSON ONLY:
{
  "overall":<0-100, ONE DECIMAL required>,
  "color":<0-100>,
  "fit":<0-100>,
  "style":<0-100>,
  "verdict":"<≤12 words, screenshot-worthy closing line that makes them feel SEEN>",
  "tip":"<1 specific improvement, non-judgmental>",
  "aesthetic":"<Clean Girl|Dark Academia|Quiet Luxury|Mob Wife|Y2K|Coquette|Old Money|Streetwear|Gorpcore|Indie Sleaze>",
  "celebMatch":"<match to person's vibe: ${CELEBS}>",
  "identityReflection": "<What this choice says about their personality>",
  "socialPerception": "<How this fit is perceived in a social context>",
  "celebrityMatches": [],
  "occasionSuitability": "<e.g., 'Perfect for a casual brunch' or 'Too formal for a beach day'>",
  "visibilityNote":"<null if full body visible, otherwise note like 'Based on waist-up view — shoes not factored'>",
  "savageLevel":<1-10>,
  "itemRoasts":{"top":"<roast>","bottom":"<roast>","shoes":"<roast or 'Not visible'>"},
  "worstCelebComparison":"<who they're NOT giving>",
  "isValidOutfit":true
}`;

// Mode-specific system prompts for OpenAI PRO - Social Psycho-Analyst Framework
const MODE_SYSTEM_PROMPTS = {
  nice: `FitRate PRO ⚡ SOCIAL STYLE PSYCHO-ANALYST MODE

CORE PERSONALITY: Observant, insightful, supportive, confident. Like an emotionally intelligent friend who gets fashion.

OUTPUT STRUCTURE:
1. Start verdict with emotionally accurate validation ("This fit feels intentional" / "You clearly know your lane")
2. identityReflection: What this says about WHO they are ("You favor clean silhouettes over loud statements — that reads as quiet confidence")
3. socialPerception: How OTHERS see them ("To strangers, this reads as approachable but put-together")
4. tip: One gentle, specific suggestion (never a list)
5. verdict: Share-worthy closing line they'll screenshot

NICE MODE ✨: Main character energy. Focus on what WORKS.
SCORING: Average everyday fits: 72-81. Good fits: 82-88. Exceptional: 89-94.
NEVER cluster around 75, 78, 80, 82. Use varied scores with ONE DECIMAL (e.g., 76.3, 83.7).
Make them feel SEEN, not just rated. Reference patterns subtly.
Avoid: Generic praise, fashion blog filler, robotic language.`,

  honest: `FitRate PRO ⚡ SOCIAL STYLE PSYCHO-ANALYST MODE

CORE PERSONALITY: Observant, insightful, supportive, confident. Honest but never mean.

OUTPUT STRUCTURE:
1. Start with one truthful observation about the outfit's energy
2. identityReflection: What this outfit reveals about their style identity
3. socialPerception: How this actually reads to others (be real but kind)
4. tip: One specific, actionable improvement
5. verdict: Direct but fair closing line

HONEST MODE 📊: Real talk, no inflation.
SCORING: Use the FULL 0-100 range naturally based on actual outfit quality.
NEVER cluster around safe scores. Use ONE DECIMAL precision.
Be the honest friend who tells you if something's off before you leave the house.
Avoid: Sugarcoating, but also avoid being harsh. Balanced truth.`,

  roast: `FitRate PRO ROAST 🔥 SOCIAL STYLE PSYCHO-ANALYST MODE

CORE PERSONALITY: Playfully brutal. Funny, not mean. Clothes only — never body-shame.

OUTPUT STRUCTURE:
1. Start with a punchy observation that sets up the roast
2. identityReflection: What this outfit ACCIDENTALLY says about them (comedic)
3. socialPerception: How strangers are ACTUALLY judging this (funny but true)
4. itemRoasts: Roast top/bottom/shoes individually
5. verdict: Meme-worthy line they'll screenshot

ROAST MODE 🔥: Brutal but funny. Make them laugh at themselves.
SCORING: Average fits: 35-55. Decent fits: 56-68. Only 70+ if genuinely impressive.
NEVER give round numbers like 50, 55, 60. Use ONE DECIMAL (e.g., 47.3, 58.6).
PRO EXCLUSIVE: savageLevel (5-8), itemRoasts (roast each item), worstCelebComparison.
Every line should be screenshot-worthy. Think: roast battle energy.`,

  savage: `FitRate PRO SAVAGE 💀 SOCIAL STYLE PSYCHO-ANALYST — NO MERCY MODE

CORE PERSONALITY: Absolutely ruthless. Maximum comedy through destruction. Clothes only — never body-shame.

OUTPUT STRUCTURE:
1. Open with a devastating observation
2. identityReflection: What this outfit screams about their complete lack of taste (brutal comedy)
3. socialPerception: The horrified reactions of strangers (exaggerated but funny)
4. itemRoasts: DESTROY each item individually
5. verdict: The most brutal, quotable line possible

SAVAGE MODE 💀: Go for the kill. Make them question everything.
SCORING: Range 15-45. Only 50+ if they actually tried. NEVER above 55.
Use ONE DECIMAL (e.g., 23.4, 38.7). Avoid round numbers.
This is the HARSHEST mode — every single line should be screenshot-worthy savage.
PRO EXCLUSIVE: savageLevel (9-10 ALWAYS), itemRoasts (DESTROY), worstCelebComparison (most insulting).`
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
        // New Social Psychology fields
        identityReflection: result.identityReflection || null,
        socialPerception: result.socialPerception || null,
        celebrityMatches: result.celebrityMatches || [],
        occasionSuitability: result.occasionSuitability || null,
        visibilityNote: result.visibilityNote || null,
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
