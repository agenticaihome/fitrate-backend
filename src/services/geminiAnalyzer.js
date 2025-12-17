/**
 * Gemini Outfit Analyzer - Free tier for all users
 * Uses Google's Gemini API via REST for reliable image analysis
 */

import { config } from '../config/index.js';

// Aesthetics and celebrity matches
const AESTHETICS = [
    'Clean Girl', 'Dark Academia', 'Quiet Luxury', 'Streetwear', 'Y2K',
    'Cottagecore', 'Minimalist', 'Coastal Grandmother', 'Grunge', 'Preppy'
];

const CELEBRITIES = [
    'Timothée Chalamet', 'Zendaya', 'Bad Bunny', 'Hailey Bieber',
    'Bella Hadid', 'Harry Styles', 'Kendall Jenner', 'Dua Lipa'
];

function createGeminiPrompt(roastMode, occasion) {
    const modeInstructions = roastMode
        ? `Be brutally honest and savage about the outfit (NOT the person's body). Use Gen Z slang.`
        : `Be supportive and encouraging. Use Gen Z language naturally.`;

    return `You are FitRate, an AI fashion analyst. ${modeInstructions}

Analyze this outfit photo. Respond ONLY with valid JSON (no markdown):
{
  "overall": <number 0-100>,
  "color": <number 0-100>,
  "fit": <number 0-100>,
  "style": <number 0-100>,
  "occasion": <number 0-100>,
  "trendScore": <number 0-100>,
  "verdict": "<short verdict with emoji>",
  "tip": "<one helpful tip>",
  "aesthetic": "<one from: ${AESTHETICS.join(', ')}>",
  "celebMatch": "<one from: ${CELEBRITIES.join(', ')}>",
  "isValidOutfit": true
}

If you can't rate the outfit, respond with:
{
  "isValidOutfit": false,
  "error": "<helpful message explaining what's wrong and how to fix it>"
}

Examples of helpful error messages:
- If shirtless/no top: "Throw on a shirt or jacket so I can rate your full fit! 👕"
- If too blurry: "Photo's too blurry — try again with better lighting 📸"
- If no person visible: "I need to see you wearing the outfit! Take a mirror pic 🪞"
- If just face/head: "Show more of the fit! I need to see your whole outfit 👀"
- If meme/random image: "That's not an outfit! Upload a pic of what you're wearing 😅"

${occasion ? `Context: This outfit is for ${occasion}.` : ''}
Scoring: ${roastMode ? 'Be harsh. Average = 50-65.' : 'Be fair. Average = 70-85.'}`;
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
                occasion: Math.round(parsed.occasion),
                trendScore: Math.round(parsed.trendScore),
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


