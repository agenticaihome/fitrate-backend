/**
 * Content Sanitizer
 * Scans AI output for banned/inappropriate terms and sanitizes content
 * 
 * SECURITY: This is a critical safety layer that protects against:
 * - AI hallucinating body/weight comments
 * - Inappropriate content reaching users
 * - Legal/PR issues from offensive AI output
 */

// Banned terms that should NEVER appear in AI output
// These are checked case-insensitively
const BANNED_TERMS = [
    // Body-related (NEVER judge bodies)
    'fat', 'skinny', 'obese', 'overweight', 'underweight', 'thin',
    'body type', 'body shape', 'figure', 'physique', 'curves',
    'weight', 'pounds', 'kilos', 'bmi',

    // Attractiveness (NEVER rate attractiveness)
    'ugly', 'beautiful', 'handsome', 'pretty face', 'hot', 'sexy',
    'attractive', 'unattractive', 'gorgeous',

    // Gender/Identity (NEVER assume or comment)
    'man should', 'woman should', "men don't", "women don't",
    'masculine for a', 'feminine for a', 'gender',

    // Age-related (NEVER comment on age)
    'too old', 'too young', 'your age', 'at your age',

    // Race/Ethnicity (NEVER reference)
    'skin color', 'skin tone', 'complexion', 'ethnic',

    // Explicit (NEVER be explicit)
    'breast', 'butt', 'cleavage', 'revealing', 'provocative',
    'slutty', 'trashy', 'thot'
];

// Regex patterns for more nuanced detection
const BANNED_PATTERNS = [
    /lose\s*(some\s*)?weight/i,
    /gain\s*(some\s*)?weight/i,
    /your\s*body/i,
    /your\s*face/i,
    /look(s|ing)?\s*(fat|thin|old|young)/i,
    /too\s*(fat|thin|heavy|slim)/i
];

/**
 * Scan text for banned content
 * @param {string} text - Text to scan
 * @returns {{ clean: boolean, violations: string[], sanitized: string }}
 */
export function scanForViolations(text) {
    if (!text || typeof text !== 'string') {
        return { clean: true, violations: [], sanitized: text || '' };
    }

    const violations = [];
    let sanitized = text;
    const lowerText = text.toLowerCase();

    // Check banned terms
    for (const term of BANNED_TERMS) {
        if (lowerText.includes(term.toLowerCase())) {
            violations.push(`Banned term: "${term}"`);
            // Replace with [redacted] in sanitized version
            const regex = new RegExp(term, 'gi');
            sanitized = sanitized.replace(regex, '[style element]');
        }
    }

    // Check banned patterns
    for (const pattern of BANNED_PATTERNS) {
        if (pattern.test(text)) {
            violations.push(`Banned pattern: ${pattern.toString()}`);
            sanitized = sanitized.replace(pattern, '[outfit feedback]');
        }
    }

    return {
        clean: violations.length === 0,
        violations,
        sanitized
    };
}

/**
 * Sanitize full AI response object
 * Scans all text fields in result and result.scores for banned content
 * @param {object} result - AI analysis result
 * @returns {{ sanitized: object, hadViolations: boolean, logEntry: object|null }}
 */
export function sanitizeAIResponse(result) {
    if (!result || !result.success) {
        return { sanitized: result, hadViolations: false, logEntry: null };
    }

    let hadViolations = false;
    const allViolations = [];

    // Helper to scan and update a field
    const scanField = (obj, field, prefix = '') => {
        if (obj[field] && typeof obj[field] === 'string') {
            const scan = scanForViolations(obj[field]);
            if (!scan.clean) {
                hadViolations = true;
                allViolations.push({ field: prefix + field, violations: scan.violations });
                obj[field] = scan.sanitized;
            }
        }
    };

    // Fields to scan at root level
    const rootTextFields = ['review', 'verdict', 'shareHook', 'error'];
    for (const field of rootTextFields) {
        scanField(result, field);
    }

    // Fields to scan in result.scores (where most AI output lives)
    if (result.scores) {
        const scoreTextFields = [
            'text', 'verdict', 'line', 'tagline', 'aesthetic',
            'celebMatch', 'shareHook', 'proTip',
            'identityReflection', 'socialPerception',
            'outfitFortune', 'outfitLore', 'outfitSoundtrack',
            'outfitEnemy', 'outfitDatingApp', 'outfitPowerMove'
        ];
        for (const field of scoreTextFields) {
            scanField(result.scores, field, 'scores.');
        }

        // Scan item roasts if present (can be object or array)
        if (result.scores.itemRoasts) {
            if (Array.isArray(result.scores.itemRoasts)) {
                result.scores.itemRoasts = result.scores.itemRoasts.map((roast, idx) => {
                    if (typeof roast === 'string') {
                        const scan = scanForViolations(roast);
                        if (!scan.clean) {
                            hadViolations = true;
                            allViolations.push({ field: `scores.itemRoasts[${idx}]`, violations: scan.violations });
                            return scan.sanitized;
                        }
                    }
                    return roast;
                });
            } else if (typeof result.scores.itemRoasts === 'object') {
                // itemRoasts as object: { top: "...", bottom: "...", shoes: "..." }
                for (const [key, roast] of Object.entries(result.scores.itemRoasts)) {
                    if (typeof roast === 'string') {
                        const scan = scanForViolations(roast);
                        if (!scan.clean) {
                            hadViolations = true;
                            allViolations.push({ field: `scores.itemRoasts.${key}`, violations: scan.violations });
                            result.scores.itemRoasts[key] = scan.sanitized;
                        }
                    }
                }
            }
        }
    }

    // Legacy: Scan item roasts at root level (backwards compatibility)
    if (result.itemRoasts && Array.isArray(result.itemRoasts)) {
        result.itemRoasts = result.itemRoasts.map((roast, idx) => {
            if (typeof roast === 'string') {
                const scan = scanForViolations(roast);
                if (!scan.clean) {
                    hadViolations = true;
                    allViolations.push({ field: `itemRoasts[${idx}]`, violations: scan.violations });
                    return scan.sanitized;
                }
            }
            return roast;
        });
    }

    // Create log entry if violations found
    const logEntry = hadViolations ? {
        timestamp: new Date().toISOString(),
        violations: allViolations,
        action: 'sanitized'
    } : null;

    return { sanitized: result, hadViolations, logEntry };
}

/**
 * Check if event submissions should be frozen
 * Prevents "last-second sniping" bugs near weekly reset
 * @returns {{ frozen: boolean, reason: string|null, secondsUntilReset: number }}
 */
export function checkEventFreezeWindow() {
    const now = new Date();
    const day = now.getUTCDay();
    const hours = now.getUTCHours();
    const minutes = now.getUTCMinutes();

    // Freeze window: Sunday 23:55-23:59 UTC (last 5 minutes of week)
    if (day === 0 && hours === 23 && minutes >= 55) {
        const secondsUntilReset = (60 - minutes) * 60 + (60 - now.getUTCSeconds());
        return {
            frozen: true,
            reason: 'Weekly event is resetting. Submissions will count toward next week.',
            secondsUntilReset
        };
    }

    return { frozen: false, reason: null, secondsUntilReset: -1 };
}

export default {
    scanForViolations,
    sanitizeAIResponse,
    checkEventFreezeWindow,
    BANNED_TERMS
};
