# FitRate Stripe Setup Checklist

## 1. Stripe Dashboard Products

Go to: https://dashboard.stripe.com/products

### One-Time Products (Payment mode)

| Product Name | Price | Metadata |
|--------------|-------|----------|
| First-Time Offer | $0.99 | `product_type: first_time_offer` |
| Impulse Pack (3 scans) | $0.99 | `product_type: impulse_pack` |
| Starter Pack (10 scans) | $2.99 | `product_type: scan_pack_10` |
| Popular Pack (25 scans) | $4.99 | `product_type: scan_pack_25` |
| Value Pack (50 scans) | $6.99 | `product_type: scan_pack_50` |
| Mega Pack (100 scans) | $9.99 | `product_type: scan_pack_100` |

### Subscription Products (Subscription mode)

| Product Name | Price | Billing |
|--------------|-------|---------|
| FitRate Pro Monthly | $3.99 | Monthly recurring |
| FitRate Pro Yearly | $29.99 | Yearly recurring |

---

## 2. Payment Links

For each product, create a Payment Link:
1. Go to: https://dashboard.stripe.com/payment-links
2. Create link → Select product
3. **IMPORTANT**: Enable "Allow custom amount" = NO
4. After checkout → Redirect to `https://fitrate.app/?success=true`

Update `frontend/src/config/constants.js` with the new link URLs if they change.

---

## 3. Webhook Configuration

Go to: https://dashboard.stripe.com/webhooks

### Create Webhook Endpoint

- **URL**: `https://fitrate-production.up.railway.app/api/webhook`

- **Events to listen for**:
  - `checkout.session.completed` ✅ (CRITICAL - grants access)
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted` ✅ (CRITICAL - revokes Pro)
  - `invoice.payment_failed`

### Get Webhook Secret
After creating, click the endpoint → Reveal signing secret → Copy `whsec_...`

---

## 4. Railway Environment Variables

Go to: Railway Dashboard → FitRate Backend → Variables

```
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

**Test mode:** Use `sk_test_` and test webhook secret for development.

---

## 5. Verify Webhook is Working

### Option A: Stripe CLI (Local Testing)
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local
stripe listen --forward-to localhost:3001/api/webhook

# Trigger test event
stripe trigger checkout.session.completed
```

### Option B: Test in Production
1. Make a test purchase with Stripe test card: `4242 4242 4242 4242`
2. Check Railway logs for webhook processing
3. Verify scans were added to user

---

## 6. Frontend Verification

The frontend passes `client_reference_id` to Payment Links:
```javascript
const checkoutUrl = `${link}?client_reference_id=${userId}`
```

This becomes `session.client_reference_id` in the webhook, used to identify the user.

---

## 7. Backend Webhook Logic

The webhook at `/api/webhook` handles:

```javascript
// One-time purchases → Add scans
const SCAN_PACK_AMOUNTS = {
  99: 10,    // First-Time or Impulse (check metadata)
  299: 10,   // Starter
  499: 25,   // Popular
  699: 50,   // Value
  999: 100,  // Mega
};

// Subscriptions → Grant Pro status
await EntitlementService.grantPro(userId, email, 'stripe_subscription');
```

---

## 8. Idempotency

The webhook uses `IdempotencyService` to prevent duplicate processing:
- Stores processed `event.id` in Redis
- Skips if already processed

---

## Quick Verification Commands

```bash
# Check if webhook endpoint responds
curl -X POST https://fitrate-backend-production.up.railway.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"test"}'
# Should return 400 (missing signature) - this is correct!

# Check Railway logs
railway logs --project fitrate-backend
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Webhook returns 400 | Check STRIPE_WEBHOOK_SECRET is set correctly |
| Scans not added | Check Redis connection, check userId is passed |
| Pro not granted | Check EntitlementService, verify email linking |
| Duplicate events | IdempotencyService should handle - check Redis |
