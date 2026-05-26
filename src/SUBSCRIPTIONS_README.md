# Subscription System Documentation

## Overview
The app has a tiered subscription model with three levels:
- **Free**: 1 active trip limit, basic features
- **Pro Trip** ($5 one-time): Unlocks AI features for a single trip
- **Pro Subscription** ($6/month or $48/year): Unlimited trips + all AI features

## Entity Changes

### User Entity
- `subscription_status`: "free" | "pro"
- `subscription_end_date`: When Pro subscription expires

### Trip Entity
- `is_pro_trip`: true if trip was upgraded with one-time $5 purchase

### TripSubscription Entity (NEW)
Stores subscription records for tracking and auditing.

## Backend Functions

### `createStripeCheckout`
Creates Stripe checkout session for any plan type.
- `tripId`: Required for pro_trip plan
- `planType`: "pro_trip" | "pro_monthly" | "pro_yearly"

### `checkSubscriptionStatus`
Checks if user/trip has Pro access.
- Returns `{ isPro: boolean, reason: 'subscription' | 'trip' }`

### `getUserPlan`
Returns current user's plan details.
- Returns `{ plan: 'free' | 'pro', subscriptionEnd?: string, email: string }`

### `getActiveTrips`
Counts user's active trips (end_date >= today or not set).

### `stripe-webhook`
Handles Stripe events:
- `checkout.session.completed`: Activates subscription/trip
- `customer.subscription.updated`: Updates subscription status
- `customer.subscription.deleted`: Downgrades to Free

## Frontend Components

### `UpgradePlanDialog`
Shows plan options when user wants to unlock AI features.

### `ProBadge`
Displays "Pro" badge with crown icon.

### `AiFeatureLock`
Overlay component to block AI features on Free plan.

### `TripLimitDialog`
Shown when Free user tries to create 2nd active trip.

## Integration Points

### Trip Creation
- `pages/Trips.jsx`: Shows `TripLimitDialog` before creating
- `functions/copyTrip.js`: Checks limits before copying

### AI Features
- `components/hotels/HotelAiUpload.jsx`: Locked for Free trips
- Shows "Разблокировать" button → opens `UpgradePlanDialog`

### Trip Display
- `components/trips/TripCard.jsx`: Shows Pro badge
- `components/trips/TripHeader.jsx`: Shows Pro badge + "Сделать Pro" button

### Settings
- `pages/Settings.jsx`: New "План" section
- Shows current plan, subscription end date
- "Перейти на Pro" or "Управлять подпиской" buttons

## Stripe Products & Prices

### Products
- `prod_UYfZZsZnknkxDj`: Planner Pro Trip ($5 one-time)
- `prod_UYfZf8WvFNE3cI`: Planner Pro Monthly ($6/month)
- `prod_UYfZBYzOWrKiLu`: Planner Pro Yearly ($48/year)

### Prices
- `price_1TZYEZ7IgGZMEGjJYDTdOrGP`: Pro Trip ($5.00)
- `price_1TZYEZ7IgGZMEGjJBtEuPKVx`: Pro Monthly ($6.00/month)
- `price_1TZYEZ7IgGZMEGjJk90bFHXH`: Pro Yearly ($48.00/year)

## Testing

### Test Card
- Number: 4242 4242 4242 4242
- Expiry: Any future date
- CVC: Any 3 digits

### Test Flow
1. Create 1st trip → Free (works)
2. Try to create 2nd trip → `TripLimitDialog` appears
3. Click "Перейти на Pro" → Choose plan → Stripe Checkout
4. Complete payment → Redirects back to `/settings?success=true`
5. Check Settings → Plan shows "Pro Подписка"
6. Create 2nd trip → Now works

### AI Features Test
1. Open Free trip → Go to Hotels → Click "Add hotel"
2. AI upload section shows lock overlay
3. Click "Разблокировать" → Choose "Pro для этого трипа" ($5)
4. Complete payment → AI features unlock for this trip only

## Important Notes

### Active Trip Definition
A trip is "active" if:
- `end_date` is null/empty, OR
- `end_date >= today` (Madrid timezone)

Completed trips (end_date < today) don't count toward limit.

### Pro Trip vs Pro Subscription
- **Pro Trip**: One-time $5, unlocks AI for ONE trip forever
- **Pro Subscription**: Recurring, unlocks AI for ALL trips + unlimited trips

### Member Access
- All trip members benefit from Pro features if:
  - Trip is Pro (is_pro_trip = true), OR
  - Trip creator has Pro subscription

### Subscription Cancellation
- Handled via Stripe Customer Portal
- Access continues until end of paid period
- After expiry, user downgrades to Free automatically
- Pro Trip purchases remain Pro forever (not affected)

## Webhook Configuration
- Endpoint: `/api/functions/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Secret: Stored in `STRIPE_WEBHOOK_SECRET`

## Going Live
1. Test thoroughly in test mode
2. Go to Dashboard → Integrations → Stripe
3. Click "Claim Account" to take ownership
4. Replace test keys with live Stripe keys
5. Update webhook endpoint in Stripe Dashboard to production URL