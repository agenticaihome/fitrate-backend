/**
 * Gemini Outfit Analyzer - Free tier
 * OPTIMIZED: ~130 tokens vs ~400 (65% reduction)
 */

import { config } from '../config/index.js';

// Diverse celeb list (male/female, all backgrounds, 2025 trending)
const CELEBS = 'Timothée Chalamet|Bad Bunny|Pedro Pascal|Jacob Elordi|Idris Elba|Simu Liu|Dev Patel|Zendaya|Jenna Ortega|Ice Spice|Sabrina Carpenter|Hailey Bieber|Jennie|Sydney Sweeney|SZA|Emma Chamberlain';

// Canonical prompt with Social Psychology framework (match celeb to person's vibe)
const CANONICAL = `You are FitRate — a Social Style Psycho-Analyst. Help users understand how their style expresses who they are.

JSON only:
{"overall":<0-100>,"color":<0-100>,"fit":<0-100>,"style":<0-100>,"verdict":"<≤12 words, makes them feel SEEN, screenshot-worthy>","tip":"<SPECIFIC action, e.g. 'Roll jeans 2x' - NEVER vague>","aesthetic":"<Clean Girl|Dark Academia|Quiet Luxury|Mob Wife|Y2K|Coquette|Old Money|Streetwear>","celebMatch":"<${CELEBS}>","identityInsight":"<What this outfit says about who they ARE>","socialPerception":"<How strangers likely read this look>","isValidOutfit":true}
Invalid:{"isValidOutfit":false,"error":"<fun retry>"}`;

// Mode-specific prompts with psychological framework
const MODE_PROMPTS = {
    nice: `NICE✨ Main character energy. Make them feel SEEN.
identityInsight: What this says about who they are ("You favor clean lines — that reads as confidence")
socialPerception: How others see them ("Approachable but put-together")
verdict: Screenshot-worthy. Score: 78-92.`,
    honest: `HONEST📊 Real talk. Be their honest friend.
identityInsight: What this reveals about their style identity
socialPerception: How this actually reads to strangers
verdict: Direct, specific, fair. Score naturally.`,
    roast: `ROAST🔥 Playfully brutal. Clothes only.
identityInsight: What this ACCIDENTALLY says about them (funny)
socialPerception: How strangers are judging this (comedic but true)
verdict: Meme-worthy. Score: 25-60.`,
    savage: `SAVAGE💀 NO MERCY. Clothes only.
identityInsight: What this screams about their lack of taste (brutal comedy)
socialPerception: Horrified stranger reactions (exaggerated, funny)
verdict: BRUTAL. Score: 0-40. Make them question everything.`
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
        'gemini-1.5-flash'  // Ultimate fallback - very stable
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

                // Parse JSON response
                let jsonStr = content.trim();
                if (jsonStr.startsWith('```')) {
                    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
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
                        overall: Math.round(parsed.overall),
                        color: Math.round(parsed.color),
                        fit: Math.round(parsed.fit),
                        style: Math.round(parsed.style),
                        occasion: Math.round(parsed.occasion ?? parsed.overall ?? 70),
                        trendScore: Math.round(parsed.trendScore ?? parsed.overall ?? 70),
                        verdict: parsed.verdict,
                        tip: parsed.tip,
                        aesthetic: parsed.aesthetic,
                        celebMatch: parsed.celebMatch,
                        // New Social Psychology fields
                        identityInsight: parsed.identityInsight || null,
                        socialPerception: parsed.socialPerception || null,
                        mode: mode,
                        roastMode: mode === 'roast' // backwards compatibility
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
