import express from 'express';
import rateLimit from 'express-rate-limit';
import { analyzeWithGemini } from '../services/geminiAnalyzer.js';
import { analyzeOutfit as analyzeWithOpenAI } from '../services/outfitAnalyzer.js';
import { scanLimiter, incrementScanSimple, decrementScanSimple, getScanCount, getScanCountSecure, LIMITS, getProStatus, trackInvalidAttempt, isBlockedForInvalidAttempts } from '../middleware/scanLimiter.js';
import { getReferralStats, consumeProRoast, hasProRoast, consumePurchasedScan, getPurchasedScans } from '../middleware/referralStore.js';
import { getImageHash, getCachedResult, cacheResult } from '../services/imageHasher.js';
import { redis, isRedisAvailable } from '../services/redisClient.js';
import { validateAndSanitizeImage, quickImageCheck } from '../utils/imageValidator.js';
import { ERROR_MESSAGES, MODE_CONFIGS } from '../config/systemPrompt.js';
import { getActiveEvent, recordEventScore, canFreeUserSubmit, canProUserSubmit } from '../services/eventService.js';
import { sanitizeAIResponse, checkEventFreezeWindow } from '../utils/contentSanitizer.js';
import { recordScan, getStreakDisplay, getMilestoneInfo } from '../middleware/streakStore.js';
import { recordScore as recordLeaderboardScore, recordDailyChallengeScore } from './leaderboard.js';
import { hasEnteredToday as hasEnteredDailyChallenge } from '../services/dailyChallengeService.js';
import { generateCardDNA } from '../services/cardDNA.js';

const router = express.Router();

// Rate limiter for Pro Roast - expensive OpenAI calls
const proRoastLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // 3 pro roasts per minute per IP
  message: {
    success: false,
    error: 'Too many Pro Roast requests. Please wait a moment.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for status checks (prevent enumeration)
const statusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 status checks per minute
  message: { error: 'Too many requests' },
});

// Check remaining scans + Pro Roasts
// FIXED: Use same identity logic as /analyze to prevent inconsistent counts
router.get('/status', statusLimiter, async (req, res) => {
  const ip = req.ip || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || 'unknown';
  const userId = req.query.userId;
  const isPro = await getProStatus(userId, ip);
  const limit = isPro ? LIMITS.pro : LIMITS.free;

  // FIXED: Use secure count (same identity as /analyze)
  const used = await getScanCountSecure(req);
  const stats = userId ? await getReferralStats(userId) : { proRoasts: 0, totalReferrals: 0 };

  res.json({
    scansUsed: used,
    scansLimit: limit,
    scansRemaining: Math.max(0, limit - used),
    isPro,
    proRoasts: stats.proRoasts,
    referrals: stats.totalReferrals,
    purchasedScansRemaining: userId ? await getPurchasedScans(userId) : 0
  });
});

// Feedback endpoint - collect ratings for AI improvement
router.post('/feedback', async (req, res) => {
  const { resultId, rating, comment, userId } = req.body;

  if (!resultId || !rating) {
    return res.status(400).json({ success: false, error: 'Result ID and rating required' });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, error: 'Rating must be 1-5' });
  }

  // SECURITY: Sanitize user-provided text to prevent XSS
  const sanitizeString = (str) => {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .slice(0, 500); // Limit length
  };

  const feedback = {
    resultId: sanitizeString(resultId),
    rating: Math.min(5, Math.max(1, parseInt(rating) || 3)),
    comment: sanitizeString(comment),
    userId: sanitizeString(userId) || 'anonymous',
    ts: Date.now()
  };

  if (isRedisAvailable()) {
    await redis.lpush('fitrate:feedback:ratings', JSON.stringify(feedback));
    // Keep last 1000 ratings
    await redis.ltrim('fitrate:feedback:ratings', 0, 999);
  }

  console.log(`📝 Feedback received: ${feedback.rating}/5 for ${feedback.resultId.slice(0, 20)}`);
  res.json({ success: true, message: 'Thanks for the feedback!' });
});

// Use a Pro Roast (from referral or $0.99 purchase) - uses OpenAI
router.post('/pro-roast', proRoastLimiter, async (req, res) => {
  const requestId = `proroast_${Date.now()}`;
  const { image, roastMode, userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'User ID required' });
  }

  if (!image) {
    return res.status(400).json({ success: false, error: 'No image provided' });
  }

  // Check if user has a Pro Roast
  const hasRoast = await hasProRoast(userId);
  if (!hasRoast) {
    return res.status(403).json({
      success: false,
      error: 'No Pro Roasts available',
      needsProRoast: true
    });
  }

  try {
    console.log(`[${requestId}] Pro Roast requested by ${userId}`);

    const stats = await getReferralStats(userId);
    const securityContext = {
      userId,
      scansUsed: 0, // Pro roasts are separate from daily scans
      dailyLimit: stats.proRoasts || 1,
      referralExtrasEarned: 0,
      authTokenValid: true,
      suspiciousFlag: false
    };

    // TEMPORARY: Use Gemini for all scans - Pro/GPT-4o will be configured later
    // TODO: Re-enable OpenAI for Pro Roasts when ready:
    // const result = await analyzeWithOpenAI(image, {
    const result = await analyzeWithGemini(image, {
      mode: 'savage',
      roastMode: true,
      occasion: null,
      securityContext
    });

    if (result.success) {
      // Consume the Pro Roast
      await consumeProRoast(userId);
      const stats = await getReferralStats(userId);
      console.log(`[${requestId}] Pro Roast consumed - ${stats.proRoasts} remaining`);

      result.proRoastsRemaining = stats.proRoasts;
      result.isProRoast = true;
    }

    return res.json(result);
  } catch (error) {
    console.error(`[${requestId}] Pro Roast error:`, error);
    return res.status(500).json({ success: false, error: 'Pro Roast failed. Please try again.' });
  }
});

// Consume a scan (for free users - no AI call, just tracks usage by userId)
router.post('/consume', scanLimiter, async (req, res) => {
  const { userId, ip, limit, isPro, usedBonus } = req.scanInfo;

  let newCount;
  if (usedBonus) {
    newCount = await getScanCount(userId, ip);
  } else {
    newCount = await incrementScanCount(userId, ip);
  }

  const stats = userId ? await getReferralStats(userId) : { proRoasts: 0 };

  res.json({
    success: true,
    scanInfo: {
      scansUsed: newCount,
      scansLimit: limit,
      scansRemaining: Math.max(0, limit - newCount),
      isPro,
      usedBonus,
      proRoasts: stats.proRoasts
    }
  });
});

// Main analyze endpoint with rate limiting
router.post('/', scanLimiter, async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    console.log(`[${requestId}] POST /api/analyze - IP: ${req.ip || 'unknown'}`);
    const { image, roastMode, mode: modeParam, occasion, eventMode, imageThumb, dailyChallenge } = req.body;
    // Support both new mode string and legacy roastMode boolean
    const mode = modeParam || (roastMode ? 'roast' : 'nice');

    // Debug: trace thumbnail in event mode
    if (eventMode) {
      console.log(`[${requestId}] Event mode submission - imageThumb: ${imageThumb ? `${Math.round(imageThumb.length / 1024)}KB` : 'NOT PROVIDED'}`);
    }

    // SECURITY: Validate mode exists
    const modeConfig = MODE_CONFIGS[mode];
    if (!modeConfig) {
      console.log(`[${requestId}] Error: Invalid mode - ${mode}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid mode. Use: nice, roast, honest, or savage.'
      });
    }

    // TEMPORARY: All modes available via Gemini - Pro tier check disabled
    // TODO: Re-enable when Pro/GPT-4o subscriptions are configured:
    // const isPro = req.scanInfo?.isPro;
    // const hasPurchasedScans = req.scanInfo?.userId ? await getPurchasedScans(req.scanInfo.userId) > 0 : false;
    // const hasProAccess = isPro || hasPurchasedScans;
    // if (modeConfig.tier === 'pro' && !hasProAccess) {
    //   console.log(`[${requestId}] Error: Pro-only mode requested by free user - ${mode}`);
    //   return res.status(403).json({
    //     success: false,
    //     error: ERROR_MESSAGES.mode_restricted,
    //     code: 'PRO_MODE_REQUIRED'
    //   });
    // }
    const isPro = req.scanInfo?.isPro; // Keep for other logic that uses isPro

    // DAILY CHALLENGE: Check if user already entered today
    // Daily challenge is free for all, mode MUST be "nice", one entry per day
    if (dailyChallenge) {
      const userId = req.scanInfo?.userId || req.body.userId;
      if (!userId) {
        console.log(`[${requestId}] Error: Daily challenge requires userId`);
        return res.status(400).json({
          success: false,
          error: 'User ID required for daily challenge',
          code: 'DAILY_CHALLENGE_USER_REQUIRED'
        });
      }

      // Check if already entered today
      const alreadyEntered = await hasEnteredDailyChallenge(userId);
      if (alreadyEntered) {
        console.log(`[${requestId}] User ${userId.slice(0, 12)}... already entered daily challenge today`);
        return res.json({
          success: false,
          error: 'already_entered',
          message: "You've already entered today's challenge. Come back tomorrow!"
        });
      }

      // Daily challenge accepts any of the 8 rotating modes
      // Frontend calculates: MODES[dayOfYear % 8] where MODES = ['nice','roast','honest','savage','rizz','celeb','aura','chaos']
      const validDailyChallengeModes = ['nice', 'roast', 'honest', 'savage', 'rizz', 'celeb', 'aura', 'chaos'];
      if (!validDailyChallengeModes.includes(mode)) {
        console.log(`[${requestId}] Daily challenge invalid mode: ${mode}`);
        return res.status(400).json({
          success: false,
          error: 'Invalid mode for daily challenge',
          code: 'DAILY_CHALLENGE_MODE_INVALID'
        });
      }
    }

    if (!image) {
      console.log(`[${requestId}] Error: No image provided`);
      return res.status(400).json({
        success: false,
        error: 'No image provided'
      });
    }

    // SECURITY: Check if user is blocked for spamming invalid images
    const isBlocked = await isBlockedForInvalidAttempts(req);
    if (isBlocked) {
      console.warn(`[${requestId}] BLOCKED: Too many invalid image attempts`);
      return res.status(429).json({
        success: false,
        error: 'Too many failed attempts. Please wait an hour and try again with a valid outfit photo.',
        code: 'INVALID_SPAM_BLOCKED'
      });
    }

    // SECURITY: Quick check before expensive validation
    if (!quickImageCheck(image)) {
      console.log(`[${requestId}] Error: Quick image check failed`);
      return res.status(400).json({
        success: false,
        error: 'Invalid image. Please use JPEG, PNG, or WebP under 10MB.'
      });
    }

    // SECURITY: Full image validation with MIME check and EXIF stripping
    const validation = await validateAndSanitizeImage(image);
    if (!validation.valid) {
      console.log(`[${requestId}] Error: Image validation failed - ${validation.error}`);
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    // Use sanitized image (EXIF stripped, validated)
    const sanitizedImage = validation.sanitizedImage;
    console.log(`[${requestId}] Image validated: ${validation.width}x${validation.height} (${validation.originalType})`);

    // Image hash for caching (prevents duplicate API calls)
    const imageHash = await getImageHash(sanitizedImage);
    const cacheKey = `${imageHash}:${mode}:${occasion || 'none'}`;

    // Check cache first
    const cachedResult = await getCachedResult(cacheKey);
    if (cachedResult) {
      console.log(`[${requestId}] Cache hit - returning cached result`);

      // Scan was already counted in middleware (atomic increment)
      // Just use the current count from scanInfo
      if (cachedResult.success) {
        const { limit, isPro, currentCount } = req.scanInfo;
        cachedResult.scanInfo = {
          scansUsed: currentCount,
          scansLimit: limit,
          scansRemaining: Math.max(0, limit - currentCount),
          isPro,
          cached: true
        };
      } else {
        // Failed result in cache - rollback the scan we incremented
        console.warn(`[${requestId}] WARNING: Failed result found in cache, rolling back scan`);
        if (req.scanInfo?.scanIncremented) {
          await decrementScanSimple(req.scanInfo.userId);
        }
        const currentCount = req.scanInfo.currentCount - 1;
        cachedResult.scanInfo = {
          scansUsed: Math.max(0, currentCount),
          scansLimit: req.scanInfo.limit,
          scansRemaining: Math.max(0, req.scanInfo.limit - currentCount),
          isPro: req.scanInfo.isPro,
          cached: true
        };
      }
      return res.json(cachedResult);
    }

    // Gather security context for AI gatekeeper
    const stats = req.scanInfo.userId ? await getReferralStats(req.scanInfo.userId) : { totalReferrals: 0 };
    const securityContext = {
      userId: req.scanInfo.userId || 'anonymous',
      scansUsed: req.scanInfo.currentCount || 0,
      dailyLimit: req.scanInfo.limit || 2,
      referralExtrasEarned: (stats.totalReferrals || 0) * 2, // 2 extra per referral
      authTokenValid: !!req.scanInfo.userId,
      suspiciousFlag: false // Backend middleware already handles this, but AI acts as backup
    };

    // TEMPORARY: All scans use Gemini (free tier) - Pro/GPT-4o will be configured later
    // TODO: Re-enable Pro routing when ready:
    // const purchasedScans = req.scanInfo?.userId ? await getPurchasedScans(req.scanInfo.userId) : 0;
    // const isProTier = isPro || purchasedScans > 0;
    // const useOpenAI = isProTier;
    const useOpenAI = false; // Force Gemini for all scans
    const analyzer = useOpenAI ? analyzeWithOpenAI : analyzeWithGemini;
    const serviceName = 'Gemini Flash';
    console.log(`[${requestId}] Using ${serviceName} [FREE]`);

    // Fetch event context if user opted into event mode
    let eventContext = null;
    if (eventMode) {
      // FREEMIUM: Check entry limits for both free and pro users
      let canSubmitToEvent = false;

      if (isPro) {
        // PRO: Check weekly limit (5/week)
        const proEntryStatus = await canProUserSubmit(req.scanInfo.userId);
        canSubmitToEvent = proEntryStatus.canSubmit;
        if (!canSubmitToEvent) {
          console.log(`[${requestId}] Pro user weekly event entries exhausted (${proEntryStatus.entriesUsed}/${proEntryStatus.entriesLimit})`);
        }
      } else {
        // FREE: Check weekly limit (1/week)
        const freeEntryStatus = await canFreeUserSubmit(req.scanInfo.userId);
        canSubmitToEvent = freeEntryStatus.canSubmit;
        if (!canSubmitToEvent) {
          console.log(`[${requestId}] Free user weekly entry exhausted`);
        }
      }

      if (canSubmitToEvent) {
        try {
          const event = await getActiveEvent();
          eventContext = {
            theme: event.theme,
            themeDescription: event.themeDescription,
            themeEmoji: event.themeEmoji,
            weekId: event.weekId
          };
          console.log(`[${requestId}] Event mode active - theme: ${event.theme} (isPro: ${isPro})`);
        } catch (e) {
          console.warn(`[${requestId}] Failed to fetch event: ${e.message}`);
        }
      } else {
        console.log(`[${requestId}] Event mode denied - no entries available`);
      }
    }

    let result = await analyzer(sanitizedImage, {
      mode: mode,
      roastMode: mode === 'roast',
      occasion: occasion || null,
      securityContext,
      eventContext
    });

    // SECURITY: Validate AI response structure
    if (result.success && result.scores) {
      // Ensure scores are within expected ranges
      if (result.scores.overall < 0 || result.scores.overall > 100) {
        console.warn(`[${requestId}] SECURITY: Suspicious AI score: ${result.scores.overall}`);
        result.scores.overall = Math.min(100, Math.max(0, result.scores.overall));
      }
    }

    // SECURITY: Sanitize AI output for banned terms (body, weight, attractiveness)
    if (result.success) {
      const { sanitized, hadViolations, logEntry } = sanitizeAIResponse(result);
      if (hadViolations) {
        console.warn(`[${requestId}] SECURITY: AI output sanitized for banned content`, logEntry);
        // Log to Redis for monitoring (silently)
        if (isRedisAvailable()) {
          await redis.lpush('fitrate:security:sanitized', JSON.stringify({
            requestId,
            ...logEntry
          }));
          await redis.ltrim('fitrate:security:sanitized', 0, 999); // Keep last 1000
        }
      }
      result = sanitized;
    }

    // Only cache on successful analysis (scan already counted in middleware)
    if (result.success) {
      const { limit, isPro, currentCount } = req.scanInfo;
      // Note: Scan was already incremented atomically in scanLimiter middleware

      console.log(`[${requestId}] ✅ Success - Scan count: ${currentCount}/${limit} (isPro: ${isPro})`);

      // OVERFLOW MODEL: If using purchased scan, consume it
      let purchasedScansRemaining = req.scanInfo.purchasedScansRemaining || 0;
      let usedPurchasedScan = false;
      if (req.scanInfo.usePurchasedScan) {
        await consumePurchasedScan(req.scanInfo.userId);
        purchasedScansRemaining = Math.max(0, purchasedScansRemaining - 1);
        usedPurchasedScan = true;
        console.log(`[${requestId}] 💰 Consumed purchased scan - ${purchasedScansRemaining} remaining`);
      }

      // Cache the result for future duplicate requests
      await cacheResult(cacheKey, result);

      // Add result ID for feedback
      result.resultId = requestId;

      // 🎨 CARD DNA: Generate unique visual DNA for this results card
      // Ensures no two cards ever look identical (13,824+ unique combinations)
      // Note: Will be regenerated after streak is recorded to include streak context
      const dnaTimestamp = Date.now();
      try {
        // Get current streak count (may be updated below)
        const currentStreak = result.streak?.current || 0;

        const cardDNA = generateCardDNA({
          cardId: requestId,
          mode: mode,
          score: result.scores.overall,
          timestamp: dnaTimestamp,
          streak: currentStreak
        });
        result.cardDNA = cardDNA;
        console.log(`[${requestId}] 🎨 Card DNA: ${cardDNA.signature} (${cardDNA.timeContext.period}/${cardDNA.streakContext.tier})`);
      } catch (dnaError) {
        console.warn(`[${requestId}] Card DNA generation failed:`, dnaError.message);
        // Non-blocking - card will render with defaults if DNA fails
      }

      // Add scan info to response (includes purchased scan balance)
      result.scanInfo = {
        scansUsed: currentCount,
        scansLimit: limit,
        scansRemaining: Math.max(0, limit - currentCount),
        isPro,
        purchasedScansRemaining,
        usedPurchasedScan
      };

      // Record score for event leaderboard if in event mode
      if (eventContext && result.scores?.overall) {
        // SECURITY: Check freeze window (last 5 min of week)
        const freezeStatus = checkEventFreezeWindow();
        if (freezeStatus.frozen) {
          console.log(`[${requestId}] Event frozen: ${freezeStatus.reason}`);
          result.eventStatus = { action: 'frozen', message: freezeStatus.reason };
        } else {
          try {
            const eventResult = await recordEventScore(
              req.scanInfo.userId,
              result.scores.overall,
              result.scores.themeCompliant ?? true,
              isPro,
              imageThumb  // Pass thumbnail for top-5 storage
            );
            result.eventStatus = eventResult;
            console.log(`[${requestId}] Event score recorded: ${result.scores.overall} (${eventResult.action})`);
          } catch (e) {
            console.warn(`[${requestId}] Failed to record event score: ${e.message}`);
          }
        }

        // Include event theme data in response so frontend can display the challenge card
        result.eventInfo = {
          theme: eventContext.theme,
          themeDescription: eventContext.themeDescription,
          themeEmoji: eventContext.themeEmoji,
          weekId: eventContext.weekId
        };
      }

      // 🔥 STREAK SYSTEM: Record successful scan and update streak
      try {
        const userId = req.scanInfo?.userId;
        if (userId) {
          const streakResult = await recordScan(userId);
          const display = getStreakDisplay(streakResult.currentStreak);
          const milestone = streakResult.isMilestone ? getMilestoneInfo(streakResult.currentStreak) : null;

          result.streak = {
            current: streakResult.currentStreak,
            max: streakResult.maxStreak,
            total: streakResult.totalScans,
            isNewStreak: streakResult.isNewStreak,
            isMilestone: streakResult.isMilestone,
            milestone,
            ...display
          };
          console.log(`[${requestId}] 🔥 Streak: ${streakResult.currentStreak} days${streakResult.isMilestone ? ' (MILESTONE!)' : ''}`);

          // 🎨 REGENERATE Card DNA with actual streak value for streak-influenced visuals
          if (streakResult.currentStreak > 0) {
            try {
              const cardDNA = generateCardDNA({
                cardId: requestId,
                mode: mode,
                score: result.scores.overall,
                timestamp: dnaTimestamp,
                streak: streakResult.currentStreak
              });
              result.cardDNA = cardDNA;
              console.log(`[${requestId}] 🎨 Card DNA (with streak): ${cardDNA.signature} (${cardDNA.timeContext.period}/${cardDNA.streakContext.tier})`);
            } catch (e) {
              // Keep previous DNA if regeneration fails
            }
          }
        }
      } catch (streakError) {
        console.warn(`[${requestId}] Streak recording failed:`, streakError.message);
        // Non-blocking - don't fail the scan if streak fails
      }

      // 🏆 LEADERBOARD: Record to Today's Top Fits (global leaderboard)
      try {
        const userId = req.scanInfo?.userId;
        if (userId && result.scores?.overall) {
          const leaderboardResult = await recordLeaderboardScore(userId, result.scores.overall);
          if (leaderboardResult?.recorded) {
            result.leaderboard = {
              rank: leaderboardResult.rank,
              title: leaderboardResult.title,
              description: leaderboardResult.description
            };
            console.log(`[${requestId}] 🏆 Leaderboard: rank #${leaderboardResult.rank}`);
          }
        }
      } catch (leaderboardError) {
        console.warn(`[${requestId}] Leaderboard recording failed:`, leaderboardError.message);
        // Non-blocking - don't fail the scan if leaderboard fails
      }

      // 🎯 DAILY CHALLENGE: Record score if this is a daily challenge submission
      if (dailyChallenge && result.scores?.overall) {
        try {
          const userId = req.scanInfo?.userId || req.body.userId;
          const dailyChallengeResult = await recordDailyChallengeScore(userId, result.scores.overall, {
            tagline: result.scores.tagline || null,
            imageThumb: imageThumb || null
          });

          if (dailyChallengeResult.success) {
            result.dailyChallengeRank = dailyChallengeResult.rank;
            result.dailyChallengeMessage = dailyChallengeResult.message;
            result.dailyChallenge = {
              rank: dailyChallengeResult.rank,
              score: dailyChallengeResult.score,
              totalParticipants: dailyChallengeResult.totalParticipants,
              title: dailyChallengeResult.title,
              message: dailyChallengeResult.message
            };
            console.log(`[${requestId}] 🎯 Daily Challenge: rank #${dailyChallengeResult.rank}/${dailyChallengeResult.totalParticipants}`);
          } else {
            // This shouldn't happen since we checked already, but handle gracefully
            console.warn(`[${requestId}] Daily challenge recording failed: ${dailyChallengeResult.error}`);
          }
        } catch (dailyChallengeError) {
          console.warn(`[${requestId}] Daily challenge error:`, dailyChallengeError.message);
          // Non-blocking - don't fail the scan
        }
      }
    } else {
      console.log(`[${requestId}] ❌ Analysis failed: ${result.error}`);

      // ATOMIC ROLLBACK: Decrement the scan we incremented in middleware
      if (req.scanInfo?.scanIncremented) {
        await decrementScanSimple(req.scanInfo.userId);
        console.log(`[${requestId}] 🔄 Scan decremented (rollback for failed analysis)`);
      }

      // Get fresh count after decrement
      const currentCount = req.scanInfo?.currentCount ? req.scanInfo.currentCount - 1 : 0;
      const { limit, isPro } = req.scanInfo;

      // Add scan info to show user they didn't lose a scan
      result.scanInfo = {
        scansUsed: Math.max(0, currentCount),
        scansLimit: limit,
        scansRemaining: Math.max(0, limit - currentCount),
        isPro,
        scanNotCounted: true  // Flag to indicate this failure didn't consume a scan
      };

      console.log(`[${requestId}] ℹ️  Scan NOT counted - User still has ${limit - currentCount}/${limit} scans remaining`);

      // SECURITY: Track invalid image attempts to prevent spam abuse
      // This includes non-outfit images (selfies, random objects, etc.)
      const invalidTrack = await trackInvalidAttempt(req);
      console.log(`[${requestId}] Invalid attempt #${invalidTrack.count} (blocked: ${invalidTrack.blocked})`);

      if (invalidTrack.blocked) {
        result.error = 'Too many failed attempts. Please wait and try again with a valid outfit photo.';
      }
    }

    return res.json(result);
  } catch (error) {
    console.error(`[${requestId}] Analyze route error:`, {
      message: error.message,
      stack: error.stack
    });

    // ATOMIC ROLLBACK: Decrement scan on server error
    if (req.scanInfo?.scanIncremented) {
      await decrementScanSimple(req.scanInfo.userId);
      console.log(`[${requestId}] 🔄 Scan decremented (rollback for server error)`);
    }

    return res.status(500).json({
      success: false,
      error: 'Server error. Please try again.'
    });
  }
});

export default router;
