import express from 'express';
import Stripe from 'stripe';
import { config } from '../config/index.js';

const router = express.Router();

// Initialize Stripe (only if key is configured)
const stripe = config.stripe.secretKey 
  ? new Stripe(config.stripe.secretKey) 
  : null;

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
      console.log('✅ Payment successful:', session.id);
      console.log('   Customer email:', session.customer_email);
      console.log('   Amount:', session.amount_total / 100);
      
      // TODO: Add user to your database as Pro
      // await db.users.update({ email: session.customer_email }, { isPro: true });
      
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
      
      // TODO: Remove Pro status
      // await db.users.update({ stripeCustomerId: subscription.customer }, { isPro: false });
      
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
