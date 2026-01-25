import express from 'express';
import Stripe from 'stripe';
import { config } from '../config/index.js';

const router = express.Router();

// Initialize Stripe
const stripe = config.stripe.secretKey
    ? new Stripe(config.stripe.secretKey)
    : null;

/**
 * Product Catalog - Single Source of Truth
 * 
 * Two approaches:
 * 1. Use price_data (inline) - prices defined here, no Stripe Dashboard setup needed
 * 2. Use priceId - requires pre-created prices in Stripe Dashboard
 * 
 * We use inline pricing for simplicity. Products are auto-created in Stripe.
 */
const PRODUCTS = {
    // === ONE-TIME SCAN PACKS ===
    firstTime: {
        name: 'First-Time Offer - 10 Scans',
        description: 'Welcome gift! 10 outfit scans at 67% off',
        amount: 99,  // $0.99 in cents
        scans: 10,
        mode: 'payment',
        metadata: { product_type: 'first_time_offer', scans: '10' }
    },
    impulse: {
        name: 'Impulse Pack - 3 Scans',
        description: 'Quick vibe check - 3 outfit scans',
        amount: 99,  // $0.99 in cents
        scans: 3,
        mode: 'payment',
        metadata: { product_type: 'impulse_pack', scans: '3' }
    },
    starter: {
        name: 'Starter Pack - 10 Scans',
        description: 'A week of daily fits - 10 outfit scans',
        amount: 299,  // $2.99 in cents
        scans: 10,
        mode: 'payment',
        metadata: { product_type: 'scan_pack_10', scans: '10' }
    },
    popular: {
        name: 'Popular Pack - 25 Scans',
        description: 'Fan favorite - 25 outfit scans',
        amount: 499,  // $4.99 in cents
        scans: 25,
        mode: 'payment',
        metadata: { product_type: 'scan_pack_25', scans: '25' }
    },
    value: {
        name: 'Value Pack - 50 Scans',
        description: 'Style enthusiast - 50 outfit scans',
        amount: 699,  // $6.99 in cents
        scans: 50,
        mode: 'payment',
        metadata: { product_type: 'scan_pack_50', scans: '50' }
    },
    mega: {
        name: 'Mega Pack - 100 Scans',
        description: 'Fashionista pack - 100 outfit scans',
        amount: 999,  // $9.99 in cents
        scans: 100,
        mode: 'payment',
        metadata: { product_type: 'scan_pack_100', scans: '100' }
    },

    // === SUBSCRIPTIONS ===
    monthly: {
        name: 'FitRate Pro Monthly',
        description: 'Unlimited scans, all AI judges, unlimited battles',
        amount: 399,  // $3.99 in cents
        mode: 'subscription',
        interval: 'month',
        metadata: { product_type: 'pro_monthly' }
    },
    yearly: {
        name: 'FitRate Pro Yearly',
        description: 'Unlimited everything - best value (2 months free)',
        amount: 2999,  // $29.99 in cents
        mode: 'subscription',
        interval: 'year',
        metadata: { product_type: 'pro_yearly' }
    }
};

/**
 * Create Stripe Checkout Session
 * POST /api/checkout/create-session
 * Body: { product: string, userId: string, email?: string }
 * 
 * Products: firstTime, impulse, starter, popular, value, mega, monthly, yearly
 */
router.post('/create-session', async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }

    const { product, userId, email } = req.body;

    // Validate product
    if (!product || !PRODUCTS[product]) {
        return res.status(400).json({ 
            error: 'Invalid product',
            validProducts: Object.keys(PRODUCTS)
        });
    }

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    const productConfig = PRODUCTS[product];
    const isSubscription = productConfig.mode === 'subscription';

    try {
        // Build line item with inline price_data
        const lineItem = {
            quantity: 1,
            price_data: {
                currency: 'usd',
                unit_amount: productConfig.amount,
                product_data: {
                    name: productConfig.name,
                    description: productConfig.description,
                },
            }
        };

        // Add recurring interval for subscriptions
        if (isSubscription) {
            lineItem.price_data.recurring = {
                interval: productConfig.interval
            };
        }

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
            mode: productConfig.mode,
            line_items: [lineItem],
            success_url: `${req.headers.origin || 'https://fitrate.app'}/?success=true&product=${product}`,
            cancel_url: `${req.headers.origin || 'https://fitrate.app'}/?canceled=true`,
            customer_email: email || undefined,
            client_reference_id: userId,
            metadata: {
                userId: userId,
                product: product,
                ...productConfig.metadata
            },
            // Allow promo codes for subscriptions
            allow_promotion_codes: isSubscription,
            // Collect billing address for subscriptions (helps with fraud)
            billing_address_collection: isSubscription ? 'required' : 'auto',
        });

        console.log(`✅ Checkout session created: ${session.id} | product:${product} | user:${userId.slice(0, 8)}...`);

        res.json({ 
            url: session.url, 
            sessionId: session.id,
            product: product,
            amount: productConfig.amount
        });

    } catch (error) {
        console.error('Stripe checkout error:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

/**
 * Get available products (for frontend catalog display)
 * GET /api/checkout/products
 */
router.get('/products', (req, res) => {
    // Return products with public info only (no internal metadata)
    const catalog = {};
    
    for (const [key, product] of Object.entries(PRODUCTS)) {
        catalog[key] = {
            name: product.name,
            description: product.description,
            price: product.amount / 100,  // Convert cents to dollars
            priceDisplay: `$${(product.amount / 100).toFixed(2)}`,
            mode: product.mode,
            scans: product.scans || null,
            interval: product.interval || null
        };
    }
    
    res.json({ products: catalog });
});

export default router;
