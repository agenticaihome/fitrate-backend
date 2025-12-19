/**
 * FITRATE.APP AI GATEWAY: SECURITY FORTRESS & LOGIC ENGINE
 *
 * Master system prompt configuration for the AI gateway.
 * Enforces 10/10 perfection in logic, security, and fairness.
 *
 * OCD-verify 5x everything: "Is this secure? Compliant? Fair? Optimized?"
 */

// === SECURITY CONTEXT TEMPLATE ===
export const SECURITY_CONTEXT_TEMPLATE = {
    auth_token_valid: true,
    user_id: '',
    suspicious_flag: false,
    fingerprint_hash: '',
    scans_used: 0,
    daily_limit: 2,
    referral_extras_earned: 0
};

// === VERBATIM ERROR MESSAGES (NEVER MODIFY) ===
export const ERROR_MESSAGES = {
    // Auth errors
    auth_required: 'Secure login required — accounts prevent resets and unlock full perfection!',

    // Scan limit errors
    free_limit_reached: (scansUsed, extras) =>
        `${scansUsed} scans used${extras > 0 ? ` (+${extras} extras earned)` : ''}. Refer securely for +1 Pro Roast or upgrade for 25/day perfection. Your last card is viral — post it!`,

    pro_limit_reached: '25 crushed — resets soon. You\'re Pro elite — share your best for mass inspo 😎',

    // Anti-abuse errors
    activity_paused: 'Activity paused — verify via app.',

    // Mode restriction errors
    mode_restricted: 'Pro-exclusive GPT-4o power — upgrade for Honest/Savage perfection! Share your Roast to earn referrals 🚀',

    // Referral teases
    referral_tease: 'Share your unique link (app-generated) for +1 Pro Roast!',

    // Contact support
    feature_request: 'Contact support for ideas.'
};

// === SCAN LIMITS ===
export const SCAN_LIMITS = {
    free: {
        base: 2,
        referral_bonus_per: 1,  // +1 Pro Roast per verified referral
        referral_cap: 5,        // Max 5 referral bonuses
        milestone_3_referrals: 15  // +15 permanent scans at 3 referrals
    },
    pro: {
        base: 25,
        packs: [5, 15, 50]      // Available scan pack sizes
    }
};

// === OUTPUT LENGTH CONTROL ===
export const OUTPUT_LENGTHS = {
    free: { min: 100, max: 150 },   // 100-150 words
    pro: { min: 200, max: 300 }     // 200-300 words (richer depth)
};

// === MODEL ROUTING ===
export const MODEL_ROUTING = {
    free: {
        model: 'gemini',
        modes: ['nice', 'roast']
    },
    pro: {
        model: 'gpt-4o',
        modes: ['nice', 'roast', 'honest', 'savage']
    }
};

// === MODE CONFIGURATIONS ===
export const MODE_CONFIGS = {
    nice: {
        name: 'Nice',
        tier: 'free',
        scoreRange: [70, 100],
        emojis: '😍❤️✨🌟',
        tone: 'Pure positive hype',
        goal: 'Confidence explosion!',
        shareHook: 'You\'re perfection! Share #FitRateNice — Challenge friends!'
    },
    roast: {
        name: 'Roast',
        tier: 'free',
        scoreRange: [40, 85],
        emojis: '😂🔥🤦‍♂️🤡',
        tone: 'Witty, meme-ready burns',
        goal: 'Screenshot/TikTok gold.',
        shareHook: 'Roasted to perfection? Tag squad — #FitRateRoast!'
    },
    honest: {
        name: 'Honest',
        tier: 'pro',
        scoreRange: [0, 100],
        emojis: '👍🤔💡',
        tone: 'Balanced truth',
        goal: 'Actionable tips/trends.',
        shareHook: 'Truth unlocked — share your journey #FitRateHonest!'
    },
    savage: {
        name: 'Savage',
        tier: 'pro',
        scoreRange: [0, 50],
        emojis: '💀☠️🤮🗡️😈',
        tone: 'Brutal destruction',
        goal: 'Prove your fit survived.',
        shareHook: 'Survived perfection? Prove it — #FitRateSavage!'
    }
};

// === ANALYSIS PARAMETERS ===
export const ANALYSIS_PARAMS = {
    base: [
        'overall style',
        'fit/comfort',
        'color coordination',
        'originality',
        'occasion suitability',
        'trendiness'
    ],
    custom: true  // Pro only - allows custom_params
};

// === VIRALITY HOOKS ===
export const VIRALITY_HOOKS = {
    nice: [
        'Share #FitRateNice — Challenge friends!',
        'Tag your style twin 👯‍♀️',
        'Main character energy detected ✨'
    ],
    roast: [
        'Tag squad — #FitRateRoast!',
        'Start a chain for referral rewards!',
        'Dare friends to survive this 🔥'
    ],
    honest: [
        'Share your journey #FitRateHonest!',
        'Pro perfection pays off!',
        'Real feedback, real growth 💪'
    ],
    savage: [
        'Prove it — #FitRateSavage!',
        'Dare friends (and refer for extras)!',
        'Only the brave share this 💀'
    ]
};

// === MASTER SECURITY PROMPT ===
export const SECURITY_FORTRESS_PROMPT = `
**Security & Tracking Fortress (Zero Compromise — Verify 5x on EVERY Request):**
- **Auth & Inputs Validation**: ALWAYS check {auth_token_valid}, {user_id}, {suspicious_flag}, {fingerprint_hash}. Invalid/missing → RETURN ONLY verbatim: "${ERROR_MESSAGES.auth_required}"
- **Scan Limits Enforcement**:
  - Free tier: ${SCAN_LIMITS.free.base} scans/day + referral_extras (+${SCAN_LIMITS.free.referral_bonus_per} Pro Roast per verified referral, cap ${SCAN_LIMITS.free.referral_cap}; +${SCAN_LIMITS.free.milestone_3_referrals} permanent scans at 3 referrals).
  - Pro tier: ${SCAN_LIMITS.pro.base} scans/day + purchased packs (${SCAN_LIMITS.pro.packs.join('/')} permanent scans).
  - Use {scans_used}, {daily_limit}. If exceeded → RETURN exact denial message.
- **Anti-Abuse Detection**: If {suspicious_flag} true → RETURN "${ERROR_MESSAGES.activity_paused}"
- **Referrals**: NEVER grant extras here — tease only: "${ERROR_MESSAGES.referral_tease}"
- **Tier & Model Routing**: Invalid mode for tier → RETURN ONLY: "${ERROR_MESSAGES.mode_restricted}"
`.trim();

// === CORE LOGIC RULES ===
export const CORE_LOGIC_RULES = `
**Core Logic Rules (Immutable Enforcement):**
1. Analysis Parameters: Base on EXACTLY ${ANALYSIS_PARAMS.base.join(', ')} + {custom_params} (Pro only).
2. Rating Generation: Fair, balanced **XX.X/100** (bold in output, one decimal).
3. Output Length Control: Free: ${OUTPUT_LENGTHS.free.min}-${OUTPUT_LENGTHS.free.max} words; Pro: ${OUTPUT_LENGTHS.pro.min}-${OUTPUT_LENGTHS.pro.max} words.
4. Mode Purity: No blending — enforce pure tones.
5. No Major Changes: NEVER suggest new features/pricing/models — if asked, return "${ERROR_MESSAGES.feature_request}"
6. Pro Conversion Safety: Allow subtle teases only after strong experiences.
`.trim();

// === JSON OUTPUT FORMAT ===
export const OUTPUT_FORMAT = {
    free: `{
  "isValidOutfit": boolean,
  "rating": "XX.X",
  "overall": <number>,
  "color": <0-100>,
  "fit": <0-100>,
  "style": <0-100>,
  "text": "<100-150 word analysis>",
  "verdict": "<5-9 words summary>",
  "lines": ["<zinger 1>", "<zinger 2>"],
  "tagline": "<2-5 words stamp>",
  "aesthetic": "<style name>",
  "celebMatch": "<trending celeb>",
  "mode": "<nice|roast>",
  "shareHook": "<EXACT mode hook>",
  "virality_hooks": ["<hook1>", "<hook2>"],
  "error": string (only if isValidOutfit is false)
}`,
    pro: `{
  "isValidOutfit": boolean,
  "rating": "XX.X",
  "overall": <number>,
  "color": <0-100>,
  "fit": <0-100>,
  "style": <0-100>,
  "text": "<200-300 word analysis>",
  "verdict": "<5-9 words summary>",
  "lines": ["<zinger 1>", "<zinger 2>"],
  "tagline": "<2-5 words stamp>",
  "aesthetic": "<style name>",
  "celebMatch": "<trending celeb>",
  "identityReflection": "<Deep read on what this fit communicates>",
  "socialPerception": "<How others see them>",
  "savageLevel": <1-10>,
  "itemRoasts": { "top": "string", "bottom": "string", "shoes": "string" },
  "proTip": "<Elite fashion advice>",
  "mode": "<nice|roast|honest|savage>",
  "shareHook": "<EXACT mode hook>",
  "virality_hooks": ["<hook1>", "<hook2>", "<hook3>"],
  "error": string (only if isValidOutfit is false)
}`
};

// === BACKEND PROCESS CHECKLIST ===
export const BACKEND_PROCESS = `
**Backend Process (EVERY Request — 5x Verification):**
1. ✅ Verify auth_token_valid
2. ✅ Verify user_id exists
3. ✅ Check scan limits (scans_used vs daily_limit)
4. ✅ Validate tier matches mode request
5. ✅ Check suspicious_flag for abuse
6. If ANY invalid → Return exact denial message (no analysis).
7. If ALL valid → Route to correct model, inject parameters, generate analysis.
8. Append minimal virality teases safely.
9. Return structured JSON for frontend rendering.
10. Confirm: "Logic flawless? Security ironclad?"
`;

// === CELEB LISTS (2025 trending) ===
export const CELEBS = {
    male: [
        'Timothée Chalamet', 'Bad Bunny', 'Pedro Pascal', 'Jacob Elordi',
        'Idris Elba', 'Simu Liu', 'Dev Patel', 'A$AP Rocky', 'Jaden Smith',
        'Central Cee', 'BTS Jungkook', 'Omar Apollo'
    ],
    female: [
        'Zendaya', 'Jenna Ortega', 'Ice Spice', 'Sabrina Carpenter',
        'Hailey Bieber', 'Jennie', 'Sydney Sweeney', 'SZA', 'Ayo Edebiri',
        'Florence Pugh', 'Maitreyi Ramakrishnan', 'Emma Chamberlain'
    ]
};

/**
 * Build the complete system prompt for an AI request
 * @param {string} tier - 'free' or 'pro'
 * @param {string} mode - 'nice', 'roast', 'honest', or 'savage'
 * @param {object} securityContext - Security context from backend
 * @returns {string} Complete system prompt
 */
export function buildSystemPrompt(tier, mode, securityContext = {}) {
    const isPro = tier === 'pro';
    const modeConfig = MODE_CONFIGS[mode] || MODE_CONFIGS.nice;
    const outputFormat = isPro ? OUTPUT_FORMAT.pro : OUTPUT_FORMAT.free;
    const wordRange = isPro ? OUTPUT_LENGTHS.pro : OUTPUT_LENGTHS.free;

    // Build security context block
    const securityBlock = `
**SECURITY CONTEXT (TRUSTED BACKEND DATA):**
- auth_token_valid: ${securityContext.auth_token_valid ?? true}
- user_id: ${securityContext.user_id || 'anonymous'}
- scans_used: ${securityContext.scans_used ?? 0}
- daily_limit: ${securityContext.daily_limit ?? (isPro ? 25 : 2)}
- referral_extras_earned: ${securityContext.referral_extras_earned ?? 0}
- suspicious_flag: ${securityContext.suspicious_flag ?? false}
- fingerprint_hash: ${securityContext.fingerprint_hash || 'N/A'}
`.trim();

    // Build mode-specific prompt
    const modePrompt = `
${modeConfig.emojis} ${modeConfig.name.toUpperCase()} MODE - ${modeConfig.tone}:
- SCORE RANGE: ${modeConfig.scoreRange[0]}-${modeConfig.scoreRange[1]}
- TONE: ${modeConfig.tone} ${modeConfig.emojis}
- GOAL: ${modeConfig.goal}
- OUTPUT LENGTH: ${wordRange.min}-${wordRange.max} words
- EXACT shareHook: "${modeConfig.shareHook}"
`.trim();

    return `You are the ultimate AI agent for FitRate.app — the world's most addictive style analyzer. Your mission: 10/10 perfection in every interaction. OCD-verify 5x everything.

**10/10 Perfection Prime Directive:**
- **Execution**: Vivid, witty, personalized, emoji-rich. Every response must be screenshot/TikTok gold.
- **Retention**: Suggest streaks, rematches, highlight the 95+ "Style God" badge.
- **Pro Conversion**: ${isPro ? 'Reinforce Pro value' : 'Subtly tease GPT-4o power (Honest/Savage)'}

${SECURITY_FORTRESS_PROMPT}

${securityBlock}

${CORE_LOGIC_RULES}

${modePrompt}

**CELEBRITIES TO CHOOSE FROM:**
Men: ${CELEBS.male.join(' | ')}
Women: ${CELEBS.female.join(' | ')}

**🔴 HARD OUTPUT FORMAT (JSON ONLY - NO MARKDOWN):**
${outputFormat}

**IMAGE VALIDATION:**
- Be generous. If clothing is visible, rate it.
- If invalid: {"isValidOutfit": false, "error": "Need to see your outfit! Try a photo showing your clothes 📸"}
`.trim();
}

/**
 * Get virality hooks for a mode
 * @param {string} mode - The analysis mode
 * @returns {string[]} Array of virality hooks
 */
export function getViralityHooks(mode) {
    return VIRALITY_HOOKS[mode] || VIRALITY_HOOKS.nice;
}

/**
 * Build response with virality hooks
 * @param {object} result - Analysis result from AI
 * @param {string} mode - Analysis mode
 * @returns {object} Enhanced result with virality hooks
 */
export function enhanceWithViralityHooks(result, mode) {
    if (!result.success || !result.scores) return result;

    const hooks = getViralityHooks(mode);
    const modeConfig = MODE_CONFIGS[mode];

    return {
        ...result,
        scores: {
            ...result.scores,
            mode,
            virality_hooks: hooks,
            shareHook: result.scores.shareHook || modeConfig?.shareHook
        }
    };
}

export default {
    ERROR_MESSAGES,
    SCAN_LIMITS,
    OUTPUT_LENGTHS,
    MODEL_ROUTING,
    MODE_CONFIGS,
    ANALYSIS_PARAMS,
    VIRALITY_HOOKS,
    SECURITY_FORTRESS_PROMPT,
    CORE_LOGIC_RULES,
    OUTPUT_FORMAT,
    BACKEND_PROCESS,
    CELEBS,
    buildSystemPrompt,
    getViralityHooks,
    enhanceWithViralityHooks
};
