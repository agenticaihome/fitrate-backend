/**
 * Gemini Outfit Analyzer - Free tier
 * OPTIMIZED: ~130 tokens vs ~400 (65% reduction)
 */

import { config } from '../config/index.js';

// Canonical prompt - shared schema
const CANONICAL = `Rate outfit. JSON only.
{"overall":<0-100>,"color":<0-100>,"fit":<0-100>,"style":<0-100>,"verdict":"<≤8 words, 1-2 emoji>","tip":"<1 fix>","aesthetic":"<Clean Girl|Dark Academia|Quiet Luxury|Mob Wife|Y2K|Coquette|Old Money|Streetwear>","celebMatch":"<celeb moment>","isValidOutfit":true}
Invalid:{"isValidOutfit":false,"error":"<fun retry>"}`;

// Gemini-specific delta (playful, safe)
function createGeminiPrompt(roastMode, occasion) {
    const delta = roastMode
        ? `ROAST🔥 Playfully brutal. Clothes only. Score:45-70.`
        : `NICE✨ Hype up. Main character. Score:70-88.`;

    return `${CANONICAL}
${delta}
Verdict:Screenshot-worthy.${occasion ? ` For:${occasion}` : ''}`
}

export async function analyzeWithGemini(imageBase64, options = {}) {
    const { roastMode = false, occasion = null } = options;
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
    console.log(`[${requestId}] Starting Gemini analysis (roastMode: ${roastMode})`);
    console.log(`[${requestId}] Image data length: ${base64Data.length}`);

    const requestBody = {
        contents: [{
            parts: [
                { text: createGeminiPrompt(roastMode, occasion) },
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
            maxOutputTokens: 500
        }
    };

    // Models to try in order (fallback chain) - Dec 2025 valid models
    const models = [
        config.gemini.model || 'gemini-2.5-flash',
        'gemini-2.0-flash'  // Fallback - GA since Feb 2025
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
                        roastMode: roastMode
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
