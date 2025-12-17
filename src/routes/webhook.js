import express from 'express';
import Stripe from 'stripe';
import { config } from '../config/index.js';
import { addProEmail, removeProEmail } from '../middleware/proEmailStore.js';
import { addProRoast } from '../middleware/referralStore.js';

const router = express.Router();

// Initialize Stripe (only if key is configured)
const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey)
  : null;

// Product identifiers for routing (set in Stripe dashboard metadata or by price)
const PRO_ROAST_PRICE = 99; // $0.99 in cents
const PRO_WEEKLY_PRICE = 299; // $2.99 in cents

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

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const email = session.customer_email || session.customer_details?.email;
      const amount = session.amount_total;
      const mode = session.mode; // 'payment' for one-time, 'subscription' for recurring
      const userId = session.metadata?.userId || session.client_reference_id;

      console.log('✅ Payment successful:', session.id);
      console.log('   Customer email:', email);
      console.log('   Amount:', amount / 100, 'Mode:', mode);
      console.log('   User ID:', userId);

      // Differentiate between Pro Roast ($0.99 one-time) and Pro subscription
      if (mode === 'payment' && amount === PRO_ROAST_PRICE) {
        // One-time Pro Roast purchase
        console.log('🔥 Pro Roast purchased!');

        if (userId) {
          addProRoast(userId);
          console.log(`   Added Pro Roast to user: ${userId}`);
        } else if (email) {
          // Fallback: use email as userId (less reliable)
          addProRoast(email);
          console.log(`   Added Pro Roast to email: ${email}`);
        } else {
          console.warn('⚠️ No userId or email found for Pro Roast');
        }
      } else {
        // Pro subscription or higher amount = add to Pro email store
        console.log('⚡ Pro subscription activated!');

        if (email) {
          addProEmail(email);
        } else {
          console.warn('⚠️ No email found in checkout session');
        }
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
          removeProEmail(email);
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

  res.status(200).json({ received: true });
});

export default router;
