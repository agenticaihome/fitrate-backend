/**
 * Image Validator
 * Validates uploaded images for security
 * - Checks MIME type via magic bytes
 * - Strips EXIF metadata
 * - Validates dimensions
 */

import sharp from 'sharp';

// Allowed image types with their magic bytes
const MAGIC_BYTES = {
    'image/jpeg': [
        [0xFF, 0xD8, 0xFF]
    ],
    'image/png': [
        [0x89, 0x50, 0x4E, 0x47]
    ],
    'image/webp': [
        [0x52, 0x49, 0x46, 0x46] // RIFF header (need to also check for WEBP)
    ],
    'image/gif': [
        [0x47, 0x49, 0x46, 0x38]
    ]
};

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_DIMENSION = 4096; // Max width/height
const MIN_DIMENSION = 100;  // Min width/height

/**
 * Validate image from base64 string
 * Returns sanitized buffer or null if invalid
 */
export async function validateAndSanitizeImage(base64Image) {
    try {
        // Remove data URL prefix if present
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        // Check magic bytes
        const detectedType = detectImageType(buffer);
        if (!detectedType) {
            return { valid: false, error: 'Invalid image format. Use JPEG, PNG, or WebP.' };
        }

        // Use Sharp to validate and sanitize
        const image = sharp(buffer);
        const metadata = await image.metadata();

        // Validate dimensions
        if (!metadata.width || !metadata.height) {
            return { valid: false, error: 'Could not read image dimensions.' };
        }

        if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
            return { valid: false, error: `Image too large. Max ${MAX_DIMENSION}px.` };
        }

        if (metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
            return { valid: false, error: `Image too small. Min ${MIN_DIMENSION}px.` };
        }

        // Sanitize: resize for API cost optimization, convert to JPEG, strip EXIF
        // 512px is sufficient for outfit analysis and reduces API costs by 60-80%
        const sanitized = await image
            .rotate() // Auto-rotate based on EXIF, then strips it
            .resize(512, 512, {
                fit: 'inside',           // Maintain aspect ratio
                withoutEnlargement: true // Don't upscale small images
            })
            .jpeg({ quality: 80 }) // Convert to JPEG
            .toBuffer();

        // Convert back to base64
        const sanitizedBase64 = sanitized.toString('base64');

        return {
            valid: true,
            sanitizedImage: `data:image/jpeg;base64,${sanitizedBase64}`,
            originalType: detectedType,
            width: metadata.width,
            height: metadata.height
        };
    } catch (error) {
        console.error('Image validation error:', error.message);
        return { valid: false, error: 'Could not process image. Try a different file.' };
    }
}

/**
 * Detect image type from magic bytes
 */
function detectImageType(buffer) {
    if (buffer.length < 12) return null;

    for (const [mimeType, signatures] of Object.entries(MAGIC_BYTES)) {
        for (const signature of signatures) {
            let match = true;
            for (let i = 0; i < signature.length; i++) {
                if (buffer[i] !== signature[i]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                // Special check for WebP (need RIFF + WEBP)
                if (mimeType === 'image/webp') {
                    const webpMarker = buffer.slice(8, 12).toString('ascii');
                    if (webpMarker !== 'WEBP') continue;
                }
                return mimeType;
            }
        }
    }

    return null;
}

/**
 * Quick check if base64 looks like an image (for early rejection)
 */
export function quickImageCheck(base64Image) {
    if (!base64Image || typeof base64Image !== 'string') {
        return false;
    }

    // Check for data URL prefix
    if (base64Image.startsWith('data:')) {
        const match = base64Image.match(/^data:(image\/\w+);base64,/);
        if (!match) return false;
        if (!ALLOWED_TYPES.includes(match[1])) return false;
    }

    // Check reasonable length (10KB - 10MB in base64)
    const length = base64Image.length;
    if (length < 10000 || length > 15000000) {
        return false;
    }

    return true;
}
