/**
 * Gemini Outfit Analyzer - Free tier for all users
 * Uses Google's Gemini API via REST for reliable image analysis
 * VIRAL PROMPT DESIGN: Short, shareable, meme-worthy outputs
 */

import { config } from '../config/index.js';

// Aesthetics trending on TikTok/Instagram
const AESTHETICS = [
    'Clean Girl', 'Dark Academia', 'Quiet Luxury', 'Streetwear', 'Y2K',
    'Cottagecore', 'Mob Wife', 'Coastal Grandmother', 'Grunge', 'Old Money',
    'Coquette', 'Balletcore', 'Tomato Girl', 'Eclectic Grandpa'
];

// Celebrity comparisons that get shared
const CELEBRITIES = [
    'Timothée Chalamet at the airport', 'Zendaya on a press tour',
    'Bad Bunny off-duty', 'Hailey Bieber on a coffee run',
    'Bella Hadid street style', 'Harry Styles on tour',
    'Kendall Jenner model off-duty', 'Rihanna anywhere',
    'Jacob Elordi casual', 'Sydney Sweeney brunch'
];

function createGeminiPrompt(roastMode, occasion) {
    // Viral prompt: Short, punchy, shareable
    const modeVibe = roastMode
        ? `ROAST MODE 🔥 Be BRUTALLY honest. Savage but never body-shame. Roast the CLOTHES only. Use viral Gen Z humor.`
        : `NICE MODE ✨ Be hyping them UP. Make them feel like a main character. Supportive with style.`;

    return `You are FitRate AI—the most viral outfit rater on the internet. Your verdicts get screenshotted and shared.

${modeVibe}

RULES FOR VIRAL OUTPUT:
1. Verdict: MAX 8 WORDS. Punchy. Meme-worthy. Use 1-2 emojis. Screenshot-able.
2. Tip: ONE specific, actionable tip. Reference actual items in photo.
3. Be opinionated—boring doesn't get shared.

Respond ONLY in valid JSON:
{
  "overall": <0-100>,
  "color": <0-100>,
  "fit": <0-100>,
  "style": <0-100>,
  "verdict": "<MAX 8 WORDS with emoji - make it quotable>",
  "tip": "<one specific tip>",
  "aesthetic": "<one: ${AESTHETICS.slice(0, 8).join(', ')}>",
  "celebMatch": "<compare to: ${CELEBRITIES.slice(0, 5).join(', ')}>",
  "isValidOutfit": true
}

${roastMode ? 'BE SAVAGE. Score average: 45-65. Verdicts like: "The fit said error 404 drip not found 💀"' : 'BE ENCOURAGING. Score average: 70-88. Verdicts like: "Main character energy activated ✨"'}
${occasion ? `Context: Outfit for ${occasion}` : ''}

If NOT a valid outfit photo:
{"isValidOutfit": false, "error": "<fun, helpful message to retry>"}`;
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

    try {
        console.log(`[${requestId}] Starting Gemini analysis (roastMode: ${roastMode})`);

        // Clean base64 data
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        console.log(`[${requestId}] Image data length: ${base64Data.length}`);

        // Use model from config
        const modelName = config.gemini.model || 'gemini-2.5-flash';
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

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

        console.log(`[${requestId}] Calling Gemini REST API (model: ${modelName})...`);

        // Add timeout to prevent hung requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': config.gemini.apiKey  // API key in header (more secure)
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();

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

        console.log(`[${requestId}] Analysis successful - Score: ${parsed.overall}`);

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
        console.error(`[${requestId}] Error:`, error.message);

        let errorMessage = 'AI analysis failed. Please try again.';
        if (error.name === 'AbortError') {
            errorMessage = 'Analysis is taking too long. Please try again.';
        } else if (error.message?.includes('API key')) {
            errorMessage = 'AI service configuration error.';
        } else if (error.message?.includes('SAFETY')) {
            errorMessage = 'Image could not be analyzed.';
        } else if (error.message?.includes('quota')) {
            errorMessage = 'AI service is busy. Try again soon.';
        }

        return {
            success: false,
            error: errorMessage
        };
    }
}


