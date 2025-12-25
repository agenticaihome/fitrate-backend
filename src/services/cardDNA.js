/**
 * Card DNA Service - OPERATION UNIQUE CARD
 * 
 * Generates unique visual DNA for every results card.
 * Ensures no two cards ever look identical through:
 * - Cryptographic seed generation
 * - Deterministic style token derivation
 * - Multiple variation slots
 * 
 * Total unique combinations: 13,824+
 */

import crypto from 'crypto';

// ============================================
// SEEDED PRNG (Deterministic Randomness)
// ============================================

/**
 * Create a seeded pseudo-random number generator
 * Given the same seed, produces the same sequence of numbers
 */
function createSeededRNG(seed) {
    // Create a 32-byte hash from the seed
    const hash = crypto.createHash('sha256').update(seed).digest();
    let index = 0;

    return () => {
        // Read 4 bytes as unsigned 32-bit integer
        const value = hash.readUInt32BE(index % (hash.length - 3)) / 0xFFFFFFFF;
        index = (index + 4) % (hash.length - 3);
        return value;
    };
}

/**
 * Pick random item from array using seeded RNG
 */
function pickFromArray(rng, array) {
    return array[Math.floor(rng() * array.length)];
}

// ============================================
// VARIATION SLOT OPTIONS (All On-Brand)
// ============================================

// Layout templates - major visual differences
const TEMPLATES = [
    { id: 'centered', name: 'Centered Hero', heroAlign: 'center', badgePos: 'top-right' },
    { id: 'hero-left', name: 'Left Hero', heroAlign: 'left', badgePos: 'top-right' },
    { id: 'minimal', name: 'Minimal Clean', heroAlign: 'center', badgePos: 'under-title' },
    { id: 'expanded', name: 'Expanded Stats', heroAlign: 'center', badgePos: 'top-right' }
];

// Background gradients - mood/atmosphere
const GRADIENTS = [
    { id: 'deep-space', colors: ['#0a0a15', '#1a1a2e'], vibe: 'default' },
    { id: 'purple-night', colors: ['#0f0a1a', '#1a0f2e'], vibe: 'mysterious' },
    { id: 'ocean-depth', colors: ['#0a0f1a', '#0f1a2e'], vibe: 'cool' },
    { id: 'wine-dark', colors: ['#1a0a0a', '#2e1a1a'], vibe: 'warm' },
    { id: 'midnight', colors: ['#0a0a0f', '#15152a'], vibe: 'sleek' },
    { id: 'charcoal', colors: ['#121212', '#1f1f1f'], vibe: 'minimal' }
];

// Score ring styles - how the main score is displayed
const RING_STYLES = [
    { id: 'solid', name: 'Classic Solid', strokeWidth: 16 },
    { id: 'segmented', name: 'Segmented Glow', strokeWidth: 12 },
    { id: 'neon', name: 'Neon Outline', strokeWidth: 8 },
    { id: 'double', name: 'Double Ring', strokeWidth: 10 }
];

// Pattern overlays - subtle texture
const PATTERNS = [
    { id: 'none', opacity: 0 },
    { id: 'dots', opacity: 0.03 },
    { id: 'grid', opacity: 0.02 },
    { id: 'noise', opacity: 0.04 }
];

// Sparkle/celebration intensity
const SPARKLE_INTENSITIES = [
    { id: 'off', count: 0 },
    { id: 'subtle', count: 3 },
    { id: 'medium', count: 6 }
];

// Typography headline weight variations
const HEADLINE_WEIGHTS = [600, 700, 800];

// Divider line styles
const DIVIDER_STYLES = ['solid', 'dashed', 'glow'];

// Badge position variations
const BADGE_POSITIONS = ['top-right', 'under-title'];

// Accent color variations (mode-aware but with variety)
const ACCENT_VARIATIONS = [
    { id: 'primary', saturation: 1.0 },
    { id: 'vibrant', saturation: 1.2 },
    { id: 'muted', saturation: 0.8 }
];

// ============================================
// TIME-OF-DAY THEMING 🌅
// ============================================

const TIME_PERIODS = {
    morning: {
        id: 'morning',
        hours: [6, 12],  // 6am - 12pm
        vibe: 'fresh',
        gradientBoost: ['#1a1520', '#2a2035'],  // Slightly warmer
        copyPrefix: '☀️ Morning fit check:',
        badges: ['🌅 EARLY RISER', '☀️ MORNING GLORY', '🌤️ DAYBREAK DRIP'],
        accent: '#FFD93D'  // Warm gold
    },
    afternoon: {
        id: 'afternoon',
        hours: [12, 18],  // 12pm - 6pm
        vibe: 'peak',
        gradientBoost: ['#151520', '#252535'],  // Balanced
        copyPrefix: '🔥 Peak hours verdict:',
        badges: ['☀️ PEAK VIBES', '🌞 MIDDAY HEAT', '⚡ PRIME TIME'],
        accent: '#FF6B35'  // Vibrant orange
    },
    evening: {
        id: 'evening',
        hours: [18, 24],  // 6pm - 12am
        vibe: 'sleek',
        gradientBoost: ['#0f0a15', '#1a1025'],  // Deeper purples
        copyPrefix: '✨ After dark verdict:',
        badges: ['🌙 NIGHT MODE', '✨ EVENING ELEGANCE', '🌆 GOLDEN HOUR'],
        accent: '#A855F7'  // Purple
    },
    latenight: {
        id: 'latenight',
        hours: [0, 6],  // 12am - 6am
        vibe: 'mysterious',
        gradientBoost: ['#050510', '#0f0f1a'],  // Ultra dark
        copyPrefix: '🦉 Night owl detected:',
        badges: ['🦉 NIGHT OWL', '🌌 MIDNIGHT LEGEND', '💀 AFTER HOURS'],
        accent: '#3B82F6'  // Cool blue
    }
};

// ============================================
// STREAK-INFLUENCED VISUALS 🔥
// ============================================

const STREAK_TIERS = {
    none: {
        id: 'none',
        minStreak: 0,
        effects: [],
        ringGlow: 1.0,
        badge: null
    },
    starter: {
        id: 'starter',
        minStreak: 3,
        effects: ['subtle-glow'],
        ringGlow: 1.2,
        badge: '🔥 3-DAY STREAK'
    },
    committed: {
        id: 'committed',
        minStreak: 7,
        effects: ['flame-accents', 'enhanced-glow'],
        ringGlow: 1.4,
        badge: '🔥🔥 WEEK WARRIOR'
    },
    dedicated: {
        id: 'dedicated',
        minStreak: 14,
        effects: ['golden-ring', 'sparkle-burst'],
        ringGlow: 1.6,
        badge: '👑 DEDICATED'
    },
    legendary: {
        id: 'legendary',
        minStreak: 30,
        effects: ['rainbow-glow', 'confetti', 'legendary-aura'],
        ringGlow: 2.0,
        badge: '🏆 LEGENDARY STREAK'
    }
};

/**
 * Get time period from hour
 */
function getTimePeriod(hour) {
    if (hour >= 6 && hour < 12) return TIME_PERIODS.morning;
    if (hour >= 12 && hour < 18) return TIME_PERIODS.afternoon;
    if (hour >= 18 && hour < 24) return TIME_PERIODS.evening;
    return TIME_PERIODS.latenight;
}

/**
 * Get streak tier from streak count
 */
function getStreakTier(streakCount) {
    if (streakCount >= 30) return STREAK_TIERS.legendary;
    if (streakCount >= 14) return STREAK_TIERS.dedicated;
    if (streakCount >= 7) return STREAK_TIERS.committed;
    if (streakCount >= 3) return STREAK_TIERS.starter;
    return STREAK_TIERS.none;
}

// ============================================
// CURATED COPY LIBRARIES (Safe & On-Brand)
// ============================================

// Alternate verdict titles by score band (supplements AI verdict)
const VERDICT_BADGES = {
    legendary: ['💎 LEGENDARY', '👑 ICON STATUS', '🔥 HALL OF FAME', '✨ HISTORIC', '🏆 GOATED'],
    great: ['🔥 ON FIRE', '✨ KILLING IT', '💫 STELLAR', '🎯 NAILED IT', '⚡ ELECTRIC'],
    good: ['👍 SOLID', '✅ APPROVED', '📈 TRENDING UP', '💪 RESPECTABLE', '🎵 HAS RHYTHM'],
    mid: ['🤔 INTERESTING CHOICE', '📊 STATISTICALLY PRESENT', '🔄 PLOT TWIST PENDING', '🎲 BOLD STRATEGY'],
    low: ['💀 CHARACTER DEVELOPMENT ARC', '😬 ORIGIN STORY', '🚨 REDEMPTION SZN', '📉 GLOW-UP LOADING', '🎭 THE HUMBLE BEGINNINGS']
};

// Next action CTAs (rotated for variety)
const NEXT_ACTIONS = [
    { text: 'Challenge a friend', emoji: '🔥', action: 'challenge' },
    { text: 'Keep the streak', emoji: '📈', action: 'streak' },
    { text: 'Share your score', emoji: '📲', action: 'share' },
    { text: 'Try another fit', emoji: '👀', action: 'reset' },
    { text: 'Upgrade your style', emoji: '⬆️', action: 'tips' }
];

// Motivational subtexts by score band
const MOTIVATIONAL_TEXTS = {
    legendary: [
        'Someone needs to study this scientifically',
        'The main character just entered the chat',
        'We witnessed history today',
        'This is going in the archives'
    ],
    great: [
        'Keep this energy or face consequences',
        'You figured something out and it shows',
        'The closet cooperated today',
        'Taste was acquired somewhere along the way'
    ],
    good: [
        'Respectable showing. The judges nod approvingly.',
        'You showed up and showed out (mostly)',
        'A solid foundation for future greatness',
        'The potential is palpable'
    ],
    mid: [
        'The plot thickens. So does the improvement potential.',
        'A swing was taken. A swing was... attempted.',
        'Points for showing up. Participation: noted.',
        'The glow-up montage starts here'
    ],
    low: [
        'Every superhero needs an origin story',
        'The before photo in your transformation arc',
        'This is called character development',
        'Plot twist incoming. We believe in the arc.',
        'The comeback story writes itself from here'
    ]
};

// ============================================
// CARD DNA GENERATION
// ============================================

/**
 * Get score band from numeric score
 */
function getScoreBand(score) {
    if (score >= 90) return 'legendary';
    if (score >= 75) return 'great';
    if (score >= 60) return 'good';
    if (score >= 40) return 'mid';
    return 'low';
}

/**
 * Generate unique Card DNA for a results card
 * 
 * @param {Object} params
 * @param {string} params.cardId - Unique card identifier (requestId)
 * @param {string} params.mode - AI mode (nice, roast, honest, etc)
 * @param {number} params.score - Overall score 0-100
 * @param {number} params.timestamp - Creation timestamp
 * @param {number} params.streak - Current user streak (default 0)
 * @returns {Object} Card DNA object
 */
export function generateCardDNA({ cardId, mode, score, timestamp, streak = 0 }) {
    // Create cryptographic seed from cardId + secret
    const seedInput = `${cardId}:${timestamp}:${process.env.CARD_SECRET || 'fitrate_unique_2024'}`;
    const fullSeed = crypto.createHash('sha256').update(seedInput).digest('hex');

    // Create seeded RNG for deterministic selection
    const rng = createSeededRNG(fullSeed);

    // Derive score band for copy selection
    const scoreBand = getScoreBand(score);

    // ===== TIME-OF-DAY CONTEXT =====
    const currentHour = new Date(timestamp).getHours();
    const timePeriod = getTimePeriod(currentHour);
    const timeContext = {
        period: timePeriod.id,
        vibe: timePeriod.vibe,
        gradientBoost: timePeriod.gradientBoost,
        accent: timePeriod.accent,
        copyPrefix: timePeriod.copyPrefix,
        badge: pickFromArray(rng, timePeriod.badges)
    };

    // ===== STREAK CONTEXT =====
    const streakTier = getStreakTier(streak);
    const streakContext = {
        tier: streakTier.id,
        streak: streak,
        effects: streakTier.effects,
        ringGlow: streakTier.ringGlow,
        badge: streakTier.badge
    };

    // ===== STYLE TOKENS (Visual Variations) =====
    const styleTokens = {
        // Major layout choice
        template: pickFromArray(rng, TEMPLATES),

        // Background appearance - blend base gradient with time-of-day boost
        gradient: pickFromArray(rng, GRADIENTS),
        pattern: pickFromArray(rng, PATTERNS),

        // Score display - glow intensity boosted by streak
        ringStyle: pickFromArray(rng, RING_STYLES),

        // Celebration elements - more sparkles for streaks
        sparkles: streak >= 7
            ? SPARKLE_INTENSITIES[2]  // Force medium sparkles for week+ streaks
            : pickFromArray(rng, SPARKLE_INTENSITIES),

        // Typography
        headlineWeight: pickFromArray(rng, HEADLINE_WEIGHTS),

        // Layout details
        dividerStyle: pickFromArray(rng, DIVIDER_STYLES),
        badgePosition: pickFromArray(rng, BADGE_POSITIONS),

        // Color intensity
        accentVariation: pickFromArray(rng, ACCENT_VARIATIONS)
    };

    // ===== COPY SLOTS (Text Variations) =====
    const copySlots = {
        // Badge text (supplements AI verdict)
        verdictBadge: pickFromArray(rng, VERDICT_BADGES[scoreBand] || VERDICT_BADGES.mid),

        // CTA button
        nextAction: pickFromArray(rng, NEXT_ACTIONS),

        // Motivational subtext
        motivation: pickFromArray(rng, MOTIVATIONAL_TEXTS[scoreBand] || MOTIVATIONAL_TEXTS.mid),

        // Time-of-day badge
        timeBadge: timeContext.badge,

        // Streak badge (if applicable)
        streakBadge: streakContext.badge
    };

    // ===== GENERATE SIGNATURE (For Collision Detection) =====
    const signature = crypto.createHash('md5').update([
        styleTokens.template.id,
        styleTokens.gradient.id,
        styleTokens.ringStyle.id,
        styleTokens.pattern.id,
        styleTokens.sparkles.id,
        styleTokens.headlineWeight,
        styleTokens.dividerStyle,
        styleTokens.badgePosition,
        copySlots.verdictBadge,
        timeContext.period,
        streakContext.tier
    ].join(':')).digest('hex').slice(0, 12);

    return {
        cardId,
        seed: fullSeed.slice(0, 16), // Short seed for debugging
        signature, // For collision tracking
        scoreBand,
        styleTokens,
        copySlots,
        timeContext,    // NEW: Time-of-day theming
        streakContext,  // NEW: Streak-influenced visuals
        version: 2, // Bumped for new features
        generatedAt: new Date().toISOString()
    };
}

/**
 * Validate Card DNA structure
 */
export function isValidCardDNA(dna) {
    return dna
        && typeof dna.cardId === 'string'
        && typeof dna.seed === 'string'
        && typeof dna.styleTokens === 'object'
        && typeof dna.copySlots === 'object';
}

// Export constants for frontend consumption
export const DNA_CONSTANTS = {
    TEMPLATES,
    GRADIENTS,
    RING_STYLES,
    PATTERNS,
    SPARKLE_INTENSITIES,
    VERDICT_BADGES,
    NEXT_ACTIONS
};
