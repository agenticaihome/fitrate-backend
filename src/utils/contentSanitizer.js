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
 * @param {object} result - AI analysis result
 * @returns {{ sanitized: object, hadViolations: boolean, logEntry: object|null }}
 */
export function sanitizeAIResponse(result) {
    if (!result || !result.success) {
        return { sanitized: result, hadViolations: false, logEntry: null };
    }

    let hadViolations = false;
    const allViolations = [];

    // Fields to scan
    const textFields = ['review', 'verdict', 'shareHook'];

    for (const field of textFields) {
        if (result[field]) {
            const scan = scanForViolations(result[field]);
            if (!scan.clean) {
                hadViolations = true;
                allViolations.push({ field, violations: scan.violations });
                result[field] = scan.sanitized;
            }
        }
    }

    // Scan item roasts if present
    if (result.itemRoasts && Array.isArray(result.itemRoasts)) {
        result.itemRoasts = result.itemRoasts.map((roast, idx) => {
            const scan = scanForViolations(roast);
            if (!scan.clean) {
                hadViolations = true;
                allViolations.push({ field: `itemRoasts[${idx}]`, violations: scan.violations });
                return scan.sanitized;
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
