/**
 * Gemini Outfit Analyzer - Free tier
 * OCD-LEVEL PROMPT: Strict mode enforcement, exact formats, verbatim hooks
 * Uses centralized system prompt configuration for consistency
 */

import { config } from '../config/index.js';
import {
    buildSystemPrompt,
    ERROR_MESSAGES,
    MODE_CONFIGS,
    OUTPUT_LENGTHS,
    VIRALITY_HOOKS,
    getViralityHooks,
    BATTLE_SCORING_INSTRUCTIONS,
    getDynamicTemperature
} from '../config/systemPrompt.js';

// Create the full prompt for Gemini (Free tier)
function createGeminiPrompt(mode, occasion, securityContext = {}, eventContext = null, battleMode = false, dailyChallengeContext = null) {
    const {
        userId = 'anonymous',
        scansUsed = 0,
        dailyLimit = 2,
        referralExtrasEarned = 0,
        authTokenValid = true,
        suspiciousFlag = false,
        fingerprintHash = ''
    } = securityContext;

    // NOTE: All modes now work in Gemini - no more Pro/GPT-4o restrictions
    // Previously honest/savage were restricted but that caused Daily Challenge failures

    // Build full security context for the prompt
    const fullSecurityContext = {
        auth_token_valid: authTokenValid,
        user_id: userId,
        scans_used: scansUsed,
        daily_limit: dailyLimit,
        referral_extras_earned: referralExtrasEarned,
        suspicious_flag: suspiciousFlag,
        fingerprint_hash: fingerprintHash
    };

    // Use centralized system prompt builder (now includes dailyChallengeContext)
    let prompt = buildSystemPrompt('free', mode, fullSecurityContext, eventContext, dailyChallengeContext);

    // Add occasion context if provided
    if (occasion) {
        prompt += `\n\nOCCASION CONTEXT: Rate for "${occasion}" appropriateness.`;
    }

    // Add battle mode instructions for high variance scoring
    if (battleMode) {
        prompt += `\n\n${BATTLE_SCORING_INSTRUCTIONS}`;
    }

    return prompt;
}

export async function analyzeWithGemini(imageBase64, options = {}) {
    // Support both old roastMode boolean and new mode string for backwards compatibility
    const { roastMode = false, mode: modeParam = null, occasion = null, securityContext = {}, eventContext = null, battleMode = false, dailyChallengeContext = null } = options;
    const mode = modeParam || (roastMode ? 'roast' : 'nice');
    const requestId = `gemini_${Date.now()}`;

    // Check if API key is configured
    if (!config.gemini.apiKey) {
        console.error(`[${requestId}] ❌ CRITICAL: GEMINI_API_KEY not set!`);
        return {
            success: false,
            error: 'Unable to connect to AI service. Please try again later or contact support.',
            code: 'AI_SERVICE_UNAVAILABLE'
        };
    }

    // Clean base64 data once
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    console.log(`[${requestId}] Starting Gemini analysis (mode: ${mode})`);
    console.log(`[${requestId}] Image data length: ${base64Data.length}`);

    // Dynamic temperature based on mode (battle mode gets extra boost)
    const baseTemp = getDynamicTemperature(mode);
    const temperature = battleMode ? Math.min(baseTemp + 0.15, 1.1) : baseTemp;
    console.log(`[${requestId}] Using dynamic temperature: ${temperature.toFixed(2)} (mode: ${mode}, battle: ${battleMode})`);

    const requestBody = {
        contents: [{
            parts: [
                { text: createGeminiPrompt(mode, occasion, securityContext, eventContext, battleMode, dailyChallengeContext) },
                {
                    inline_data: {
                        mime_type: 'image/jpeg',
                        data: base64Data
                    }
                }
            ]
        }],
        generationConfig: {
            temperature: temperature,
            maxOutputTokens: 800  // Increased buffer for complex JSON output
        }
    };

    // Models to try in order (fallback chain) - Use latest stable Gemini models
    const models = [
        'gemini-3-flash-preview',                     // Primary - newest, best outputs (preview)
        config.gemini.model || 'gemini-2.5-flash',    // Fallback 1 - stable
        'gemini-2.0-flash'                            // Fallback 2 - legacy
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

                // Try to repair truncated JSON
                let parsed;
                try {
                    parsed = JSON.parse(jsonStr);
                } catch (parseError) {
                    console.warn(`[${requestId}] JSON parse failed, attempting repair: ${parseError.message}`);

                    // Try to close unclosed brackets/braces
                    let repaired = jsonStr;

                    // Count brackets and close any that are open
                    const openBraces = (repaired.match(/\{/g) || []).length;
                    const closeBraces = (repaired.match(/\}/g) || []).length;
                    const openBrackets = (repaired.match(/\[/g) || []).length;
                    const closeBrackets = (repaired.match(/\]/g) || []).length;

                    // If truncated mid-string, close the string
                    if (repaired.match(/"[^"]*$/)) {
                        repaired += '"';
                    }

                    // Close arrays
                    for (let i = 0; i < openBrackets - closeBrackets; i++) {
                        repaired += ']';
                    }

                    // Close objects
                    for (let i = 0; i < openBraces - closeBraces; i++) {
                        repaired += '}';
                    }

                    try {
                        parsed = JSON.parse(repaired);
                        console.log(`[${requestId}] JSON repair successful`);
                    } catch (repairError) {
                        // Still failed - throw original error
                        throw parseError;
                    }
                }

                if (!parsed.isValidOutfit) {
                    return {
                        success: false,
                        error: parsed.error || 'Could not analyze this image',
                        code: 'INVALID_OUTFIT'
                    };
                }

                console.log(`[${requestId}] Analysis successful with ${modelName} - Score: ${parsed.overall}`);

                // Get virality hooks for this mode
                const viralityHooks = getViralityHooks(mode);
                const modeConfig = MODE_CONFIGS[mode];

                return {
                    success: true,
                    scores: {
                        overall: parsed.overall,
                        rating: `${parsed.overall}`,  // String format for consistency
                        color: parsed.color,
                        fit: parsed.fit,
                        style: parsed.style,
                        text: parsed.text || parsed.verdict,  // Analysis text
                        verdict: parsed.verdict,
                        line: parsed.line,
                        tagline: parsed.tagline,
                        aesthetic: parsed.aesthetic,
                        celebMatch: parsed.celebMatch,
                        judgedBy: parsed.judgedBy || null,  // Character archetype who judged (for celeb mode share cards)
                        mode: mode,
                        roastMode: mode === 'roast',
                        shareHook: parsed.shareHook || modeConfig?.shareHook,
                        virality_hooks: parsed.virality_hooks || viralityHooks,
                        // 🎁 SURPRISE BONUS FIELDS (randomly generated ~10% chance each)
                        outfitFortune: parsed.outfitFortune || null,
                        outfitLore: parsed.outfitLore || null,
                        outfitSoundtrack: parsed.outfitSoundtrack || null,
                        outfitEnemy: parsed.outfitEnemy || null,
                        outfitDatingApp: parsed.outfitDatingApp || null,
                        outfitPowerMove: parsed.outfitPowerMove || null
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
    console.error(`[${requestId}] ❌ All Gemini models failed after retries`);
    return {
        success: false,
        error: 'Unable to connect to AI service. Please try again in a moment! 🔄',
        code: 'AI_CONNECTION_FAILED'
    };
}
