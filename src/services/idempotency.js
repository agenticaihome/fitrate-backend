import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { redis, isRedisAvailable } from './redisClient.js';

// Setup file persistence (fallback)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const IDEMPOTENCY_FILE = path.join(DATA_DIR, 'processed_events.json');

// Memory cache
const processedEvents = new Set();
let initialized = false;

// Ensure data dir exists
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

// Load from file (init)
async function init() {
    if (initialized) return;

    if (isRedisAvailable()) {
        // Redis usage doesn't need init load (we query directly)
        initialized = true;
        return;
    }

    ensureDataDir();
    try {
        if (fs.existsSync(IDEMPOTENCY_FILE)) {
            const data = fs.readFileSync(IDEMPOTENCY_FILE, 'utf8');
            const ids = JSON.parse(data);
            ids.forEach(id => processedEvents.add(id));
        }
    } catch (err) {
        console.error('Failed to load processed events:', err);
    }
    initialized = true;
}

// Save to file (if using file persistence)
function persist() {
    if (isRedisAvailable()) return;
    try {
        // Keep last 1000 events to prevent file bloom
        const events = Array.from(processedEvents).slice(-1000);
        fs.writeFileSync(IDEMPOTENCY_FILE, JSON.stringify(events));
    } catch (err) {
        console.error('Failed to save processed events:', err);
    }
}

export const IdempotencyService = {
    /**
     * Check if event has already been processed
     * @param {string} eventId 
     * @returns {Promise<boolean>}
     */
    async hasProcessed(eventId) {
        if (!initialized) await init();

        if (isRedisAvailable()) {
            const exists = await redis.exists(`stripe:event:${eventId}`);
            return exists === 1;
        }

        return processedEvents.has(eventId);
    },

    /**
     * Mark event as processed
     * @param {string} eventId 
     * @param {number} expirySeconds (Default 3 days = 259200s)
     */
    async markProcessed(eventId, expirySeconds = 259200) {
        if (!initialized) await init();

        if (isRedisAvailable()) {
            // Set key with expiry
            await redis.set(`stripe:event:${eventId}`, '1', 'EX', expirySeconds);
        } else {
            processedEvents.add(eventId);
            // Cleanup old events occasionally handled by slice in persist
            persist();
        }
    }
};
