import express from 'express';
import Stripe from 'stripe';
import { config } from '../config/index.js';
import { EntitlementService } from '../services/entitlements.js';
import { IdempotencyService } from '../services/idempotency.js';
import { addProRoast, addPurchasedScans } from '../middleware/referralStore.js';
import { redis, isRedisAvailable } from '../services/redisClient.js';

const router = express.Router();

// Initialize Stripe (only if key is configured)
const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey)
  : null;

// Product identifiers for routing (set in Stripe dashboard metadata or by price)
const PRO_ROAST_PRICE = 99; // $0.99 in cents
const PRO_WEEKLY_PRICE = 299; // $2.99 in cents

// Email→UserId mapping prefix for recovery
const EMAIL_USER_MAP_PREFIX = 'fitrate:email:user:';

/**
 * Link email to userId for purchase recovery
 * Stores bidirectional mapping so user can recover via email
 */
async function linkEmailToUser(email, userId) {
  if (!email || !userId) return;

  const normalizedEmail = email.toLowerCase().trim();

  if (isRedisAvailable()) {
    // Store email→userId mapping (never expires)
    await redis.set(`${EMAIL_USER_MAP_PREFIX}${normalizedEmail}`, userId);
    // Also store userId→email for reference
    await redis.set(`fitrate:user:email:${userId}`, normalizedEmail);
    console.log(`🔗 Linked email ${normalizedEmail.slice(0, 3)}***@*** to user ${userId.slice(0, 8)}...`);
  }
}

/**
 * Get userId by email for recovery
 */
async function getUserIdByEmail(email) {
  if (!email) return null;

  const normalizedEmail = email.toLowerCase().trim();

  if (isRedisAvailable()) {
    return await redis.get(`${EMAIL_USER_MAP_PREFIX}${normalizedEmail}`);
  }
  return null;
}

router.post('/', async (req, res) => {
  if (!stripe) {
    console.log('Stripe not configured, skipping webhook');
    return res.status(200).json({ received: true });
  }

  const sig = req.headers['stripe-signature'];

  if (!sig || !config.stripe.webhookSecret) {
    return res.status(400).json({ error: 'Missing signature or webhook secret' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      config.stripe.webhookSecret
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // IDEMPOTENCY CHECK: Prevent duplicate processing (hardening)
  const processed = await IdempotencyService.hasProcessed(event.id);
  if (processed) {
    console.log(`Event ${event.id} already processed. Skipping.`);
    return res.status(200).send({ received: true });
  }

  // Filter: Only process FitRate events (skip HoopLog/DentDx/other app events)
  // FitRate events have: userId, product_type, scans, product metadata
  // HoopLog events have: flow="new_coach_registration", team_id, team_name
  // DentDx events have: supabase_user_id, plan, one_time_purchase
  const eventMetadata = event.data?.object?.metadata || {};
  
  const isOtherAppEvent = 
    eventMetadata.flow === 'new_coach_registration' || 
    eventMetadata.team_id || 
    eventMetadata.team_name ||
    eventMetadata.supabase_user_id ||
    eventMetadata.plan ||
    eventMetadata.one_time_purchase === 'true';

  if (isOtherAppEvent) {
    console.log(`Skipping non-FitRate event ${event.id} (${event.type}) - belongs to another app`);
    return res.status(200).json({ received: true, skipped: 'not_fitrate' });
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const email = session.customer_email || session.customer_details?.email;
      const amount = session.amount_total;
      const mode = session.mode; // 'payment' for one-time, 'subscription' for recurring
      const userId = session.metadata?.userId || session.client_reference_id;

      // SECURITY: Mask PII in logs
      const maskedEmail = email ? `${email.slice(0, 3)}***@${email.split('@')[1] || '***'}` : 'none';
      const maskedUserId = userId ? `${userId.slice(0, 8)}...` : 'none';

      console.log(`✅ Payment: ${session.id} | $${amount / 100} | ${mode} | user:${maskedUserId}`);

      // CRITICAL: Link email to userId for recovery (do this for ALL purchases)
      if (email && userId) {
        await linkEmailToUser(email, userId);
      }

      // Differentiate between product types
      if (mode === 'payment') {
        // One-time purchases (scan packs)
        const targetUserId = userId || email;

        if (!targetUserId) {
          console.warn('⚠️ No userId or email found for purchase');
          break;
        }

        // Get product info from metadata (preferred) or fallback to amount-based lookup
        const productType = session.metadata?.product_type;
        const productName = session.metadata?.product || 'unknown';
        
        // PREFERRED: Read scans directly from metadata (set by checkout route)
        let scansAdded = session.metadata?.scans ? parseInt(session.metadata.scans, 10) : 0;

        // FALLBACK: Amount-based lookup for legacy/external purchases
        if (!scansAdded) {
          const SCAN_PACK_AMOUNTS = {
            99: productType === 'impulse_pack' ? 3 : 10,  // $0.99 = Impulse (3) or First-Time (10)
            299: 10,   // Starter Pack: $2.99 = 10 scans
            499: 25,   // Popular Pack: $4.99 = 25 scans
            699: 50,   // Value Pack: $6.99 = 50 scans
            999: 100,  // Mega Pack: $9.99 = 100 scans
          };
          scansAdded = SCAN_PACK_AMOUNTS[amount] || 0;
        }

        if (scansAdded > 0) {
          await addPurchasedScans(targetUserId, scansAdded);
          console.log(`📦 ${productName}: ${scansAdded} scans for $${amount / 100}`);
        } else {
          console.log(`⚠️ Unknown one-time purchase: $${amount / 100} | product:${productName}`);
        }

        // BACKUP: Also store scans under email if available (for double recovery)
        if (email && scansAdded > 0 && email !== targetUserId) {
          await addPurchasedScans(email.toLowerCase(), scansAdded);
          console.log(`   💾 Backup: Also added ${scansAdded} scans to email: ${maskedEmail}`);
        }

        console.log(`   ✅ Added ${scansAdded} scans to user: ${maskedUserId}`);
      } else {
        // Pro subscription = add to Pro entitlement store
        console.log(`⚡ Pro subscription activated! userId:${maskedUserId} email:${maskedEmail}`);

        // CRITICAL FIX: Grant Pro to BOTH userId and email
        // This ensures the user gets access immediately even if they are anonymous or using a different email
        await EntitlementService.grantPro(userId, email, 'stripe_subscription');
      }

      break;
    }

    case 'customer.subscription.created': {
      const subscription = event.data.object;
      console.log('✅ New subscription:', subscription.id);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      console.log('❌ Subscription canceled:', subscription.id);

      // Get customer email and remove Pro status
      try {
        const customer = await stripe.customers.retrieve(subscription.customer);
        const email = customer.email;
        if (email) {
          await EntitlementService.revokePro(email);
          console.log(`   Pro status removed for: ${email}`);
        } else {
          console.warn('⚠️ No email found for canceled subscription');
        }
      } catch (err) {
        console.error('Error handling subscription cancellation:', err.message);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log('⚠️ Payment failed:', invoice.id);
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  // Mark event as processed cleanly
  await IdempotencyService.markProcessed(event.id);

  res.status(200).json({ received: true });
});

export default router;
