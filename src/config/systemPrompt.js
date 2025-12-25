/**
 * FITRATE.APP AI SYSTEM PROMPT - LEGENDARY EDITION
 * Token-optimized with Verdict Variant System for maximum variety.
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
    pro: { model: 'gpt-4o', modes: ['nice', 'roast', 'honest', 'savage', 'rizz', 'celeb', 'aura', 'chaos'] }
};

// === MODE CONFIGURATIONS ===
export const MODE_CONFIGS = {
    nice: {
        name: 'Nice', tier: 'free', scoreRange: [0, 100], emojis: '😌✨💫',
        tone: 'Supportive, encouraging, still honest',
        goal: 'Score honestly but frame feedback positively. Find the good in any fit while being truthful.',
        shareHook: 'You\'re perfection! Share #FitRateNice',
        challenge: 'Challenge friends to match this glow! 💫'
    },
    roast: {
        name: 'Roast', tier: 'free', scoreRange: [0, 100], emojis: '🔥🤡💀',
        tone: 'Playful, teasing, internet-native',
        goal: 'Humor > harshness. Must make people laugh. Score honestly but roast the weaknesses.',
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
        name: 'Savage', tier: 'pro', scoreRange: [0, 100], emojis: '😈💀🩸',
        tone: 'Brutally concise, meme-heavy, no emotional padding',
        goal: 'One punch per line. Elite destruction.',
        shareHook: 'Survived perfection? Prove it — #FitRateSavage!',
        challenge: 'Dare friends (and refer for extras)! 💀'
    },
    // === NEW PRO MODES ===
    rizz: {
        name: 'Rizz', tier: 'pro', scoreRange: [0, 100], emojis: '😏💋🌡️',
        tone: 'Dating-focused, flirty, social game analysis',
        goal: 'Rate attraction potential and dating app success. Be playful.',
        shareHook: "What's your rizz score? 😏 #FitRateRizz",
        challenge: 'Challenge your crush! 💋'
    },
    celeb: {
        name: 'Celebrity', tier: 'pro', scoreRange: [0, 100], emojis: '🎭👑⭐',
        tone: 'Impersonating a celebrity fashion judge with their exact voice',
        goal: 'BE the celebrity. Rate as they would. Match their personality exactly.',
        shareHook: 'What would Anna Wintour say? 👑 #FitRateCeleb',
        challenge: 'Get judged by a legend! 🎭'
    },
    aura: {
        name: 'Aura', tier: 'pro', scoreRange: [0, 100], emojis: '🔮✨🌈',
        tone: 'Mystical, energy-reader, spiritual fashion analysis',
        goal: 'Read their vibe, aura color, and energy. Be mystical but fun.',
        shareHook: "What's your aura? 🔮 #FitRateAura",
        challenge: 'Compare auras with friends! ✨'
    },
    chaos: {
        name: 'Chaos', tier: 'pro', scoreRange: [0, 100], emojis: '🎪🤡🌀',
        tone: 'Absurdist, unpredictable, surreal humor, unhinged',
        goal: 'Be UNHINGED. Wild comparisons. Chaotic energy. Surprise them.',
        shareHook: 'The AI went feral 🎪 #FitRateChaos',
        challenge: 'Dare friends to survive chaos! 🌀'
    }
};

// === VIRALITY HOOKS ===
export const VIRALITY_HOOKS = {
    nice: ["You're perfection! Share #FitRateNice 💫", 'Challenge friends to match this glow!', 'Tag your style twin 👯‍♀️'],
    roast: ['Roasted to perfection? Tag squad — #FitRateRoast! 🔥', 'Start a chain for referral rewards!', 'Dare friends to survive this!'],
    honest: ['Truth unlocked — share your journey #FitRateHonest 💡', 'Pro perfection pays off!', 'Real feedback, real growth 💪'],
    savage: ['Survived perfection? Prove it — #FitRateSavage! 💀', 'Dare friends (and refer for extras)!', 'Only the brave share this'],
    rizz: ["What's YOUR rizz score? 😏 #FitRateRizz", 'Challenge your crush!', 'Dating app audit complete 💋'],
    celeb: ['Judged by a legend 👑 #FitRateCeleb', 'What would YOUR celeb say?', 'Celebrity verdict is in 🎭'],
    aura: ['Your aura has been read 🔮 #FitRateAura', 'Compare vibes with friends!', 'Main character or NPC? ✨'],
    chaos: ['The AI went FERAL 🎪 #FitRateChaos', 'Dare friends to try chaos mode!', 'Unhinged rating unlocked 🌀']
};

// === CELEB LISTS (20+ per gender for variety) ===
export const CELEBS = {
    male: [
        // Actors
        'Timothée Chalamet', 'Pedro Pascal', 'Jacob Elordi', 'Austin Butler', 'Barry Keoghan', 'Glen Powell',
        // Musicians
        'Bad Bunny', 'A$AP Rocky', 'Tyler the Creator', 'Central Cee', 'Jack Harlow', 'Pharrell', 'Frank Ocean',
        // K-pop
        'BTS Jungkook', 'BTS V', 'Stray Kids Felix', 'NCT Taeyong', 'G-Dragon',
        // Athletes & Influencers
        'LeBron James', 'Lewis Hamilton', 'Odell Beckham Jr', 'Patrick Mahomes'
    ],
    female: [
        // Actors
        'Zendaya', 'Jenna Ortega', 'Sydney Sweeney', 'Florence Pugh', 'Anya Taylor-Joy', 'Margot Robbie',
        // Musicians
        'Ice Spice', 'Sabrina Carpenter', 'Doja Cat', 'Dua Lipa', 'Cardi B', 'SZA', 'Billie Eilish',
        // K-pop
        'Jennie', 'Lisa', 'Rosé', 'IU', 'Jisoo',
        // Models & Influencers
        'Hailey Bieber', 'Kendall Jenner', 'Bella Hadid', 'Emily Ratajkowski'
    ]
};

// ============================================
// LEGENDARY VERDICT VARIANT SYSTEM
// Prevents repetition by rotating verdict styles
// ============================================

// 12 verdict styles for maximum variety (avoid repetition!)
const VERDICT_STYLES = [
    {
        id: 'statement',
        instruction: 'Punchy statement (e.g., "Main character material")',
        examples: ['Main character material', 'This fit chose violence', 'Effortlessly dangerous']
    },
    {
        id: 'comparison',
        instruction: 'Comparison format (e.g., "GQ meets coffee run")',
        examples: ['GQ meets coffee run', 'Met Gala after dark', 'Pinterest board escaped']
    },
    {
        id: 'question',
        instruction: 'Question hook (e.g., "Why aren\'t you famous?")',
        examples: ["Why aren't you famous?", 'Did anyone survive this?', 'Are you even real?']
    },
    {
        id: 'action',
        instruction: 'Action phrase (e.g., "Drop the @ immediately")',
        examples: ['Drop the @ immediately', 'Post this before I do', 'Screenshot and send']
    },
    {
        id: 'internet',
        instruction: 'Internet-speak (e.g., "NPC energy detected")',
        examples: ['NPC energy detected', 'The fit is fitting', 'Ate and left no crumbs']
    },
    {
        id: 'reaction',
        instruction: 'Reaction format (e.g., "Screaming crying throwing up")',
        examples: ['Obsessed is an understatement', 'The audacity of this fit', 'This is a flex']
    },
    // NEW STYLES for more variety:
    {
        id: 'verdict',
        instruction: 'Court verdict (e.g., "Guilty of looking too good")',
        examples: ['Guilty of effortless drip', 'Case dismissed - you ate', 'The jury is obsessed']
    },
    {
        id: 'movie',
        instruction: 'Movie review (e.g., "Oscar-worthy performance")',
        examples: ['Oscar-worthy fits only', 'Critics agree: a masterpiece', 'Box office material']
    },
    {
        id: 'sports',
        instruction: 'Sports commentary (e.g., "AND THE CROWD GOES WILD")',
        examples: ['Absolute knockout', 'Game winner', 'Victory lap energy']
    },
    {
        id: 'dramatic',
        instruction: 'Dramatic declaration (e.g., "Fashion will never recover")',
        examples: ['Fashion will never recover', 'The timeline is healing', 'History was made']
    },
    {
        id: 'lowkey',
        instruction: 'Understated flex (e.g., "Quietly devastating")',
        examples: ['Quietly devastating', 'Lowkey lethal', 'Subtle excellence']
    },
    {
        id: 'roast_specific',
        instruction: 'Specific roast (e.g., "The outfit equivalent of a rainy Monday")',
        examples: ['Outfit said sorry not sorry', 'This fit has side quest energy', 'Your closet had other plans']
    }
];

// Score-tier emoji rules for verdict
const VERDICT_EMOJI_RULES = {
    legendary: { emojis: ['👑', '💎', '🔥'], position: 'end', required: true },
    fire: { emojis: ['🔥', '✨', '💅'], position: 'end', required: true },
    great: { emojis: ['✨', '🎯', '💫'], position: 'end', required: false },
    good: { emojis: ['👀', '🤔', '📈'], position: 'end', required: false },
    mid: { emojis: ['😬', '💀', '📉'], position: 'end', required: true },
    low: { emojis: ['☠️', '🪦', '💀'], position: 'end', required: true }
};

/**
 * Get random verdict style for variety
 */
function getRandomVerdictStyle() {
    const index = Math.floor(Math.random() * VERDICT_STYLES.length);
    return VERDICT_STYLES[index];
}

/**
 * Get score tier for emoji rules
 */
function getScoreTier(score) {
    if (score >= 95) return 'legendary';
    if (score >= 85) return 'fire';
    if (score >= 75) return 'great';
    if (score >= 60) return 'good';
    if (score >= 40) return 'mid';
    return 'low';
}

const OUTPUT_FORMAT = {
    free: `{
  "isValidOutfit": boolean,
  "contentFlagged": boolean,
  "overall": <0-100>,
  "color": <0-100>,
  "fit": <0-100>,
  "style": <0-100>,
  "aesthetic": "<style aesthetic name>",
  "verdict": "<5-9 words, screenshot-ready headline>",
  "line": "<single punchy quote about specific detail>",
  "tagline": "<2-5 word Instagram stamp>",
  "celebMatch": "<trending 2024-2025 celeb>",
  "percentile": <0-99>,
  "mode": "<nice|roast>",
  "themeScore": <0-100, only in event mode>,
  "themeCompliant": <boolean, only in event mode>,
  "themeVerdict": "<1 sentence on theme execution, only in event mode>",
  "error": string (only if isValidOutfit is false OR contentFlagged is true)
}`,
    pro: `{
  "isValidOutfit": boolean,
  "contentFlagged": boolean,
  "overall": <0-100>,
  "color": <0-100>,
  "fit": <0-100>,
  "style": <0-100>,
  "aesthetic": "<style aesthetic name>",
  "verdict": "<5-9 words, screenshot-ready headline>",
  "line": "<single punchy quote about specific detail>",
  "tagline": "<2-5 word stamp>",
  "celebMatch": "<trending 2024-2025 celeb>",
  "identityReflection": "<What this fit says about them - 1-2 sentences>",
  "socialPerception": "<How others perceive them - 1-2 sentences>",
  "itemRoasts": { "top": "<roast>", "bottom": "<roast>", "shoes": "<roast>" },
  "proTip": "<One actionable style upgrade>",
  "savageLevel": <1-10, only for savage mode>,
  "percentile": <0-99>,
  "mode": "<nice|roast|honest|savage|rizz|celeb|aura|chaos>",
  // === RIZZ MODE FIELDS (only for rizz mode) ===
  "rizzType": "<Unspoken Rizz | W Rizz | L Rizz | Subtle Rizz>",
  "pullProbability": <0-100>,
  "pickupLine": "<outfit-appropriate pickup line>",
  "datingApps": { "tinder": <1-10>, "hinge": <1-10>, "bumble": <1-10> },
  // === CELEB MODE FIELDS (only for celeb mode) ===
  "celebrityJudge": "<Anna Wintour | Kanye | Rihanna | Karl Lagerfeld | Zendaya>",
  "celebQuote": "<in-character quote about the outfit>",
  "wouldTheyWear": <boolean>,
  // === AURA MODE FIELDS (only for aura mode) ===
  "auraColor": "<Gold | Purple | Red | Blue | Green | Silver | Rainbow | Black>",
  "energyLevel": <0-100>,
  "vibeAssessment": "<Main Character | NPC | Side Quest | Final Boss | Protagonist>",
  "spiritualRoast": "<mystical fashion critique, 1 sentence>",
  // === CHAOS MODE FIELDS (only for chaos mode) ===
  "chaosLevel": <1-10>,
  "absurdComparison": "<wild surreal comparison>",
  "alternateReality": "<what this outfit is in a parallel universe>",
  // === EVENT FIELDS ===
  "themeScore": <0-100, only in event mode>,
  "themeCompliant": <boolean, only in event mode>,
  "themeVerdict": "<1 sentence on theme execution, only in event mode>",
  "error": string (only if isValidOutfit is false OR contentFlagged is true)
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

JUDGING (Theme is MOST important - 50% of score!):
- Theme alignment = 50% of overall score
- On-theme + stylish = can hit 100
- Off-theme but stylish = cap at ~55 (theme matters most!)
- On-theme but poor execution = cap at ~65
${isUglyTheme ? '- UGLY SWEATER: "Uglier" is better. Reward chaos, clashing colors, 3D elements, ironic bad taste.' : ''}

REQUIRED OUTPUT (add these fields):
- "themeScore": 0-100 (how well they nailed the theme)
- "themeCompliant": boolean (did they attempt the theme?)
- "themeVerdict": "<1 sentence on theme execution>"

BANNED: Never comment on body/face/identity.
`;
}

/**
 * Build token-optimized system prompt with Verdict Variant System
 * Target: ~450 tokens (includes variety instructions)
 */
export function buildSystemPrompt(tier, mode, securityContext = {}, eventContext = null) {
    const isPro = tier === 'pro';
    const outputFormat = isPro ? OUTPUT_FORMAT.pro : OUTPUT_FORMAT.free;
    const eventBlock = buildEventModePrompt(eventContext);

    // LEGENDARY: Random verdict style for variety
    const verdictStyle = getRandomVerdictStyle();

    // Mode-specific config (single line each)
    const modeInstructions = {
        nice: '😌 Supportive+honest. Emphasize upside, soften criticism. Score: 0-100 (tend toward positivity but be truthful)',
        roast: '🔥 Playful, teasing, internet-humor. Make them laugh. Score: 0-100 (roast hard when deserved, celebrate when fire)',
        honest: '🧠 Direct, no cushioning. Trusted friend energy. Score: 0-100',
        savage: '😈 Brutal, meme-heavy, one punch per line. Score: 0-100 (no mercy mode, but score honestly)',
        rizz: '😏 DATING GURU mode. Rate attraction/rizz potential. Fill: rizzType, pullProbability, pickupLine, datingApps. Score: 0-100',
        celeb: '🎭 BE A CELEBRITY JUDGE. Pick ONE: Anna Wintour (ice queen), Kanye (chaotic genius), Rihanna (bold queen), Zendaya (graceful). Fill: celebrityJudge, celebQuote (in their voice), wouldTheyWear. Score: 0-100',
        aura: '🔮 MYSTICAL VIBE READER. Read their energy/aura. Fill: auraColor, energyLevel, vibeAssessment (Main Character/NPC/Side Quest/Final Boss), spiritualRoast. Score: 0-100',
        chaos: '🎪 UNHINGED MODE. Be CHAOTIC. Wild tangents, absurd logic, surreal comparisons. Fill: chaosLevel, absurdComparison ("This outfit has 3am gas station energy"), alternateReality. Score: 0-100'
    };

    // Mode-specific LINE instructions (single line now)
    const lineInstructions = {
        nice: 'A specific compliment about a visible outfit detail',
        roast: 'A playful roast about a specific visible piece',
        honest: 'A clinical observation about fit or color coordination',
        savage: 'A brutal one-liner that destroys (no mercy)',
        rizz: 'A flirty observation about their style appeal',
        celeb: 'The celebrity judge\'s first impression (in character)',
        aura: 'A mystical energy reading about their vibe',
        chaos: 'An unhinged observation (be weird and surprising)'
    };

    return `FitRate AI — Outfit Scorecard Generator
${eventBlock ? eventBlock + '\n' : ''}${isPro ? 'PRO: High-fidelity analysis. Fill identityReflection + socialPerception.' : 'FREE: Punchy, viral-first.'}

MODE: ${mode.toUpperCase()} — ${modeInstructions[mode]}

RULES:
- Score: XX.X (one decimal, not .0/.5). Must match mode tone.
- color/fit/style subscores roughly average to overall (±10 allowed)
- Include one hyper-specific visible detail in your line
- celebMatch: any 2024-2025 trending celeb (be specific!)

🎯 VERDICT STYLE [${verdictStyle.id.toUpperCase()}]: ${verdictStyle.instruction}
Examples: "${verdictStyle.examples.join('", "')}"
⚠️ NEVER use generic verdicts. Each must be unique and specific to THIS outfit.

🏷️ EMOJI RULES:
- 95+: End with 👑 or 💎 or 🔥
- 85+: End with 🔥 or ✨ or 💅  
- 60-84: Optional emoji
- <60: End with 💀 or ☠️ or 😬

📝 LINE: ${lineInstructions[mode]}

🚫 BANNED WORDS: "mid", "giving vibes", "slay", "understood the assignment", "it's giving", "serving", body comments, brand guessing, "as an AI"

VALIDATION:
✅ Clothed outfit visible → RATE IT (set contentFlagged: false)
❌ Zero clothing → REJECT (set isValidOutfit: false)
🚫 NUDITY/INAPPROPRIATE → FLAG IT (set contentFlagged: true, error: "This image cannot be rated. Please upload a photo of your outfit.")

CONTENT SAFETY: If you detect nudity, explicit content, underwear-only, swimwear that's too revealing, or any inappropriate content, you MUST set contentFlagged: true and provide a safe error message. DO NOT rate inappropriate images.

OUTPUT (JSON only):
${outputFormat}

INVALID: {"isValidOutfit": false, "error": "Need to see your outfit! Try a photo showing your clothes 📸"}`.trim();
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

// ============================================
// FASHION SHOW GROUP CONTEXT
// Group-aware AI responses for Fashion Show mode
// ============================================

/**
 * Build Fashion Show context block for group-aware responses
 * @param {Object} showContext - Fashion Show context
 * @returns {string} Prompt block for Fashion Show
 */
export function buildFashionShowPrompt(showContext) {
    if (!showContext) return '';

    const { name, vibe, familySafe, currentRank, totalParticipants } = showContext;

    // Family Safe enforcement
    const familySafeRules = familySafe ? `
🔒 FAMILY SAFE MODE ACTIVE — THIS IS CRITICAL:
- NO profanity, cursing, or adult language
- NO body/weight/appearance insults
- NO sexual references or innuendo
- ONLY wholesome, fun humor (think Disney Channel)
- Keep it school-appropriate and parent-friendly
` : '';

    // Group-aware reactions based on rank
    let groupLine = '';
    if (currentRank && totalParticipants) {
        if (currentRank === 1) {
            groupLine = '👑 They just took #1! Make them feel like a champion.';
        } else if (currentRank <= 3) {
            groupLine = `🔥 They're #${currentRank} of ${totalParticipants}. Acknowledge the heat.`;
        } else if (currentRank === totalParticipants) {
            groupLine = `📈 They're last place... for now. Encourage a comeback arc.`;
        } else {
            groupLine = `👀 They're #${currentRank} of ${totalParticipants}. Call out the competition.`;
        }
    }

    return `
🎭 FASHION SHOW MODE: "${name}"
VIBE: ${vibe?.toUpperCase() || 'NICE'}
${familySafeRules}
${groupLine ? `\nGROUP CONTEXT: ${groupLine}` : ''}

FASHION SHOW SPECIAL INSTRUCTIONS:
- Add a "groupLine" field to your response: a fun, competitive comment about their rank
- Examples: "The runway just got shook 👑", "Only 2 points behind the lead 👀", "Main character energy detected"
- Make it feel like a COMPETITION — acknowledge other participants exist
- The verdict should work great as a group chat screenshot
`;
}

/**
 * Map Fashion Show vibe to FitRate mode
 */
export function vibeToMode(vibe) {
    const mapping = {
        'nice': 'nice',
        'roast': 'roast',
        'savage': 'savage',
        'chaos': 'chaos'
    };
    return mapping[vibe] || 'nice';
}

export default {
    ERROR_MESSAGES,
    SCAN_LIMITS,
    OUTPUT_LENGTHS,
    MODEL_ROUTING,
    MODE_CONFIGS,
    VIRALITY_HOOKS,
    CELEBS,
    VERDICT_STYLES,
    VERDICT_EMOJI_RULES,
    buildSystemPrompt,
    getViralityHooks,
    enhanceWithViralityHooks,
    getRandomVerdictStyle,
    getScoreTier,
    buildFashionShowPrompt,
    vibeToMode
};
