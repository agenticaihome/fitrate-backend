/**
 * Gemini Outfit Analyzer - Free tier for all users
 * Uses Google's Gemini Flash 2.0 for fast, free outfit analysis
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';

// Validate API key exists
if (!config.gemini.apiKey) {
    console.error('CRITICAL: GEMINI_API_KEY not set!');
}

const genAI = config.gemini.apiKey ? new GoogleGenerativeAI(config.gemini.apiKey) : null;

// Aesthetics and celebrity matches (same as OpenAI version)
const AESTHETICS = [
    'Clean Girl', 'Dark Academia', 'Quiet Luxury', 'Streetwear', 'Y2K',
    'Cottagecore', 'Minimalist', 'Coastal Grandmother', 'Grunge', 'Preppy',
    'Gorpcore', 'Balletcore', 'Old Money', 'Skater', 'Bohemian', 'Normcore'
];

const CELEBRITIES = [
    'Timothée Chalamet at the airport', 'Zendaya on press tour', 'Bad Bunny off-duty',
    'Hailey Bieber coffee run', 'A$AP Rocky front row', 'Bella Hadid street style',
    'Harry Styles on tour', 'Kendall Jenner model off-duty', 'Tyler the Creator at Coachella',
    'Dua Lipa going to dinner', 'Jacob Elordi casual', 'Sydney Sweeney brunch'
];

function createGeminiPrompt(roastMode, occasion) {
    const modeInstructions = roastMode
        ? `You are in ROAST MODE - be brutally honest and savage about the outfit (NOT the person's body). Use Gen Z slang and humor. Be harsh but ultimately helpful.`
        : `You are a supportive fashion friend. Be honest but encouraging. Use Gen Z language naturally.`;

    return `You are FitRate, an AI fashion analyst. ${modeInstructions}

Analyze this outfit photo and rate it.

${occasion ? `Context: This outfit is for ${occasion}. Factor this into your scores.` : ''}

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "overall": <number 0-100>,
  "color": <number 0-100>,
  "fit": <number 0-100>,
  "style": <number 0-100>,
  "occasion": <number 0-100>,
  "trendScore": <number 0-100>,
  "verdict": "<${roastMode ? 'savage one-liner roast' : 'supportive verdict'} with emoji>",
  "tip": "<${roastMode ? 'blunt advice' : 'one helpful tip'}>",
  "aesthetic": "<one from: ${AESTHETICS.slice(0, 8).join(', ')}>",
  "celebMatch": "<one from: ${CELEBRITIES.slice(0, 6).join(', ')}>",
  "isValidOutfit": true
}

If no outfit visible, respond: {"isValidOutfit": false, "error": "reason"}

SCORING: ${roastMode ? 'Be harsh. Average = 50-65.' : 'Be fair. Average = 70-85.'}`;
}

export async function analyzeWithGemini(imageBase64, options = {}) {
    const { roastMode = false, occasion = null } = options;
    const requestId = `gemini_${Date.now()}`;

    // Check if API is configured
    if (!genAI) {
        console.error(`[${requestId}] Gemini API not configured - missing API key`);
        return {
            success: false,
            error: 'AI service not configured. Please contact support.'
        };
    }

    try {
        console.log(`[${requestId}] Starting Gemini analysis (roastMode: ${roastMode})`);

        // Use a stable model name - gemini-1.5-flash is the free tier model
        const modelName = config.gemini.model || 'gemini-1.5-flash';
        console.log(`[${requestId}] Using model: ${modelName}`);

        const model = genAI.getGenerativeModel({ model: modelName });

        // Clean base64 data
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        console.log(`[${requestId}] Image data length: ${base64Data.length}`);

        // Prepare the image part
        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: 'image/jpeg'
            }
        };

        // Generate content
        const result = await model.generateContent([
            createGeminiPrompt(roastMode, occasion),
            imagePart
        ]);

        const response = await result.response;
        const content = response.text();

        if (!content) {
            throw new Error('No response from Gemini');
        }

        console.log(`[${requestId}] Received Gemini response (${content.length} chars)`);
        console.log(`[${requestId}] Raw response: ${content.substring(0, 200)}...`);

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

        console.log(`[${requestId}] Gemini analysis successful - Score: ${parsed.overall}`);

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
        console.error(`[${requestId}] Gemini error:`, error.message);
        console.error(`[${requestId}] Full error:`, error);

        // More specific error messages
        let errorMessage = 'AI analysis failed. Please try again.';

        if (error.message?.includes('API_KEY')) {
            errorMessage = 'AI service configuration error.';
        } else if (error.message?.includes('SAFETY')) {
            errorMessage = 'Image could not be analyzed. Please try a different photo.';
        } else if (error.message?.includes('JSON')) {
            errorMessage = 'Analysis formatting error. Please try again.';
        } else if (error.message?.includes('quota') || error.message?.includes('limit')) {
            errorMessage = 'AI service is busy. Please try again in a moment.';
        }

        return {
            success: false,
            error: errorMessage
        };
    }
}

