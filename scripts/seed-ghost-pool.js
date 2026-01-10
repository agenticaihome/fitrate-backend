/**
 * Seed Ghost Pool Script
 * 
 * Seeds the Arena ghost pool with AI-generated outfit photos
 * for guaranteed 15-second matching.
 * 
 * Usage: node scripts/seed-ghost-pool.js
 * 
 * Requires: ADMIN_KEY environment variable
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// API configuration
const API_BASE = process.env.API_BASE || 'https://fitrate-production.up.railway.app/api';
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!ADMIN_KEY) {
    console.error('❌ ADMIN_KEY environment variable required');
    console.error('Usage: ADMIN_KEY=your_key node scripts/seed-ghost-pool.js');
    process.exit(1);
}

// Seed outfit data - matches our generated images
const SEED_OUTFITS = [
    { file: 'outfit_streetwear_1', score: 87.5, mode: 'hypebeast', displayName: 'UrbanDrip247' },
    { file: 'outfit_casual_chic_2', score: 82.3, mode: 'nice', displayName: 'ChicVibes99' },
    { file: 'outfit_smart_casual_3', score: 79.8, mode: 'honest', displayName: 'DapperDan42' },
    { file: 'outfit_athleisure_4', score: 84.1, mode: 'nice', displayName: 'FitQueen88' },
    { file: 'outfit_vintage_5', score: 76.5, mode: 'chaos', displayName: 'RetroSoul33' },
    { file: 'outfit_minimalist_6', score: 91.2, mode: 'honest', displayName: 'DarkAesthetic' },
];

const IMAGE_DIR = path.join(__dirname, 'seed-images');

async function readImageAsBase64(imagePath) {
    const buffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function seedOutfit(outfit, imageBase64) {
    const url = `${API_BASE}/admin/ghost-pool/seed?key=${ADMIN_KEY}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            score: outfit.score,
            thumb: imageBase64,
            displayName: outfit.displayName,
            mode: outfit.mode
        })
    });

    const data = await response.json();
    return data;
}

async function main() {
    console.log('🌟 Seeding Ghost Pool with AI-generated outfits...\n');

    // Find image files matching our outfit data
    const files = fs.readdirSync(IMAGE_DIR);

    let seeded = 0;
    for (const outfit of SEED_OUTFITS) {
        // Find matching image file
        const imageFile = files.find(f => f.startsWith(outfit.file));
        if (!imageFile) {
            console.log(`⚠️ No image found for ${outfit.file}`);
            continue;
        }

        const imagePath = path.join(IMAGE_DIR, imageFile);
        console.log(`📸 Seeding: ${outfit.displayName} (Score: ${outfit.score}, Mode: ${outfit.mode})`);

        try {
            const imageBase64 = await readImageAsBase64(imagePath);
            const result = await seedOutfit(outfit, imageBase64);

            if (result.success) {
                console.log(`   ✅ Added! Pool size: ${result.poolStats?.activeSize || '?'}`);
                seeded++;
            } else {
                console.log(`   ❌ Failed: ${result.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.log(`   ❌ Error: ${err.message}`);
        }
    }

    console.log(`\n🎉 Seeded ${seeded} outfits to ghost pool!`);

    // Get final stats
    try {
        const statsUrl = `${API_BASE}/admin/ghost-pool/stats?key=${ADMIN_KEY}`;
        const statsRes = await fetch(statsUrl);
        const stats = await statsRes.json();
        console.log(`📊 Final Pool Stats: ${stats.activeSize || stats.totalSize || 0} active outfits`);
    } catch (err) {
        console.log('Could not fetch final stats');
    }
}

main().catch(console.error);
