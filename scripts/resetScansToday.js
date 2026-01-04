/**
 * One-time script to reset all scan counts for today
 * Run with: node scripts/resetScansToday.js
 */

import { redis, isRedisAvailable } from '../src/services/redisClient.js';
import { getTodayKeyEST } from '../src/utils/dateUtils.js';

async function resetTodaysScans() {
    if (!isRedisAvailable()) {
        console.error('Redis not available!');
        process.exit(1);
    }

    const today = getTodayKeyEST();
    console.log(`Resetting all scans for EST date: ${today}`);

    // Find all scan keys for today
    const userKeys = await redis.keys(`fitrate:scans:simple:*:${today}`);
    const fpKeys = await redis.keys(`fitrate:scans:fp:*:${today}`);
    const allKeys = [...userKeys, ...fpKeys];

    if (allKeys.length === 0) {
        console.log('No scan keys found for today.');
        process.exit(0);
    }

    console.log(`Found ${allKeys.length} scan keys to delete:`);
    allKeys.forEach(k => console.log(`  - ${k}`));

    // Delete all keys
    await redis.del(...allKeys);
    console.log(`✅ Deleted ${allKeys.length} keys. All users now have 2 scans.`);

    process.exit(0);
}

resetTodaysScans().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
