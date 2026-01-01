import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config/index.js';
import analyzeRoutes from './routes/analyze.js';
import webhookRoutes from './routes/webhook.js';
import proRoutes from './routes/pro.js';
import referralRoutes from './routes/referral.js';
import checkoutRoutes from './routes/checkout.js';
import diagRoutes from './routes/diag.js';
import eventRoutes from './routes/event.js';
import adminRoutes from './routes/admin.js';
import restoreRoutes from './routes/restore.js';
import pushRoutes from './routes/push.js';
import streakRoutes from './routes/streak.js';
import leaderboardRoutes from './routes/leaderboard.js';
import showRoutes from './routes/show.js';
import battleRoutes from './routes/battle.js';
import matchmakingRoutes from './routes/matchmaking.js';  // Global Arena

// Security middleware
import { validateOrigin, costTracker } from './middleware/apiKeyAuth.js';

// ===========================================
// STARTUP VALIDATION - Log API key status
// ===========================================
console.log('🚀 FitRate API Starting...');
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);

if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY is NOT SET - Free scans will fail!');
} else {
  console.log('✅ GEMINI_API_KEY is configured');
}

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️  OPENAI_API_KEY is not set (Pro features disabled)');
} else {
  console.log('✅ OPENAI_API_KEY is configured');
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('⚠️  STRIPE_SECRET_KEY is not set (Payments disabled)');
} else {
  console.log('✅ STRIPE_SECRET_KEY is configured');
}

if (!process.env.REDIS_URL) {
  console.warn('⚠️  REDIS_URL is not set (Using in-memory fallback)');
} else {
  console.log('✅ REDIS_URL is configured');
}

console.log(''); // Blank line for readability

const app = express();

// Trust proxy for Railway (fixes X-Forwarded-For warnings)
app.set('trust proxy', 1);

// CORS - MUST be before other middleware
app.use(cors({
  origin: config.allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

// Security middleware (configured for API cross-origin access)
// SECURITY: Enhanced helmet configuration
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  // Strict Transport Security - enforce HTTPS
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  // Referrer Policy - don't leak full URLs
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // X-Content-Type-Options - prevent MIME sniffing
  noSniff: true,
  // X-Frame-Options - prevent clickjacking
  frameguard: { action: 'deny' }
}));

// Request logging (use 'short' format in production to reduce PII exposure)
app.use(morgan(config.nodeEnv === 'production' ? 'short' : 'combined'));

// Body parsing
// 1. Webhook needs RAW body for signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// 2. All other API routes use JSON parser (skip webhook)
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/webhook')) {
    next();
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'fitrate-api',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Origin validation for API routes (skip for webhooks, admin, diag, and event)
app.use('/api/', (req, res, next) => {
  // Skip origin check for public read-only endpoints
  if (req.path.startsWith('/admin') || req.path.startsWith('/diag') || req.path.startsWith('/event') || req.path.startsWith('/show') || req.path.startsWith('/leaderboard')) {
    return next();
  }
  validateOrigin(req, res, next);
});

// Cost tracking for expensive endpoints
app.use('/api/analyze', costTracker('scan'));

// Routes
// Diag route now protected by admin key middleware
app.use('/api/diag', diagRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/pro', proRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/event', eventRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/restore', restoreRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/show', showRoutes);            // Fashion Show
app.use('/api/streak', streakRoutes);        // Daily streak system
app.use('/api/leaderboard', leaderboardRoutes);  // Today's Top Fits
app.use('/api/battle', battleRoutes);         // 1v1 Outfit Battles
app.use('/api/arena', matchmakingRoutes);     // Global Arena Matchmaking

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(config.port, () => {
  console.log(`🚀 FitRate API running on port ${config.port}`);
  console.log(`📍 Environment: ${config.nodeEnv}`);
  console.log(`⏱️  Request timeout: 30s`);
});

// Set server timeout to 30 seconds
server.timeout = 30000;

// ============================================
// REWARD DISTRIBUTION SCHEDULER
// Runs every minute, checks if it's midnight UTC
// ============================================
import {
  calculateRewards,
  distributeRewards,
  wasDistributed,
  markDistributed,
  DAILY_REWARDS,
  WEEKLY_REWARDS,
  ARENA_REWARDS
} from './services/rewardService.js';
import { getYesterdaysFinalLeaderboard, getYesterdayKey } from './services/dailyChallengeService.js';
import { getWeeklyLeaderboard } from './services/arenaLeaderboardService.js';

let lastRewardCheck = null;

async function checkAndDistributeRewards() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcDay = now.getUTCDay(); // 0 = Sunday, 1 = Monday
  const todayKey = now.toISOString().split('T')[0];

  // Only run at 00:00-00:02 UTC (first 3 minutes of the day)
  if (utcHour !== 0 || utcMinute > 2) return;

  // Prevent multiple runs in same minute
  const checkKey = `${todayKey}-${utcMinute}`;
  if (lastRewardCheck === checkKey) return;
  lastRewardCheck = checkKey;

  console.log(`\n🎁 ============================================`);
  console.log(`🎁 REWARD DISTRIBUTION CHECK - ${now.toISOString()}`);
  console.log(`🎁 ============================================\n`);

  // --- DAILY REWARDS (every day at midnight) ---
  try {
    const yesterdayKey = getYesterdayKey();
    if (!(await wasDistributed(yesterdayKey, 'daily'))) {
      console.log(`📅 Distributing DAILY rewards for ${yesterdayKey}...`);

      const { leaderboard, totalParticipants } = await getYesterdaysFinalLeaderboard(100);

      if (leaderboard.length > 0) {
        const rewards = calculateRewards(leaderboard, DAILY_REWARDS);
        const result = await distributeRewards(rewards);

        await markDistributed(yesterdayKey, 'daily', {
          totalParticipants,
          winnersCount: rewards.length,
          ...result
        });

        console.log(`✅ Daily rewards distributed: ${result.distributed} winners, ${result.totalScans} total scans`);
      } else {
        await markDistributed(yesterdayKey, 'daily', { totalParticipants: 0, winnersCount: 0, totalScans: 0 });
        console.log(`📅 No daily challenge entries for ${yesterdayKey}`);
      }
    } else {
      console.log(`📅 Daily rewards already distributed for ${yesterdayKey}`);
    }
  } catch (error) {
    console.error('❌ Daily reward distribution failed:', error);
  }

  // --- WEEKLY REWARDS (Sunday at midnight) ---
  if (utcDay === 0) { // Sunday
    try {
      // Get last week's key (we're now in a new week)
      const lastWeek = new Date(now);
      lastWeek.setUTCDate(lastWeek.getUTCDate() - 1);
      const weekKey = `${lastWeek.getUTCFullYear()}-W${String(Math.ceil((lastWeek.getTime() - new Date(lastWeek.getUTCFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))).padStart(2, '0')}`;

      if (!(await wasDistributed(weekKey, 'weekly'))) {
        console.log(`📅 Distributing WEEKLY rewards for ${weekKey}...`);

        // Import getLeaderboard dynamically - we need the weekId from last week
        const { getLeaderboard, getWeekId } = await import('./services/eventService.js');

        // We need the weekId from yesterday (which was Sunday, the last day of last week)
        const lastSunday = new Date(now);
        lastSunday.setUTCDate(lastSunday.getUTCDate() - 1);
        const eventWeekId = getWeekId(lastSunday);

        console.log(`📅 Fetching event leaderboard for week: ${eventWeekId}`);

        // Get full leaderboard (up to 100 participants for top 25% calculation)
        const leaderboard = await getLeaderboard(eventWeekId, 100);

        if (leaderboard && leaderboard.length > 0) {
          // Transform to reward format - need userId without truncation
          // Note: eventService truncates userId for privacy, but for rewards we need full IDs
          // The leaderboard has userId as truncated + '...' - we need to get the full one
          // For now, we'll use what we have - the reward system will log if it can't find users
          const rewardLeaderboard = leaderboard.map((entry, i) => ({
            odlUserId: entry.userId?.replace('...', '') || `event_user_${i}`,
            score: entry.score,
            rank: entry.rank
          }));

          const totalParticipants = leaderboard.length;
          const rewards = calculateRewards(rewardLeaderboard, WEEKLY_REWARDS);
          const result = await distributeRewards(rewards);

          await markDistributed(weekKey, 'weekly', {
            eventWeekId,
            totalParticipants,
            winnersCount: rewards.length,
            ...result
          });

          console.log(`✅ Weekly rewards distributed: ${result.distributed} winners, ${result.totalScans} total scans`);
        } else {
          await markDistributed(weekKey, 'weekly', { eventWeekId, totalParticipants: 0, winnersCount: 0, totalScans: 0 });
          console.log(`📅 No weekly event entries for ${eventWeekId}`);
        }
      }
    } catch (error) {
      console.error('❌ Weekly reward distribution failed:', error);
    }
  }

  // --- ARENA REWARDS (Monday at midnight) ---
  if (utcDay === 1) { // Monday
    try {
      // Get last week's arena key
      const lastWeek = new Date(now);
      lastWeek.setUTCDate(lastWeek.getUTCDate() - 1);
      const weekKey = `arena-${lastWeek.getUTCFullYear()}-W${String(Math.ceil((lastWeek.getTime() - new Date(lastWeek.getUTCFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))).padStart(2, '0')}`;

      if (!(await wasDistributed(weekKey, 'arena'))) {
        console.log(`⚔️ Distributing ARENA rewards for ${weekKey}...`);

        const { entries, totalEntries } = await getWeeklyLeaderboard(null, 100);

        if (entries && entries.length > 0) {
          // Transform arena entries to match reward format
          const leaderboard = entries.map((e, i) => ({
            userId: e.userId?.replace?.('...', '') || e.odlUserId || `user_${i}`,
            score: e.points,
            rank: i + 1
          }));

          const rewards = calculateRewards(leaderboard, ARENA_REWARDS);
          const result = await distributeRewards(rewards);

          await markDistributed(weekKey, 'arena', {
            totalEntries,
            winnersCount: rewards.length,
            ...result
          });

          console.log(`✅ Arena rewards distributed: ${result.distributed} winners, ${result.totalScans} total scans`);
        } else {
          await markDistributed(weekKey, 'arena', { totalEntries: 0, winnersCount: 0, totalScans: 0 });
          console.log(`⚔️ No arena entries for ${weekKey}`);
        }
      }
    } catch (error) {
      console.error('❌ Arena reward distribution failed:', error);
    }
  }

  console.log(`\n🎁 Reward distribution check complete\n`);
}

// Check every minute for midnight UTC
setInterval(checkAndDistributeRewards, 60 * 1000);

// Also run once on startup (in case server restarted right after midnight)
setTimeout(checkAndDistributeRewards, 5000);

console.log('🎁 Reward distribution scheduler initialized (checks every minute for midnight UTC)');

export default app;
