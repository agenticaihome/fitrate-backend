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
    free: { min: 20, max: 60 },   // 2-3 sentences max (punchy)
    pro: { min: 30, max: 80 }     // Slightly more detail but still concise
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

// === MODE CONFIGURATIONS (10/10 PERFECTION - EXACT SPEC) ===
export const MODE_CONFIGS = {
    nice: {
        name: 'Nice',
        tier: 'free',
        scoreRange: [65, 100],
        emojis: '😌✨💫',
        tone: 'Supportive, encouraging, still honest',
        goal: 'Emphasize upside. Soften criticism without removing it.',
        shareHook: 'You\'re perfection! Share #FitRateNice',
        challenge: 'Challenge friends to match this glow! 💫'
    },
    roast: {
        name: 'Roast',
        tier: 'free',
        scoreRange: [35, 64.9],
        emojis: '🔥🤡💀',
        tone: 'Playful, teasing, internet-native',
        goal: 'Humor > harshness. Must make people laugh.',
        shareHook: 'Roasted to perfection? Tag squad — #FitRateRoast!',
        challenge: 'Start a chain for referral rewards! 🔥'
    },
    honest: {
        name: 'Honest',
        tier: 'pro',
        scoreRange: [0, 100],
        emojis: '🧠📊💡',
        tone: 'Neutral, direct. No cushioning, no cruelty.',
        goal: 'Say exactly what\'s happening. No hype, no roast.',
        shareHook: 'Truth unlocked — share your journey #FitRateHonest',
        challenge: 'Pro perfection pays off! 💡'
    },
    savage: {
        name: 'Savage',
        tier: 'pro',
        scoreRange: [0, 35],
        emojis: '😈💀🩸',
        tone: 'Brutally concise, meme-heavy, no emotional padding',
        goal: 'One punch per line. Elite destruction.',
        shareHook: 'Survived perfection? Prove it — #FitRateSavage!',
        challenge: 'Dare friends (and refer for extras)! 💀'
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

// === VIRALITY HOOKS (EXACT SPEC - 10/10 VIRAL MAGNETS) ===
export const VIRALITY_HOOKS = {
    nice: [
        "You're perfection! Share #FitRateNice 💫",
        'Challenge friends to match this glow!',
        'Tag your style twin 👯‍♀️',
        'Main character energy unlocked ✨',
        'Join thousands rating their fits daily!'
    ],
    roast: [
        'Roasted to perfection? Tag squad — #FitRateRoast! 🔥',
        'Start a chain for referral rewards!',
        'Dare friends to survive this!',
        'Post this and watch your DMs explode 😂',
        'Join the roast community — thousands getting burned daily!'
    ],
    honest: [
        'Truth unlocked — share your journey #FitRateHonest 💡',
        'Pro perfection pays off!',
        'Real feedback, real growth 💪',
        'Share for +1 Pro Roast — help friends level up!',
        'Real feedback gets real results'
    ],
    savage: [
        'Survived perfection? Prove it — #FitRateSavage! 💀',
        'Dare friends (and refer for extras)!',
        'Only the brave share this',
        'Only legends share this — recruit the brave!',
        'Elite savage squad — only the brave survive!'
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

// ============================================================================
// FRONTEND RESPONSE RENDERER: VIRALITY & UX PERFECTION ENGINE
// ============================================================================
// Transform backend AI responses into 10/10 visual/shareable masterpieces.
// Render analyses as addictive, screenshot/TikTok gold while maximizing
// shares, retention, and Pro upsells.
// OCD-verify 5x: "Is this visually stunning? Instantly shareable? Driving habits/conversions?"
// ============================================================================

// === FRONTEND RENDERER CONFIGURATION ===
export const FRONTEND_RENDERER_CONFIG = {
    // Prime directive for frontend rendering
    primeDirective: {
        flawlessVisualUX: 'Make every result feel elite — vivid descriptions, emoji-rich text, bold elements for canvas cards',
        viralityMaximization: 'Optimize for screenshots/Stories: quotable lines, challenges, FOMO, direct nudges',
        retentionHabitLoops: 'Highlight streaks, rematches, badges — drive daily engagement',
        proConversionObsession: 'Dynamic overlays based on score — subtle Pro banners on cards',
        massAdoptionMindset: 'Target 50%+ share rate — encourage community building'
    },

    // Rendering state machine
    states: {
        analyzing: {
            name: 'analyzing',
            duration: 2000, // ms
            animation: 'pulse-glow',
            text: 'Analyzing your style...',
            showProgress: true
        },
        result: {
            name: 'result',
            animation: 'score-count-up',
            countUpDuration: 1500, // ms
            showConfetti: true, // For 95+ scores
            triggerSharePrompt: true
        },
        sharePreview: {
            name: 'share-preview',
            showCanvas: true,
            enableOneTopShare: true,
            showDownloadOption: true
        }
    },

    // Text formatting rules
    textFormatting: {
        emojiDensity: 'high', // emoji-rich for engagement
        boldElements: ['rating', 'verdict', 'tagline'],
        highlightColors: {
            nice: '#FFD700', // Gold
            roast: '#FF4500', // Orange-red
            honest: '#4169E1', // Royal blue
            savage: '#8B0000' // Dark red
        }
    }
};

// === SHARE CARD SPECIFICATIONS (Canvas Generation) ===
export const SHARE_CARD_SPECS = {
    // Story format (Instagram/TikTok Stories)
    story: {
        width: 1080,
        height: 1920,
        aspectRatio: '9:16',
        layout: {
            userPhotoPosition: { x: 'center', y: '35%', maxHeight: '45%' },
            scoreCirclePosition: { x: 'center', y: '70%' },
            brandingSealPosition: { x: 'center', y: '90%' },
            hashtagsPosition: { x: 'center', y: '95%' }
        }
    },
    // Feed format (Instagram/Twitter/Facebook)
    feed: {
        width: 1080,
        height: 1080,
        aspectRatio: '1:1',
        layout: {
            userPhotoPosition: { x: 'center', y: '40%', maxHeight: '55%' },
            scoreCirclePosition: { x: 'center', y: '80%' },
            brandingSealPosition: { x: 'right', y: '95%' },
            hashtagsPosition: { x: 'left', y: '95%' }
        }
    },
    // Common canvas layers (render order)
    layers: [
        { name: 'base', type: 'solid', color: '#000000' },
        { name: 'userPhoto', type: 'image', filter: 'none' },
        { name: 'glassmorphism', type: 'overlay', blur: 10, opacity: 0.3 },
        { name: 'scoreCircle', type: 'component', glow: true },
        { name: 'textOverlay', type: 'text', font: 'Inter Bold' },
        { name: 'brandingSeal', type: 'logo', text: 'fitrate.app' },
        { name: 'badgeOverlay', type: 'conditional', condition: 'score >= 95' },
        { name: 'proBanner', type: 'conditional', condition: 'isPro' }
    ],
    // Embedded elements
    embed: {
        referralUrl: 'fitrate.app?ref={userId}',
        hashtags: {
            nice: ['#FitRateNice', '#StyleCheck', '#OOTD', '#FashionAI'],
            roast: ['#FitRateRoast', '#GotRoasted', '#FashionRoast', '#StyleFail'],
            honest: ['#FitRateHonest', '#RealFeedback', '#StyleTruth', '#GlowUp'],
            savage: ['#FitRateSavage', '#SurvivedSavage', '#BrutalTruth', '#FitDestroyed']
        },
        challengeText: {
            nice: 'Think you can match this glow? 💫',
            roast: 'Dare your friends to survive 🔥',
            honest: 'Ready for real feedback? 💡',
            savage: 'Only the brave get rated 💀'
        }
    }
};

// === RATING DISPLAY CONFIGURATION ===
export const RATING_DISPLAY_CONFIG = {
    // Score circle styling
    scoreCircle: {
        size: 180,
        strokeWidth: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        fontFamily: 'Inter',
        fontWeight: 900,
        fontSize: 64,
        format: 'XX.X',
        suffix: '/100'
    },
    // Score range colors (gradient)
    scoreColors: {
        elite: { range: [95, 100], color: '#FFD700', glow: '#FFD700', pulse: true },
        excellent: { range: [85, 94], color: '#32CD32', glow: '#32CD32', pulse: false },
        good: { range: [70, 84], color: '#4169E1', glow: '#4169E1', pulse: false },
        average: { range: [50, 69], color: '#FFA500', glow: '#FFA500', pulse: false },
        poor: { range: [25, 49], color: '#FF6347', glow: '#FF6347', pulse: false },
        brutal: { range: [0, 24], color: '#8B0000', glow: '#8B0000', pulse: false }
    },
    // Animation configuration
    animations: {
        countUp: {
            duration: 1500,
            easing: 'easeOutExpo',
            startDelay: 500
        },
        glow: {
            duration: 2000,
            iterations: 'infinite',
            intensity: 20
        },
        pulse: {
            duration: 1000,
            scale: 1.05,
            iterations: 'infinite'
        },
        confetti: {
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#FFD700', '#FFA500', '#FF69B4', '#00CED1', '#9370DB']
        }
    }
};

// === BADGE CONFIGURATIONS ===
export const BADGE_CONFIGS = {
    styleGod: {
        threshold: 95,
        name: 'Style God',
        emoji: '👑',
        icon: 'crown',
        color: '#FFD700',
        glow: true,
        pulse: true,
        confetti: true,
        shareText: 'Achieved Style God status! 👑✨',
        description: 'Elite fashion mastery — top 1% of all ratings'
    },
    fashionista: {
        threshold: 90,
        name: 'Fashionista',
        emoji: '💎',
        icon: 'diamond',
        color: '#E0FFFF',
        glow: true,
        pulse: false,
        confetti: false,
        shareText: 'Fashionista badge unlocked! 💎',
        description: 'Exceptional style coordination'
    },
    trendSetter: {
        threshold: 85,
        name: 'Trend Setter',
        emoji: '🔥',
        icon: 'flame',
        color: '#FF4500',
        glow: false,
        pulse: false,
        confetti: false,
        shareText: 'Trend Setter vibes! 🔥',
        description: 'Ahead of the fashion curve'
    },
    roastSurvivor: {
        mode: 'savage',
        name: 'Roast Survivor',
        emoji: '💀',
        icon: 'skull',
        color: '#8B0000',
        glow: true,
        pulse: false,
        confetti: false,
        shareText: 'Survived Savage Mode! 💀',
        description: 'Braved the brutal truth'
    },
    streakMaster: {
        streakDays: 7,
        name: 'Streak Master',
        emoji: '🔥',
        icon: 'fire-streak',
        color: '#FF6347',
        glow: false,
        pulse: true,
        confetti: false,
        shareText: '7-day streak unlocked! 🔥',
        description: 'Consistent style checking'
    }
};

// === VIRALITY NUDGES (Mode-Specific Share Prompts) ===
export const VIRALITY_NUDGES = {
    nice: {
        primary: "You're perfection! Share #FitRateNice",
        challenge: "Challenge friends to match this glow! 💫",
        referral: "Share your link — unlock Pro Roasts for friends who join!",
        streak: "Day {X} glow-up! Keep the streak alive ✨",
        rescan: "New outfit tomorrow? Rescan for daily style tracking!",
        community: "Join thousands rating their fits daily!"
    },
    roast: {
        primary: "Roasted to perfection? Tag squad — #FitRateRoast!",
        challenge: "Start a chain for referral rewards! 🔥",
        referral: "Dare friends to get roasted — earn Pro scans!",
        streak: "Day {X} roast streak! Who's surviving best?",
        rescan: "Think you can do better? Rescan tomorrow!",
        community: "Join the roast community — thousands getting burned daily!"
    },
    honest: {
        primary: "Truth unlocked — share your journey #FitRateHonest",
        challenge: "Pro perfection pays off! Challenge friends to level up!",
        referral: "Share for +1 Pro Roast — help friends get real feedback!",
        streak: "Day {X} honest journey! Track your glow-up 💡",
        rescan: "Monitor your style evolution — rescan tomorrow!",
        community: "Real feedback, real growth — join Pro!"
    },
    savage: {
        primary: "Survived perfection? Prove it — #FitRateSavage!",
        challenge: "Dare friends (and refer for extras)! 💀",
        referral: "Only the brave share this — earn rewards for referrals!",
        streak: "Day {X} savage survivor! Legend status 🗡️",
        rescan: "Ready for round two? Rescan if you dare!",
        community: "Elite savage squad — only the brave survive!"
    }
};

// === UPSELL CONFIGURATION (Pro Conversion Overlays) ===
export const UPSELL_CONFIG = {
    // Trigger conditions
    triggers: {
        lowScore: {
            condition: 'score < 60',
            message: "Unlock Honest tips to fix this! 💡",
            cta: "Try Pro — Get Real Advice",
            urgency: 'medium'
        },
        highScore: {
            condition: 'score >= 85',
            message: "Ready for Savage heat? 🔥",
            cta: "Unlock Savage Mode",
            urgency: 'low'
        },
        freeLimitReached: {
            condition: 'scansRemaining === 0',
            message: "Out of scans? Unlock 25/day with Pro!",
            cta: "Go Pro — Unlimited Style",
            urgency: 'high'
        },
        afterRoast: {
            condition: 'mode === "roast" && !isPro',
            message: "Want the brutal truth? Try Savage Mode 💀",
            cta: "Unlock Pro Modes",
            urgency: 'medium'
        },
        streakBonus: {
            condition: 'streak >= 3 && !isPro',
            message: "Streak champion! Pro unlocks unlimited scans 🔥",
            cta: "Keep the Streak — Go Pro",
            urgency: 'medium'
        }
    },
    // Overlay styling
    overlay: {
        position: 'bottom',
        animation: 'slide-up',
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        accentColor: '#FFD700',
        dismissible: true,
        showAfterDelay: 2000 // ms after result
    },
    // Banner on share cards
    proBanner: {
        text: '⭐ PRO',
        position: 'top-right',
        backgroundColor: '#FFD700',
        textColor: '#000000'
    },
    // Conversion copy variants
    copyVariants: {
        fomo: "Join 10,000+ Pro users getting daily style perfection",
        value: "25 scans/day + Honest & Savage modes + Priority AI",
        social: "Your friends are going Pro — don't get left behind",
        streak: "Don't break your streak — Pro = unlimited scans"
    }
};

// === PWA ENHANCEMENT CONFIGURATION ===
export const PWA_CONFIG = {
    // Install prompt triggers
    installPrompt: {
        triggerAfterShares: 2,
        triggerAfterScans: 3,
        message: "Add FitRate to your home screen for instant style checks!",
        cta: "Install App",
        showOnShareAction: true
    },
    // Push notification templates
    pushNotifications: {
        dailyReminder: {
            title: "Daily roast ready! 🔥",
            body: "Your style awaits judgment — scan now!",
            icon: '/icons/notification-icon.png',
            badge: '/icons/badge-icon.png',
            scheduledTime: '10:00', // Local time
            enabled: true
        },
        streakReminder: {
            title: "Don't break your streak! 🔥",
            body: "{streak} days strong — keep it going!",
            icon: '/icons/streak-icon.png',
            scheduledTime: '18:00',
            enabled: true
        },
        proPromo: {
            title: "Pro users are crushing it ⭐",
            body: "Unlock Savage mode — if you dare!",
            icon: '/icons/pro-icon.png',
            frequency: 'weekly',
            enabled: true
        },
        referralUpdate: {
            title: "Friend joined! 🎉",
            body: "You earned +1 Pro Roast — use it now!",
            icon: '/icons/referral-icon.png',
            enabled: true
        }
    },
    // Offline support
    offlineMode: {
        cacheShareCards: true,
        showOfflineMessage: "You're offline — share cards saved for later!",
        queueAnalysisRequests: false
    }
};

// === END HOOKS PER MODE (Append to Every Response) ===
export const END_HOOKS = {
    nice: {
        sharePrompt: "You're perfection! Share #FitRateNice",
        challenge: "Challenge friends to match this glow!",
        hashtags: ['#FitRateNice', '#StyleWin', '#OOTD'],
        referralNudge: "Share your link — friends get roasted, you get rewards!"
    },
    roast: {
        sharePrompt: "Roasted to perfection? Tag squad — #FitRateRoast!",
        challenge: "Start a chain for referral rewards!",
        hashtags: ['#FitRateRoast', '#GotRoasted', '#FashionFail'],
        referralNudge: "Dare friends to survive — earn Pro scans!"
    },
    honest: {
        sharePrompt: "Truth unlocked — share your journey #FitRateHonest",
        challenge: "Pro perfection pays off!",
        hashtags: ['#FitRateHonest', '#RealFeedback', '#StyleGrowth'],
        referralNudge: "Help friends level up — share your link!"
    },
    savage: {
        sharePrompt: "Survived perfection? Prove it — #FitRateSavage!",
        challenge: "Dare friends (and refer for extras)!",
        hashtags: ['#FitRateSavage', '#SurvivedSavage', '#BrutalTruth'],
        referralNudge: "Only legends share this — recruit the brave!"
    }
};

// === FRONTEND RENDERING PROCESS ===
export const FRONTEND_PROCESS = `
**Frontend Process (On Backend Response — 5x Visual Verification):**
1. ✅ Parse JSON response: {rating, text, mode, hooks, scanInfo}
2. ✅ Initialize state machine: Analyzing → Result animation → Share preview
3. ✅ Render score with count-up animation (1.5s, ease-out-expo)
4. ✅ Apply mode-specific styling (colors, emojis, tone)
5. ✅ Check for badges: 95+ = Style God (glow + confetti + pulse)
6. ✅ Add 1-2 perfection nudges (streaks/challenges/referrals/Pro tease)
7. ✅ Generate share cards (1080x1920 Story + 1080x1080 Feed)
8. ✅ Enable one-tap share (Web Share API + canvas download)
9. ✅ Show upsell overlay if conditions met (low score → Honest, high → Savage)
10. ✅ Confirm: "Visually 10/10? Shareable explosion? Habit-forming?"
`;

/**
 * Build event mode prompt block
 * @param {object} eventContext - Event context with theme info
 * @returns {string} Event mode prompt block
 */
function buildEventModePrompt(eventContext) {
    if (!eventContext) return '';

    // Special logic for Ugly Sweater theme
    const isUglyTheme = eventContext.theme.toLowerCase().includes('ugly');
    let themeSpecificRules = '';

    if (isUglyTheme) {
        themeSpecificRules = `
7. *** SPECIAL THEME OVERRIDE: UGLY SWEATER ***
   • "UGLIER" IS BETTER. Reward chaos, clashing colors, and tackiness.
   • 3D elements (bells, tinsel, lights) = BONUS POINTS.
   • "Stylish/Chic" styling should be penalized unless it enhances the irony.
   • IGNORE normal "color coordination" penalties.
   • The goal is MAXIMUM VISUAL IMPACT through "bad" taste.`;
    }

    return `
🏆 EVENT MODE ACTIVE — WEEKLY COMPETITION 🏆

THEME: ${eventContext.themeEmoji} ${eventContext.theme}
DESCRIPTION: ${eventContext.themeDescription}
WEEK: ${eventContext.weekId}

EVENT JUDGING CHARTER (STRICT — OVERRIDE NORMAL SCORING):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. OUTFIT-ONLY ANALYSIS (CRITICAL)
   • Judge ONLY: clothing, accessories, styling, color coordination, fit, fabric, layering
   • Reference ONLY visible garments and styling choices
   • NEVER comment on: body, weight, shape, size, skin, face, age, gender, identity

2. THEME ALIGNMENT (30% OF SCORE)
   • Does this outfit match "${eventContext.theme}"?
   • Theme-matching = higher score potential
   • Off-theme but well-styled = score capped around 70

3. BANNED LANGUAGE (HARD BLOCK — NEVER USE)
   • "flattering", "slimming", "body type", "your figure"
   • "at your age", "for a [gender]", "attractive", "hot", "sexy"
   • Any reference to the person's body, appearance, or identity

4. ALLOWED LANGUAGE (USE INSTEAD)
   • "the silhouette is clean", "proportions work well"
   • "colors complement each other", "layers create dimension"
   • "the fit sits well", "fabric drapes nicely"

5. SCORE NORMALIZATION (EVENT MODE)
   • Use FULL 0-100 range regardless of mode selected
   • Formula: base_score × 0.70 + theme_score × 0.30 = final
   • Format: XX.X (one decimal)

6. REQUIRED ADDITIONAL OUTPUT FIELDS
   • "themeScore": 0-100 (how well outfit matches theme)
   • "themeCompliant": true/false (does outfit reasonably match theme?)${themeSpecificRules}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REMEMBER: In event mode, you are judging CLOTHES for a competition. 
Be fair, be specific, match the theme, and NEVER comment on the person.
`;
}

/**
 * Build the complete system prompt for an AI request
 * TOKEN-OPTIMIZED: ~600 tokens (was ~3000)
 * @param {string} tier - 'free' or 'pro'
 * @param {string} mode - 'nice', 'roast', 'honest', or 'savage'
 * @param {object} securityContext - Security context (unused in prompt - handled by backend)
 * @param {object} eventContext - Optional event context for event mode
 * @returns {string} Complete system prompt
 */
export function buildSystemPrompt(tier, mode, securityContext = {}, eventContext = null) {
    const isPro = tier === 'pro';
    const outputFormat = isPro ? OUTPUT_FORMAT.pro : OUTPUT_FORMAT.free;

    // Event mode additions
    const eventBlock = eventContext ? `
EVENT MODE: ${eventContext.themeEmoji} ${eventContext.theme}
- Theme alignment = 30% of score
- Off-theme but stylish = cap ~70
- NEVER comment on body/face/identity
- Add fields: "themeScore": 0-100, "themeCompliant": boolean
` : '';

    // Tier depth
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
- One hyper-specific visible detail ("the flat textures cancel each other out")
- Quotable verdict (4-9 words, screenshot-ready)
- If can't see full outfit, acknowledge briefly

CELEBS:
Men: ${CELEBS.male.slice(0, 6).join(', ')}
Women: ${CELEBS.female.slice(0, 6).join(', ')}

OUTPUT (JSON only, no markdown):
${outputFormat}

OUTFIT VALIDATION (BE LENIENT):
✅ ACCEPT if:
- ANY clothing visible (even just top or bottom)
- Partial outfit (sitting, mirror selfie, etc.)
- Jacket/coat only
- Accessories with minimal clothing
- Casual/loungewear (hoodies, sweats)

❌ REJECT only if:
- Zero clothing visible (face only, landscape, object)
- Pure selfie with no outfit focus

When in doubt, RATE IT. If you can see any clothing, analyze it.

INVALID: {"isValidOutfit": false, "error": "Need to see your outfit! Try a photo showing your clothes 📸"}
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

// ============================================================================
// FRONTEND RENDERER HELPER FUNCTIONS
// ============================================================================

/**
 * Get score color configuration based on rating
 * @param {number} score - The rating score (0-100)
 * @returns {object} Color configuration with color, glow, and pulse properties
 */
export function getScoreColorConfig(score) {
    const { scoreColors } = RATING_DISPLAY_CONFIG;
    for (const [tier, config] of Object.entries(scoreColors)) {
        if (score >= config.range[0] && score <= config.range[1]) {
            return { tier, ...config };
        }
    }
    return { tier: 'average', ...scoreColors.average };
}

/**
 * Get applicable badges for a result
 * @param {object} result - Analysis result with score and mode
 * @param {number} streakDays - Current user streak days
 * @returns {object[]} Array of applicable badge configurations
 */
export function getApplicableBadges(result, streakDays = 0) {
    const badges = [];
    const score = result.scores?.overall || parseFloat(result.scores?.rating) || 0;
    const mode = result.scores?.mode;

    // Score-based badges
    if (score >= BADGE_CONFIGS.styleGod.threshold) {
        badges.push(BADGE_CONFIGS.styleGod);
    } else if (score >= BADGE_CONFIGS.fashionista.threshold) {
        badges.push(BADGE_CONFIGS.fashionista);
    } else if (score >= BADGE_CONFIGS.trendSetter.threshold) {
        badges.push(BADGE_CONFIGS.trendSetter);
    }

    // Mode-based badges
    if (mode === 'savage') {
        badges.push(BADGE_CONFIGS.roastSurvivor);
    }

    // Streak-based badges
    if (streakDays >= BADGE_CONFIGS.streakMaster.streakDays) {
        badges.push(BADGE_CONFIGS.streakMaster);
    }

    return badges;
}

/**
 * Get upsell trigger based on result and user state
 * @param {object} result - Analysis result
 * @param {object} scanInfo - User scan info
 * @param {number} streak - User streak days
 * @returns {object|null} Upsell configuration or null if no upsell
 */
export function getUpsellTrigger(result, scanInfo, streak = 0) {
    const score = result.scores?.overall || parseFloat(result.scores?.rating) || 0;
    const mode = result.scores?.mode;
    const isPro = scanInfo?.isPro || false;
    const scansRemaining = scanInfo?.scansRemaining ?? 0;

    // Don't show upsells to Pro users
    if (isPro) return null;

    const { triggers } = UPSELL_CONFIG;

    // Priority order: limit reached > low score > streak bonus > high score > after roast
    if (scansRemaining === 0) {
        return triggers.freeLimitReached;
    }
    if (score < 60) {
        return triggers.lowScore;
    }
    if (streak >= 3) {
        return triggers.streakBonus;
    }
    if (score >= 85) {
        return triggers.highScore;
    }
    if (mode === 'roast') {
        return triggers.afterRoast;
    }

    return null;
}

/**
 * Get virality nudges for current context
 * @param {string} mode - Analysis mode
 * @param {number} streakDays - Current streak days
 * @returns {object} Nudge configuration with primary, challenge, and referral
 */
export function getViralityNudges(mode, streakDays = 0) {
    const modeNudges = VIRALITY_NUDGES[mode] || VIRALITY_NUDGES.nice;

    return {
        primary: modeNudges.primary,
        challenge: modeNudges.challenge,
        referral: modeNudges.referral,
        streak: streakDays > 0 ? modeNudges.streak.replace('{X}', streakDays) : null,
        rescan: modeNudges.rescan,
        community: modeNudges.community
    };
}

/**
 * Get end hooks for a mode
 * @param {string} mode - Analysis mode
 * @returns {object} End hook configuration
 */
export function getEndHooks(mode) {
    return END_HOOKS[mode] || END_HOOKS.nice;
}

/**
 * Get share card configuration for a format
 * @param {string} format - 'story' or 'feed'
 * @param {string} mode - Analysis mode
 * @returns {object} Complete share card configuration
 */
export function getShareCardConfig(format, mode) {
    const formatConfig = SHARE_CARD_SPECS[format] || SHARE_CARD_SPECS.story;
    const modeHashtags = SHARE_CARD_SPECS.embed.hashtags[mode] || SHARE_CARD_SPECS.embed.hashtags.nice;
    const challengeText = SHARE_CARD_SPECS.embed.challengeText[mode] || SHARE_CARD_SPECS.embed.challengeText.nice;

    return {
        ...formatConfig,
        layers: SHARE_CARD_SPECS.layers,
        embed: {
            ...SHARE_CARD_SPECS.embed,
            hashtags: modeHashtags,
            challengeText
        }
    };
}

/**
 * Get PWA install prompt configuration
 * @param {number} shareCount - User's total share count
 * @param {number} scanCount - User's total scan count
 * @returns {object|null} Install prompt config or null if not triggered
 */
export function getPWAInstallPrompt(shareCount, scanCount) {
    const { installPrompt } = PWA_CONFIG;

    if (shareCount >= installPrompt.triggerAfterShares ||
        scanCount >= installPrompt.triggerAfterScans) {
        return installPrompt;
    }
    return null;
}

/**
 * Build complete frontend rendering context
 * @param {object} result - Backend analysis result
 * @param {object} scanInfo - User scan information
 * @param {object} userContext - User context (streak, shareCount, etc.)
 * @returns {object} Complete frontend rendering context
 */
export function buildFrontendRenderContext(result, scanInfo, userContext = {}) {
    const mode = result.scores?.mode || 'nice';
    const score = result.scores?.overall || parseFloat(result.scores?.rating) || 0;
    const streakDays = userContext.streakDays || 0;
    const shareCount = userContext.shareCount || 0;
    const scanCount = userContext.scanCount || 0;

    return {
        // Core result data
        result,
        scanInfo,

        // Rendering configuration
        rendererConfig: FRONTEND_RENDERER_CONFIG,

        // Score display
        scoreDisplay: {
            value: score,
            color: getScoreColorConfig(score),
            circle: RATING_DISPLAY_CONFIG.scoreCircle,
            animations: RATING_DISPLAY_CONFIG.animations
        },

        // Badges
        badges: getApplicableBadges(result, streakDays),

        // Share cards
        shareCards: {
            story: getShareCardConfig('story', mode),
            feed: getShareCardConfig('feed', mode)
        },

        // Virality elements
        virality: {
            nudges: getViralityNudges(mode, streakDays),
            endHooks: getEndHooks(mode),
            hooks: getViralityHooks(mode)
        },

        // Upsell
        upsell: getUpsellTrigger(result, scanInfo, streakDays),

        // PWA
        pwa: {
            installPrompt: getPWAInstallPrompt(shareCount, scanCount),
            config: PWA_CONFIG
        },

        // Process checklist
        process: FRONTEND_PROCESS
    };
}

export default {
    // Original exports
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

    // Frontend renderer exports
    FRONTEND_RENDERER_CONFIG,
    SHARE_CARD_SPECS,
    RATING_DISPLAY_CONFIG,
    BADGE_CONFIGS,
    VIRALITY_NUDGES,
    UPSELL_CONFIG,
    PWA_CONFIG,
    END_HOOKS,
    FRONTEND_PROCESS,

    // Original functions
    buildSystemPrompt,
    getViralityHooks,
    enhanceWithViralityHooks,

    // Frontend renderer functions
    getScoreColorConfig,
    getApplicableBadges,
    getUpsellTrigger,
    getViralityNudges,
    getEndHooks,
    getShareCardConfig,
    getPWAInstallPrompt,
    buildFrontendRenderContext
};
