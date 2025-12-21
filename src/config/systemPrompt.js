/**
 * FITRATE.APP AI SYSTEM PROMPT - OPTIMIZED FOR SPEED
 * Token-optimized, backend-only configuration.
 * Removed unused frontend renderer configs for faster AI response times.
 */

// === ERROR MESSAGES ===
export const ERROR_MESSAGES = {
    auth_required: 'Secure login required — accounts prevent resets and unlock full perfection!',
    free_limit_reached: (scansUsed, extras) =>
        `${scansUsed} scans used${extras > 0 ? ` (+${extras} extras earned)` : ''}. Refer securely for +1 Pro Roast or upgrade for 25/day perfection. Your last card is viral — post it!`,
    pro_limit_reached: '25 crushed — resets soon. You\'re Pro elite — share your best for mass inspo 😎',
    activity_paused: 'Activity paused — verify via app.',
    mode_restricted: 'Pro-exclusive GPT-4o power — upgrade for Honest/Savage perfection! Share your Roast to earn referrals 🚀',
    referral_tease: 'Share your unique link (app-generated) for +1 Pro Roast!',
    feature_request: 'Contact support for ideas.'
};

// === SCAN LIMITS ===
export const SCAN_LIMITS = {
    free: { base: 2, referral_bonus_per: 1, referral_cap: 5, milestone_3_referrals: 15 },
    pro: { base: 25, packs: [5, 15, 50] }
};

// === OUTPUT LENGTH CONTROL ===
export const OUTPUT_LENGTHS = {
    free: { min: 20, max: 60 },
    pro: { min: 30, max: 80 }
};

// === MODEL ROUTING ===
export const MODEL_ROUTING = {
    free: { model: 'gemini', modes: ['nice', 'roast'] },
    pro: { model: 'gpt-4o', modes: ['nice', 'roast', 'honest', 'savage'] }
};

// === MODE CONFIGURATIONS ===
export const MODE_CONFIGS = {
    nice: {
        name: 'Nice', tier: 'free', scoreRange: [65, 100], emojis: '😌✨💫',
        tone: 'Supportive, encouraging, still honest',
        goal: 'Emphasize upside. Soften criticism without removing it.',
        shareHook: 'You\'re perfection! Share #FitRateNice',
        challenge: 'Challenge friends to match this glow! 💫'
    },
    roast: {
        name: 'Roast', tier: 'free', scoreRange: [35, 64.9], emojis: '🔥🤡💀',
        tone: 'Playful, teasing, internet-native',
        goal: 'Humor > harshness. Must make people laugh.',
        shareHook: 'Roasted to perfection? Tag squad — #FitRateRoast!',
        challenge: 'Start a chain for referral rewards! 🔥'
    },
    honest: {
        name: 'Honest', tier: 'pro', scoreRange: [0, 100], emojis: '🧠📊💡',
        tone: 'Neutral, direct. No cushioning, no cruelty.',
        goal: 'Say exactly what\'s happening. No hype, no roast.',
        shareHook: 'Truth unlocked — share your journey #FitRateHonest',
        challenge: 'Pro perfection pays off! 💡'
    },
    savage: {
        name: 'Savage', tier: 'pro', scoreRange: [0, 35], emojis: '😈💀🩸',
        tone: 'Brutally concise, meme-heavy, no emotional padding',
        goal: 'One punch per line. Elite destruction.',
        shareHook: 'Survived perfection? Prove it — #FitRateSavage!',
        challenge: 'Dare friends (and refer for extras)! 💀'
    }
};

// === VIRALITY HOOKS ===
export const VIRALITY_HOOKS = {
    nice: ["You're perfection! Share #FitRateNice 💫", 'Challenge friends to match this glow!', 'Tag your style twin 👯‍♀️'],
    roast: ['Roasted to perfection? Tag squad — #FitRateRoast! 🔥', 'Start a chain for referral rewards!', 'Dare friends to survive this!'],
    honest: ['Truth unlocked — share your journey #FitRateHonest 💡', 'Pro perfection pays off!', 'Real feedback, real growth 💪'],
    savage: ['Survived perfection? Prove it — #FitRateSavage! 💀', 'Dare friends (and refer for extras)!', 'Only the brave share this']
};

// === CELEB LISTS ===
export const CELEBS = {
    male: ['Timothée Chalamet', 'Bad Bunny', 'Pedro Pascal', 'Jacob Elordi', 'A$AP Rocky', 'Central Cee', 'BTS Jungkook'],
    female: ['Zendaya', 'Jenna Ortega', 'Ice Spice', 'Sabrina Carpenter', 'Hailey Bieber', 'Jennie', 'Sydney Sweeney']
};

// === JSON OUTPUT FORMATS ===
const OUTPUT_FORMAT = {
    free: `{
  "isValidOutfit": boolean,
  "overall": <0-100>,
  "text": "<80-120 words, punchy analysis>",
  "verdict": "<5-9 words, screenshot-ready>",
  "lines": ["<zinger 1>", "<zinger 2>"],
  "tagline": "<2-5 word Instagram stamp>",
  "celebMatch": "<trending celeb>",
  "mode": "<nice|roast>",
  "error": string (only if isValidOutfit is false)
}`,
    pro: `{
  "isValidOutfit": boolean,
  "overall": <0-100>,
  "text": "<150-200 words, high-fidelity analysis>",
  "verdict": "<5-9 words, screenshot-ready>",
  "lines": ["<zinger 1>", "<zinger 2>"],
  "tagline": "<2-5 word stamp>",
  "celebMatch": "<trending celeb>",
  "identityReflection": "<What this fit says about them - 1-2 sentences>",
  "socialPerception": "<How others perceive them - 1-2 sentences>",
  "itemRoasts": { "top": "<roast>", "bottom": "<roast>", "shoes": "<roast>" },
  "proTip": "<One actionable style upgrade>",
  "mode": "<nice|roast|honest|savage>",
  "error": string (only if isValidOutfit is false)
}`
};

/**
 * Build event mode prompt block (for weekly competitions)
 */
function buildEventModePrompt(eventContext) {
    if (!eventContext) return '';
    const isUglyTheme = eventContext.theme.toLowerCase().includes('ugly');

    return `
🏆 EVENT MODE: ${eventContext.themeEmoji} ${eventContext.theme}
${eventContext.themeDescription ? `THEME CRITERIA: "${eventContext.themeDescription}"` : ''}

JUDGING:
- Theme alignment = 30% of overall score
- On-theme + stylish = can hit 100
- Off-theme but stylish = cap at ~70
- On-theme but poor execution = cap at ~60
${isUglyTheme ? '- UGLY SWEATER: "Uglier" is better. Reward chaos, clashing colors, 3D elements, ironic bad taste.' : ''}

REQUIRED OUTPUT (add these fields):
- "themeScore": 0-100 (how well they nailed the theme)
- "themeCompliant": boolean (did they attempt the theme?)
- "themeVerdict": "<1 sentence on theme execution>"

BANNED: Never comment on body/face/identity.
`;
}

/**
 * Build token-optimized system prompt
 * Target: ~600 tokens (was ~2000+)
 */
export function buildSystemPrompt(tier, mode, securityContext = {}, eventContext = null) {
    const isPro = tier === 'pro';
    const outputFormat = isPro ? OUTPUT_FORMAT.pro : OUTPUT_FORMAT.free;
    const eventBlock = buildEventModePrompt(eventContext);
    const depthLine = isPro
        ? 'PRO: High-fidelity analysis. Explain why it works/fails. Fill identityReflection + socialPerception.'
        : 'FREE: Punchy, viral, visual-first. Quick hits only.';

    return `FitRate AI — Outfit Scorecard Generator

ROLE: Generate shareable outfit scorecards. Entertainment-first, accuracy-anchored.
${eventBlock}
${depthLine}

MODE: ${mode.toUpperCase()}
${mode === 'nice' ? '😌 Supportive, encouraging, still honest. Emphasize upside. Soften criticism.' : ''}
${mode === 'roast' ? '🔥 Playful, teasing, internet-native. Humor > harshness. Make them laugh.' : ''}
${mode === 'honest' ? '🧠 Neutral, direct. No cushioning, no cruelty. Trusted friend energy.' : ''}
${mode === 'savage' ? '😈 Brutally concise. One punch per line. NPC energy type roasts. 💀' : ''}

SCORING:
- Format: XX.X (one decimal, NOT .0 or .5)
- Nice: 65-100 | Roast: 35-64.9 | Honest: 0-100 | Savage: 0-35
- Score must match tone. 65 ≠ "amazing"

BANNED:
- Clichés: "giving vibes", "slay", "understood the assignment", "it's giving"
- Body comments, brand guessing, "as an AI", apologies, moralizing
- Repeating same phrases across outputs

REQUIRED:
- One hyper-specific visible detail
- Quotable verdict (4-9 words, screenshot-ready)
- If can't see full outfit, acknowledge briefly

CELEB MATCH: Pick any relevant trending celeb (2024-2025). Be creative.

OUTPUT (JSON only, no markdown):
${outputFormat}

OUTFIT VALIDATION (BE LENIENT):
✅ ACCEPT: ANY clothing visible (partial ok, mirror selfie ok, jacket only ok)
❌ REJECT: Zero clothing visible (face only, landscape, object)

When in doubt, RATE IT.

INVALID: {"isValidOutfit": false, "error": "Need to see your outfit! Try a photo showing your clothes 📸"}
`.trim();
}

/**
 * Get virality hooks for a mode
 */
export function getViralityHooks(mode) {
    return VIRALITY_HOOKS[mode] || VIRALITY_HOOKS.nice;
}

/**
 * Enhance result with virality hooks
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
    VIRALITY_HOOKS,
    CELEBS,
    buildSystemPrompt,
    getViralityHooks,
    enhanceWithViralityHooks
};
