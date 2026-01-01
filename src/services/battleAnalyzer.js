/**
 * Battle Analyzer - Comparative Outfit Scoring
 * Uses Gemini to compare TWO outfits head-to-head and pick a winner
 * This ensures dramatically reduced ties compared to independent scoring
 */

import { config } from '../config/index.js';
import { MODE_CONFIGS } from '../config/systemPrompt.js';

// Comparative battle prompt - evaluates both outfits simultaneously
function buildComparativePrompt(mode = 'nice') {
    const modeConfig = MODE_CONFIGS[mode] || MODE_CONFIGS.nice;

    return `FitRate AI — BATTLE MODE: Head-to-Head Outfit Comparison

You are judging a 1v1 outfit battle. You will see TWO outfit images.
Your job: Compare them fairly and declare a CLEAR WINNER.

MODE: ${mode.toUpperCase()} ${modeConfig.emojis}
Tone: ${modeConfig.tone}

⚔️ BATTLE JUDGING RULES:
1. Compare the outfits DIRECTLY against each other (not against some abstract standard)
2. Consider: color coordination, fit quality, style cohesion, vibe, and overall impact
3. One outfit MUST win - ties are only allowed if outfits are nearly identical
4. Score each outfit 0-100 with 2 DECIMAL places (e.g., 73.47)
5. The winner should have a meaningfully higher score (3+ points difference minimum)
6. Provide specific reasons WHY one outfit beats the other

SCORING GUIDANCE:
- If one clearly dominates: 15-25 point gap
- If close but one edges ahead: 5-15 point gap  
- If extremely close: 3-5 point gap (still pick a winner!)
- True tie (nearly identical): exact same score (RARE - avoid unless truly warranted)

OUTPUT FORMAT (JSON only):
{
    "outfit1Score": <0.00-100.00>,
    "outfit2Score": <0.00-100.00>,
    "winner": <1 or 2 or 0 for tie>,
    "marginOfVictory": <absolute difference>,
    "outfit1Verdict": "<5-9 word verdict for outfit 1>",
    "outfit2Verdict": "<5-9 word verdict for outfit 2>",
    "battleCommentary": "<Fun 1-2 sentence summary of the battle>",
    "winningFactor": "<What gave the winner the edge>"
}

IMPORTANT: Be DECISIVE. Fashion is subjective but you must commit to a winner.
Pick the outfit that would turn more heads, get more compliments, or photograph better.`;
}

/**
 * Compare two outfits head-to-head using Gemini
 * @param {string} image1Base64 - First outfit image
 * @param {string} image2Base64 - Second outfit image  
 * @param {Object} options - { mode: string }
 * @returns {Object} Battle result with scores, winner, and commentary
 */
export async function compareBattleOutfits(image1Base64, image2Base64, options = {}) {
    const { mode = 'nice' } = options;
    const requestId = `battle_compare_${Date.now()}`;

    // Check if API key is configured
    if (!config.gemini.apiKey) {
        console.error(`[${requestId}] ❌ CRITICAL: GEMINI_API_KEY not set!`);
        return {
            success: false,
            error: 'Unable to connect to AI service.',
            code: 'AI_SERVICE_UNAVAILABLE'
        };
    }

    // Clean base64 data
    const base64Data1 = image1Base64.replace(/^data:image\/\w+;base64,/, '');
    const base64Data2 = image2Base64.replace(/^data:image\/\w+;base64,/, '');

    console.log(`[${requestId}] Starting comparative battle analysis (mode: ${mode})`);

    const requestBody = {
        contents: [{
            parts: [
                { text: buildComparativePrompt(mode) },
                { text: "OUTFIT 1:" },
                {
                    inline_data: {
                        mime_type: 'image/jpeg',
                        data: base64Data1
                    }
                },
                { text: "OUTFIT 2:" },
                {
                    inline_data: {
                        mime_type: 'image/jpeg',
                        data: base64Data2
                    }
                }
            ]
        }],
        generationConfig: {
            temperature: 0.8,  // Higher for varied, decisive responses
            maxOutputTokens: 600
        }
    };

    const models = [
        config.gemini.model || 'gemini-2.5-flash',  // Primary - fast and reliable
        'gemini-2.0-flash'  // Fallback
    ];

    for (const modelName of models) {
        const maxRetries = 2;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
                console.log(`[${requestId}] Calling Gemini for battle (model: ${modelName}, attempt: ${attempt})`);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s for 2 images

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

                if (response.status === 503 || data.error?.status === 'UNAVAILABLE') {
                    console.warn(`[${requestId}] Model ${modelName} overloaded (attempt ${attempt})`);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, 1000 * attempt));
                        continue;
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

                console.log(`[${requestId}] Received battle response (${content.length} chars)`);

                // Parse JSON response
                let jsonStr = content.trim();
                if (jsonStr.startsWith('```')) {
                    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
                }
                const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[0];
                }

                const parsed = JSON.parse(jsonStr);

                console.log(`[${requestId}] ⚔️ Battle result: Outfit ${parsed.winner} wins (${parsed.outfit1Score} vs ${parsed.outfit2Score})`);

                return {
                    success: true,
                    battle: {
                        outfit1Score: parseFloat(parsed.outfit1Score.toFixed(2)),
                        outfit2Score: parseFloat(parsed.outfit2Score.toFixed(2)),
                        winner: parsed.winner,
                        marginOfVictory: parseFloat(Math.abs(parsed.outfit1Score - parsed.outfit2Score).toFixed(2)),
                        outfit1Verdict: parsed.outfit1Verdict,
                        outfit2Verdict: parsed.outfit2Verdict,
                        battleCommentary: parsed.battleCommentary,
                        winningFactor: parsed.winningFactor,
                        mode: mode
                    }
                };
            } catch (error) {
                console.error(`[${requestId}] Error with ${modelName} (attempt ${attempt}):`, error.message);

                if (error.message === 'Model overloaded') {
                    break; // Move to next model
                }

                if (error.name === 'AbortError' && attempt < maxRetries) {
                    console.log(`[${requestId}] Timeout, retrying...`);
                    continue;
                }

                if (attempt === maxRetries) {
                    break;
                }
            }
        }
    }

    console.error(`[${requestId}] ❌ Battle comparison failed after all retries`);
    return {
        success: false,
        error: 'Unable to complete battle comparison. Please try again.',
        code: 'BATTLE_COMPARISON_FAILED'
    };
}
