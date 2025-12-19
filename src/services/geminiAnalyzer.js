/**
 * Gemini Outfit Analyzer - Free tier
 * OCD-LEVEL PROMPT: Strict mode enforcement, exact formats, verbatim hooks
 */

import { config } from '../config/index.js';

// Diverse celeb list (male/female, all backgrounds, 2025 trending)
const CELEBS = 'Timothée Chalamet|Bad Bunny|Pedro Pascal|Jacob Elordi|Idris Elba|Simu Liu|Dev Patel|Zendaya|Jenna Ortega|Ice Spice|Sabrina Carpenter|Hailey Bieber|Jennie|Sydney Sweeney|SZA|Emma Chamberlain';

// === OCD-LEVEL MASTER PROMPT FOR FREE TIER (GEMINI) ===
const MASTER_PROMPT = `You are FitRate.app's AI outfit analyzer running on the FREE TIER (Gemini model).

🔴 CORE OCD RULES (VERIFY EVERY RESPONSE):
1. FREE TIER = Nice & Roast modes ONLY. If mode is "honest" or "savage", respond with error.
2. Output MUST be EXACTLY the JSON format below - no deviations.
3. Rating MUST be **XX.X/100** format (one decimal, e.g., 74.3, 88.7).
4. Entertainment > Accuracy. If it's not screenshot-worthy, you failed.
5. NEVER suggest app changes. NEVER discuss limits/pricing.

🔴 HARD OUTPUT FORMAT (JSON ONLY - NO MARKDOWN):
{
  "isValidOutfit": true,
  "overall": <number with ONE decimal, e.g. 74.3>,
  "color": <0-100>,
  "fit": <0-100>,
  "style": <0-100>,
  "verdict": "<5-9 words, punchy, mode-appropriate>",
  "lines": ["<3-6 word zinger 1>", "<3-6 word zinger 2>"],
  "tagline": "<2-5 words, quotable stamp>",
  "aesthetic": "<Clean Girl|Dark Academia|Quiet Luxury|Streetwear|Y2K|Minimalist|Old Money|Gorpcore|Grunge|Preppy>",
  "celebMatch": "<trending celeb matching vibe>",
  "shareHook": "<EXACT hook from mode template>",
  "error": null
}

🔴 IMAGE VALIDATION:
- Be GENEROUS. If ANY clothing visible, rate it.
- isValidOutfit:false ONLY if: blank wall, face-only selfie, random object, no clothes at all.
- If invalid: {"isValidOutfit": false, "error": "Need to see your outfit! Try a photo showing your clothes 📸"}

🔴 ANALYSIS PARAMETERS (use ALL):
- Overall Style: cohesiveness, appeal, intentionality
- Fit/Comfort: how clothes suit the body
- Color Coordination: harmony, vibrancy, contrast
- Originality: unique twists, personality
- Trendiness: current fashion vibes (2024-2025)

🔴 FREE TIER STYLE:
- Short, punchy, meme-ready responses
- NO emojis in verdict/lines (save for share hooks)
- 100-150 word equivalent analysis depth
- Make it SHAREABLE and SCREENSHOT-WORTHY`;

// Mode-specific prompts with EXACT share hooks
const MODE_PROMPTS = {
    nice: `🟢 NICE MODE - Positive hype ONLY:
- SCORE RANGE: 70-95 (be generous, boost confidence)
- TONE: Warm, supportive, main character energy
- VERDICT: Praise their style, exaggerate how good they look
- LINES: Two compliments that make them feel amazing
- TAGLINE: "Certified Drip" / "No Notes" / "Main Character" / "Style Icon"
- ⚠️ VERIFY: Is EVERY word positive? No backhanded compliments!
- EXACT SHARE HOOK: "You're glowing! Share your look with #FitRateNice"`,

    roast: `🔴 ROAST MODE - BRUTAL but funny:
- SCORE RANGE: 35-70 (harsh! average fits = 45-55, only fire = 65+)
- TONE: Savage, witty, meme-worthy destruction
- VERDICT: Devastating one-liner that makes them laugh-cry
- LINES: Two BRUTAL zingers, each screenshot-worthy
  Examples: "This fit texts back 'k'" / "The colors are fighting for custody" / "Giving 'I have food at home'"
- TAGLINE: "Rough Day" / "Fashion Emergency" / "Thoughts and Prayers" / "Receipts Kept"
- ⚠️ VERIFY: Is it ACTUALLY harsh? Would they send this to friends saying "BRO LOOK 💀"?
- ⚠️ NEVER body shame - destroy the CLOTHES only
- EXACT SHARE HOOK: "Got roasted and lived? Tag your friends — share with #FitRateRoast!"`,

    // These modes should not be accessible on free tier - return error
    honest: `ERROR: This mode requires Pro tier.`,
    savage: `ERROR: This mode requires Pro tier.`
};

// Create the full prompt for Gemini
function createGeminiPrompt(mode, occasion) {
    // Check if mode is valid for free tier
    if (mode === 'honest' || mode === 'savage') {
        return `You must respond with this exact JSON:
{"isValidOutfit": false, "error": "This mode is Pro-exclusive (powered by GPT-4o)—upgrade for access to Honest & Savage!"}`;
    }

    const modePrompt = MODE_PROMPTS[mode] || MODE_PROMPTS.nice;

    return `${MASTER_PROMPT}

${modePrompt}
${occasion ? `OCCASION CONTEXT: Rate for "${occasion}" appropriateness.` : ''}`;
}

export async function analyzeWithGemini(imageBase64, options = {}) {
    // Support both old roastMode boolean and new mode string for backwards compatibility
    const { roastMode = false, mode: modeParam = null, occasion = null } = options;
    const mode = modeParam || (roastMode ? 'roast' : 'nice');
    const requestId = `gemini_${Date.now()}`;

    // Check if API key is configured
    if (!config.gemini.apiKey) {
        console.error(`[${requestId}] GEMINI_API_KEY not set!`);
        return {
            success: false,
            error: 'AI service not configured.'
        };
    }

    // Clean base64 data once
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    console.log(`[${requestId}] Starting Gemini analysis (mode: ${mode})`);
    console.log(`[${requestId}] Image data length: ${base64Data.length}`);

    const requestBody = {
        contents: [{
            parts: [
                { text: createGeminiPrompt(mode, occasion) },
                {
                    inline_data: {
                        mime_type: 'image/jpeg',
                        data: base64Data
                    }
                }
            ]
        }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300  // Reduced from 500 - actual responses are ~150-200 tokens
        }
    };

    // Models to try in order (fallback chain) - Dec 2025 stable models
    const models = [
        config.gemini.model || 'gemini-2.0-flash',  // Primary - stable and reliable
        'gemini-2.0-flash-lite'  // Fallback - lighter version
    ];

    // Try each model with retries
    for (const modelName of models) {
        const maxRetries = 2;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
                console.log(`[${requestId}] Calling Gemini (model: ${modelName}, attempt: ${attempt})...`);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 25000);

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': config.gemini.apiKey
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);
                const data = await response.json();

                // Check for 503/overload errors - retry with backoff
                if (response.status === 503 || data.error?.status === 'UNAVAILABLE') {
                    console.warn(`[${requestId}] Model ${modelName} overloaded (attempt ${attempt}), waiting before retry...`);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, 1000 * attempt)); // Exponential backoff
                        continue; // Retry same model
                    }
                    throw new Error('Model overloaded');
                }

                if (!response.ok) {
                    console.error(`[${requestId}] API error:`, data);
                    throw new Error(data.error?.message || `API returned ${response.status}`);
                }

                const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!content) {
                    throw new Error('No response from Gemini');
                }

                console.log(`[${requestId}] Received response (${content.length} chars)`);

                // Parse JSON response - extract JSON from potential non-JSON preamble
                let jsonStr = content.trim();

                // Remove markdown code blocks
                if (jsonStr.startsWith('```')) {
                    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
                }

                // Extract JSON if there's preamble text (e.g., "Okay, let me...")
                const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[0];
                }

                const parsed = JSON.parse(jsonStr);

                if (!parsed.isValidOutfit) {
                    return {
                        success: false,
                        error: parsed.error || 'Could not analyze this image'
                    };
                }

                console.log(`[${requestId}] Analysis successful with ${modelName} - Score: ${parsed.overall}`);

                return {
                    success: true,
                    scores: {
                        overall: parsed.overall,
                        color: parsed.color,
                        fit: parsed.fit,
                        style: parsed.style,
                        verdict: parsed.verdict,
                        lines: parsed.lines,
                        tagline: parsed.tagline,
                        aesthetic: parsed.aesthetic,
                        celebMatch: parsed.celebMatch,
                        mode: mode,
                        roastMode: mode === 'roast'
                    }
                };
            } catch (error) {
                console.error(`[${requestId}] Error with ${modelName} (attempt ${attempt}):`, error.message);

                // For overload/503, continue to next model
                if (error.message === 'Model overloaded') {
                    console.log(`[${requestId}] Trying fallback model...`);
                    break; // Move to next model in fallback chain
                }

                // For timeout errors, retry same model
                if (error.name === 'AbortError' && attempt < maxRetries) {
                    console.log(`[${requestId}] Timeout, retrying...`);
                    continue;
                }

                // For other errors on last attempt/model, save the error
                if (attempt === maxRetries) {
                    break; // Move to next model
                }
            }
        }
    }

    // All models failed
    console.error(`[${requestId}] All models failed`);
    return {
        success: false,
        error: 'AI is busy right now. Please try again in a moment! 🔄'
    };
}
