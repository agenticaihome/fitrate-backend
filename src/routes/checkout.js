import express from 'express';
import Stripe from 'stripe';
import { config } from '../config/index.js';

const router = express.Router();

// Initialize Stripe
const stripe = config.stripe.secretKey
    ? new Stripe(config.stripe.secretKey)
    : null;

// Price IDs from Stripe Dashboard
// You need to create these products in Stripe:
// 1. Pro Weekly - $2.99/week recurring
// 2. Pro Roast - $0.99 one-time
const PRICES = {
    proWeekly: process.env.STRIPE_PRO_WEEKLY_PRICE_ID,       // $2.99/week
    proRoast: process.env.STRIPE_PRO_ROAST_PRICE_ID,         // $0.99 one-time
};

/**
 * Create Stripe Checkout Session
 * POST /api/checkout/create-session
 * Body: { product: 'proWeekly' | 'proRoast', userId: string }
 */
router.post('/create-session', async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }

    const { product, userId, email } = req.body;

    if (!product || !PRICES[product]) {
        return res.status(400).json({ error: 'Invalid product' });
    }

    const priceId = PRICES[product];

    if (!priceId) {
        return res.status(500).json({
            error: `Price ID not configured for ${product}. Set STRIPE_PRO_${product.toUpperCase()}_PRICE_ID environment variable.`
        });
    }

    const isSubscription = product !== 'proRoast';

    try {
        const session = await stripe.checkout.sessions.create({
            mode: isSubscription ? 'subscription' : 'payment',
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: `${req.headers.origin || 'https://fitrate.app'}/?success=true`,
            cancel_url: `${req.headers.origin || 'https://fitrate.app'}/?canceled=true`,
            customer_email: email || undefined,
            client_reference_id: userId,
            metadata: {
                userId: userId,
                product: product,
            },
            // For subscriptions, allow promotion codes
            allow_promotion_codes: isSubscription,
        });

        res.json({ url: session.url, sessionId: session.id });
    } catch (error) {
        console.error('Stripe checkout error:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

export default router;
