/**
 * Gemini Outfit Analyzer - Free tier
 * OPTIMIZED: ~130 tokens vs ~400 (65% reduction)
 */

import { config } from '../config/index.js';

// Diverse celeb list (male/female, all backgrounds, 2025 trending)
const CELEBS = 'Timothée Chalamet|Bad Bunny|Pedro Pascal|Jacob Elordi|Idris Elba|Simu Liu|Dev Patel|Zendaya|Jenna Ortega|Ice Spice|Sabrina Carpenter|Hailey Bieber|Jennie|Sydney Sweeney|SZA|Emma Chamberlain';

// === MASTER PROMPT: SCORING VARIANCE & IMAGE VALIDATION ===
// Canonical prompt with score variability + image validation rules
// === MASTER PROMPT: SMILE TEST VIRAL OUTPUT SYSTEM ===
const CANONICAL = `You are FitRate — an AI whose primary goal is to make people smile or laugh when they see a scorecard.

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
  "aesthetic": "<Clean Girl|Dark Academia|Quiet Luxury|Streetwear|etc>",
  "celebMatch": "<Random trending celeb matching vibe>",
  "error": null
}

🔴 HUMOR & TONE:
- Voice: Confident, casual, slightly mischievous.
- Style: A funny friend reacting instantly.
- Emotional Triggers: Exaggeration, stamps of approval, "yeah that tracks" observations.
- NO EMOJIS (Free Tier). No explanations. No disclaimers.

🔴 IMAGE VALIDATION:
- Be generous. If any clothing is visible, rank it. 
- Only return isValidOutfit:false if it's literally a blank wall, face closeup with zero clothes, or a random object.`;

const MODE_PROMPTS = {
    nice: `NICE MODE: Main character energy. Exaggerate their confidence and style. Focus on the 'vibe' being elite.`,
    honest: `HONEST MODE: Real talk without the sugar. Be the friend who keeps it 100 but still makes them laugh at the truth.`,
    roast: `ROAST MODE: Playfully brutal. Use clever observations about their aesthetic. Funny, not mean. No body shaming.`,
    savage: `SAVAGE MODE: Max comedy destruction. Make them question their entire wardrobe in a way that's too funny to be mad at.`
};

// Gemini-specific delta (playful, safe)
function createGeminiPrompt(mode, occasion) {
    const delta = MODE_PROMPTS[mode] || MODE_PROMPTS.nice;

    return `${CANONICAL}
${delta}
${occasion ? ` For:${occasion}` : ''}`
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
