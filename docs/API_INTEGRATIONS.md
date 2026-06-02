# Triplanio — API & Integrations Documentation

> **Scope:** New architecture (Vercel + Supabase Edge Functions + Stripe).
> Source of truth: `github.com/avel123111/triplanio` (`supabase/functions/*`).
> **Generated:** 2026-05-30 · audited against deployed Edge Functions (prod project).
> **Secrets policy:** only the *env-variable names* are listed below — never the values.

---

## 0. Conventions & base URLs

All server-side integration logic lives in **Supabase Edge Functions** (Deno). There is **one Stripe / one n8n auth secret per Supabase project**, and the project is the environment boundary:

| Environment | Supabase project | Edge Function base URL |
|---|---|---|
| **Prod** | `tizscxrpuopobgcxbekf` (Triplanio, eu-west-1) | `https://tizscxrpuopobgcxbekf.supabase.co/functions/v1/<fn>` |
| **Dev**  | `nydhzevdizkfaxdlikgc` (Triplanio dev, eu-central-1) | `https://nydhzevdizkfaxdlikgc.supabase.co/functions/v1/<fn>` |

**Auth models used across functions**

| Model | How it's enforced | Used by |
|---|---|---|
| `verify_jwt = true` (Supabase platform) + `getRequestUser()` | Caller must send a valid Supabase user JWT in `Authorization: Bearer <jwt>`. Anon key is rejected. | All user-facing functions |
| `verify_jwt = false` + **Stripe signature** | `stripe-signature` header verified with `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` |
| `verify_jwt = false` + **query secret** | `?s=<TELEGRAM_WEBHOOK_SECRET>` | `telegramWebhook` |
| `verify_jwt = false` + **shared bearer** | `Authorization: Bearer <N8N_SECRET>` (raw secret, NOT a JWT) | `triplanioAiReply`, `getPendingReminders`, `getDailyReminders` |
| `verify_jwt = false` + **share token in body** | `{ token }` must equal `trips.share_token` | `getPublicTrip` |
| `verify_jwt = false` + **no auth** ⚠️ | none | `getTripById`, `getTripByTelegramChatId` (see §3.7) |

> ⚠️ **n8n auth asymmetry (intentional):** **Outgoing** calls *Triplanio → n8n* are signed as an **HS256 JWT** built from `N8N_SECRET` (`_shared/n8nAuth.ts → signN8nJwt`). **Incoming** calls *n8n → Triplanio* use the **raw `N8N_SECRET`** as a plain Bearer token. Same secret, two different formats — don't "simplify" one to match the other or both directions break.

---

# PART A — OUTGOING integrations (Triplanio → external)

Functions that call a third party out of the application.

## A.1 — n8n (AI automation) · provider key: `N8N_SECRET`

**Provider:** self-hosted n8n on Railway. **Base (hardcoded, not env-driven):** `https://n8n-production-d1214.up.railway.app`
**Auth (outgoing):** `Authorization: Bearer <HS256-JWT signed with N8N_SECRET>` (5-min lifetime).

> ⚠️ The n8n base URL is **hardcoded** in each function — prod and dev Edge Functions both call the **same** n8n instance. There is no separate dev n8n. (Optimization: move to an `N8N_BASE_URL` env var per project — see §6.)

### A.1.1 `callTriplanioAi` — group-chat AI assistant
| | |
|---|---|
| **Process** | User posts in trip group chat → forward last 20 messages to n8n for AI reply |
| **Caller of this fn** | Frontend (authenticated user) |
| **Outbound URL** | `POST https://n8n-production-d1214.up.railway.app/webhook/group-chat` |
| **Outbound auth** | `Bearer <signN8nJwt(N8N_SECRET)>` |
| **Outbound payload** | `{ payload: { chat_id, trip_id, user_message, messages:[{id,user_id,user_full_name,text,created_at}], requested_by:{user_id,email,full_name} } }` |
| **Return path** | n8n later posts the answer back via `triplanioAiReply` (§B.3) |

### A.1.2 `planTripWithAi` — AI trip planner
| | |
|---|---|
| **Process** | User prompt → n8n builds a draft itinerary, returns `{ draft, ai_comment }` synchronously |
| **Outbound URL** | `POST .../webhook/ai-trip-planner` |
| **Outbound auth** | `Bearer <signN8nJwt(N8N_SECRET)>` |
| **Outbound payload** | `{ sessionId, prompt, language }` (n8n keeps its own history keyed by `sessionId`) |
| **Response** | JSON from n8n forwarded verbatim to the frontend |

### A.1.3 `parseBookingWithAi` — booking-document parser
| | |
|---|---|
| **Process** | Browser uploads booking files to Supabase Storage → sends signed URLs → n8n downloads + LLM-parses → structured JSON |
| **Outbound URL** | `POST .../webhook/parse-booking` |
| **Outbound auth** | `Bearer <signN8nJwt(N8N_SECRET)>` |
| **Outbound payload** | `{ kind: 'hotel'|'transfer', fileUrls: string[], text }` |
| **Response** | Parsed booking object (schema lives inside the n8n workflow, keyed by `kind`) |

## A.2 — Stripe (payments) · provider key: `STRIPE_SECRET_KEY`

**Provider:** Stripe API via `npm:stripe@17.0.0`. **Mode auto-detected** from the key (`sk_test_…` → test products, `sk_live_…` → live products) — one mode per project.
**Auth:** Stripe SDK initialised with `STRIPE_SECRET_KEY`. No URL is hand-written; the SDK targets `https://api.stripe.com`.

**Product IDs (resolved to active price via `product.default_price`):**

| Plan | LIVE product | TEST product |
|---|---|---|
| `pro_trip` | `prod_UYfZZsZnknkxDj` | `prod_UZnCx7GA3YlLJd` |
| `pro_monthly` | `prod_UYfZf8WvFNE3cI` | `prod_UZnBPOlJL0xmue` |
| `pro_yearly` | `prod_UYfZBYzOWrKiLu` | `prod_UZnBUDGL1PuyEN` |

### A.2.1 `createStripeCheckout` — start a Checkout session
| | |
|---|---|
| **Process** | Create Stripe Checkout Session for Pro purchase |
| **This fn URL** | `POST {base}/createStripeCheckout` · `verify_jwt=true` |
| **Inbound auth** | Supabase user JWT |
| **Inbound payload** | `{ tripId?, planType:'pro_trip'|'pro_monthly'|'pro_yearly', returnPath?, locale? }` |
| **Stripe calls** | `checkout.sessions.list` (race guard), `products.retrieve` (+`default_price`), `prices.list`, `checkout.sessions.create` |
| **Guards** | Origin == `PUBLIC_APP_URL`; `pro_trip` ownership; blocks duplicate active sub; rejects in-flight checkout |
| **Session metadata** | `{ user_id, user_email, trip_id, plan_type, return_path }` (consumed by webhook) |
| **Response** | `{ url }` (Stripe-hosted checkout) |

### A.2.2 `createBillingPortal` — manage subscription
| | |
|---|---|
| **This fn URL** | `POST {base}/createBillingPortal` · `verify_jwt=true` |
| **Inbound payload** | `{ returnPath? }` (defaults to `/settings`) |
| **Stripe calls** | `subscriptions.retrieve`, `billingPortal.sessions.create` |
| **Guards** | Origin == `PUBLIC_APP_URL`; requires an existing `stripe_subscription_id` |
| **Response** | `{ url }` (Stripe billing portal) |

### A.2.3 `getStripePrices` — live pricing
| | |
|---|---|
| **This fn URL** | `POST {base}/getStripePrices` · `verify_jwt=true` |
| **Inbound payload** | _none_ |
| **Stripe calls** | `products.retrieve` (+`default_price`), `prices.list` (fallback) |
| **Response** | `{ prices: { pro_trip|pro_monthly|pro_yearly: { plan_type, price_id, product_id, unit_amount, currency, recurring_interval } } }` |

> `checkSubscriptionStatus` and `getUserPlan` do **not** call Stripe — they read `users` / `trip_subscriptions` from Supabase, so they are not external integrations.

## A.3 — Maps & geocoding

**Map rendering** uses **Mapbox GL** (see A.3.2). **Address/place search + Time Zone** still use **Google Maps APIs** via the `placesAutocomplete` edge function below (`GOOGLE_MAPS_API_KEY`, base `https://maps.googleapis.com/maps/api`, `key=` query param).

### A.3.1 `placesAutocomplete` — Places + Time Zone proxy
| | |
|---|---|
| **This fn URL** | `POST {base}/placesAutocomplete` · `verify_jwt=true` |
| **Inbound payload** | `{ action, ... }` |
| **`action:'autocomplete'`** | `{ input, sessionToken?, types?, language? }` → `GET /place/autocomplete/json` → `{ predictions }` |
| **`action:'details'`** | `{ placeId, sessionToken? }` → `GET /place/details/json` (fields: name, formatted_address, geometry, address_components, utc_offset_minutes) → `{ result }` |
| **`action:'timezone'`** | `{ lat, lng, timestamp? }` → `GET /timezone/json` → raw Google response |

### A.3.2 Map rendering — **migrated to Mapbox GL** (no edge function)

All map surfaces (`MapView` / trip Map lens; the planner previews in `ManualPlanner` & `AiTripPlanner`; and `AiTripMiniMap`) render with **Mapbox GL JS** (`mapbox-gl`), styled `mapbox/light-v11` / `dark-v11`. The public token ships at build time as `VITE_MAPBOX_TOKEN` (URL-restricted in the Mapbox account).

Ground-transfer lines are still drawn from **OSRM** geometry; flight arcs are computed locally (`routing.js → geodesicLine`). The old `getMapsApiKey` edge function and `VITE_GOOGLE_MAPS_KEY` are **removed**. `GOOGLE_MAPS_API_KEY` remains **only** for `placesAutocomplete` (Places search + Time Zone, A.3.1).

## A.4 — FX rates (er-api) · provider key: _none (free, keyless)_

### A.4.1 `getFxRates`
| | |
|---|---|
| **Provider** | `open.er-api.com` (free, includes RUB) |
| **This fn URL** | `POST {base}/getFxRates` · `verify_jwt=true` |
| **Inbound payload** | `{ base? }` (default `EUR`) |
| **Outbound URL** | `GET https://open.er-api.com/v6/latest/<BASE>` (no auth) |
| **Caching** | `fx_rates` table, refresh after 48h; serves stale cache if upstream fails |
| **Response** | `{ base, rates, fetched_at, source:'er-api', age_hours, cached }` |

## A.5 — Telegram Bot API · provider key: `TELEGRAM_BOT_TOKEN`

**Provider:** Telegram. **Base:** `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>`. **Auth:** bot token embedded in the URL path.

| Function | This fn (inbound) | Telegram method called | Purpose |
|---|---|---|---|
| `telegramStartLink` | `POST {base}/telegramStartLink` · jwt=true · `{ tripId }` | `GET /getMe` | Build `t.me/<bot>?start=<token>` deep link; stores one-time token (10-min TTL) in `telegram_link_tokens` |
| `telegramGetBotInfo` | `POST {base}/telegramGetBotInfo` · jwt=true | `GET /getMe` | Returns bot `{ id, username, first_name }` |
| `telegramGetWebhookInfo` | `POST {base}/telegramGetWebhookInfo` · jwt=true · **admin-only** (`ADMIN_EMAILS`) | `GET /getWebhookInfo` | Diagnostic: current webhook config |
| `telegramWebhook` (reply leg) | inbound from Telegram (§B.2) | `POST /sendMessage` | Sends the bind-confirmation / hint message back to the chat |

> Telegram-related functions that touch **only the DB** (no Telegram API call): `telegramGetIntegration`, `telegramSetActive`, `telegramDisconnect` (all `jwt=true`, body `{ tripId, ... }`).

## A.6 — Email (Resend) · provider key: `RESEND_API_KEY`

**Provider:** Resend. **Outbound URL:** `POST https://api.resend.com/emails`. **Auth:** `Authorization: Bearer <RESEND_API_KEY>`. **From:** `EMAIL_FROM` (default `noreply@triplanio.com`).
**Helper:** `_shared/sendEmail.ts` — best-effort (logs & skips if key missing, never throws).

| Calling function | This fn URL (jwt=true) | When email is sent | Payload to Resend |
|---|---|---|---|
| `inviteTripMember` | `POST {base}/inviteTripMember` | New member invited to a trip (link built from `PUBLIC_APP_URL`) | `{ from, to, subject, text }` |
| `resendTripInvite` | `POST {base}/resendTripInvite` | Re-send pending invite | `{ from, to, subject, text }` |
| `respondTripInvite` | `POST {base}/respondTripInvite` | Accept/decline notification to inviter | `{ from, to, subject, text }` |

## A.7 — Google OAuth (client-side login) · provider key: `VITE_GOOGLE_CLIENT_ID`

Not an Edge Function — the SPA uses Supabase Auth's Google provider (redirect flow + One Tap). The OAuth client ID ships in the bundle as `VITE_GOOGLE_CLIENT_ID`; it must also be whitelisted in Supabase Dashboard → Auth → Providers → Google. Token exchange happens between Google ↔ Supabase Auth (`https://<ref>.supabase.co/auth/v1/callback`), not in app code.

---

# PART B — INCOMING webhooks (external → Triplanio)

Endpoints that an external system calls; several return trip/business data outward.

## B.1 — Stripe → `stripe-webhook`
| | |
|---|---|
| **Provider** | Stripe |
| **URL (prod)** | `POST https://tizscxrpuopobgcxbekf.supabase.co/functions/v1/stripe-webhook` |
| **URL (dev)** | `POST https://nydhzevdizkfaxdlikgc.supabase.co/functions/v1/stripe-webhook` |
| **Platform auth** | `verify_jwt = false` |
| **Verification** | `stripe-signature` header → `stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET)` |
| **Provider keys** | `STRIPE_WEBHOOK_SECRET` (signature), `STRIPE_SECRET_KEY` (SDK) |
| **Payload** | Stripe `Event` object (raw body, must stay unparsed for signature check) |
| **Events handled** | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created` |
| **Side effects** | Sets `trips.is_pro_trip`, `users.subscription_status/_end_date`, writes `trip_subscriptions`, notifications; idempotency via `stripe_events` table |
| **Returns outward** | `{ received: true }` only — no business data leaked |

## B.2 — Telegram → `telegramWebhook`
| | |
|---|---|
| **Provider** | Telegram Bot API |
| **URL (prod)** | `POST https://tizscxrpuopobgcxbekf.supabase.co/functions/v1/telegramWebhook?s=<TELEGRAM_WEBHOOK_SECRET>` |
| **URL (dev)** | `POST https://nydhzevdizkfaxdlikgc.supabase.co/functions/v1/telegramWebhook?s=<TELEGRAM_WEBHOOK_SECRET>` |
| **Platform auth** | `verify_jwt = false` |
| **Verification** | `?s=` query param must equal `TELEGRAM_WEBHOOK_SECRET` |
| **Provider keys** | `TELEGRAM_WEBHOOK_SECRET` (inbound), `TELEGRAM_BOT_TOKEN` (outbound `sendMessage`) |
| **Payload** | Telegram `Update` object (`{ message:{ chat:{id}, text, from:{username,first_name} } }`) |
| **Behaviour** | `/start <token>` consumes `telegram_link_tokens`, upserts `trip_telegram_integrations`; replies via `sendMessage`. Always returns `200` to avoid retry storms |
| **Returns outward** | `{ ok: true }` |

## B.3 — n8n → `triplanioAiReply` (AI answer write-back)
| | |
|---|---|
| **Provider** | n8n |
| **URL (prod/dev)** | `POST {base}/triplanioAiReply` |
| **Platform auth** | `verify_jwt = false` |
| **Verification** | `Authorization: Bearer <N8N_SECRET>` (**raw** secret) |
| **Provider key** | `N8N_SECRET` |
| **Payload** | `{ chat_id, message }` |
| **Side effect** | Inserts AI message into `chat_messages` as bot user (`info@triplanio.com`), text capped at 4000 chars |

## B.4 — n8n scheduler → `getPendingReminders`
| | |
|---|---|
| **Provider** | n8n (cron, ~every 15 min) |
| **URL (prod/dev)** | `POST {base}/getPendingReminders` |
| **Platform auth** | `verify_jwt = false` · **Bearer `N8N_SECRET`** (raw) |
| **Payload** | `{ window_minutes? }` (default 15) |
| **Logic** | RPC `get_pending_reminders(window_minutes)`; pre-logs to `telegram_reminder_logs` (dedup via unique index) so retries don't double-send |
| **Returns outward** | `{ reminders: [{ type, user_id, user_locale, trip_id, chat_id, context }] }` — n8n formats & sends Telegram messages |

## B.5 — n8n scheduler → `getDailyReminders`
| | |
|---|---|
| **Provider** | n8n (cron, once per type per day) |
| **URL (prod/dev)** | `POST {base}/getDailyReminders` |
| **Platform auth** | `verify_jwt = false` · **Bearer `N8N_SECRET`** (raw) |
| **Payload** | `{ type: hotel_checkin\|hotel_checkout\|hotel_cancel\|transfer\|activity\|car_pickup\|car_dropoff }` |
| **Logic** | Maps `type` → one STABLE SQL function (`get_trips_*_tomorrow`); fire-and-forget (no dedup log) |
| **Returns outward** | `{ type, reminders: [...] }` |

## B.6 — Public share link → `getPublicTrip`
| | |
|---|---|
| **Provider** | Anyone with a share link (browser) |
| **URL (prod/dev)** | `POST {base}/getPublicTrip` |
| **Platform auth** | `verify_jwt = false` |
| **Verification** | `{ token }` in body must equal `trips.share_token` |
| **Payload** | `{ tripId, token }` |
| **Returns outward** | `{ trip (created_by & share_token stripped), visits, hotels, transfers, activities, carRentals }` |

> Share token is minted by `ensureShareToken` (`jwt=true`, owner-only, `{ tripId }` → `{ shareToken }`).

## B.7 — Server-to-server (n8n / Telegram bot) → trip readers ⚠️
| | |
|---|---|
| **Provider** | n8n / Telegram bot |
| **`getTripById`** | `POST {base}/getTripById` · `verify_jwt=false` · payload `{ id }` → full trip payload |
| **`getTripByTelegramChatId`** | `POST {base}/getTripByTelegramChatId` · `verify_jwt=false` · payload `{ telegram_chat_id }` → full trip payload |
| **Verification** | **NONE** — no signature, no shared secret, no JWT |
| **Returns outward** | Full trip incl. members, budgets, expenses |

> 🔴 **SECURITY FINDING (V-API-1):** `getTripById` and `getTripByTelegramChatId` are public (`verify_jwt=false`) **and** perform no internal auth. Any caller who knows/guesses a trip UUID (or a Telegram chat id) can read the entire trip, including members, budgets and expenses. These leak more than the deliberately-sanitised `getPublicTrip` (which at least requires a share token and strips ownership). **Recommendation:** gate both behind `Authorization: Bearer <N8N_SECRET>`, exactly like `triplanioAiReply`/`getPendingReminders`. Pros: closes an IDOR-style data-leak with a one-line check, consistent with the other n8n endpoints. Cons: n8n workflow must add the header (trivial). This mirrors the previously-fixed `getTripDetails` fail-open issue.

---

# PART C — Internal automation endpoints (not external integrations)

Listed for completeness — called by DB triggers / Supabase automations, `verify_jwt=false` but no external provider:

| Function | Trigger | Payload |
|---|---|---|
| `seedTripBudget` | Trip created | `{ tripId }` or `{ event:{ entity_name:'Trip', entity_id } }` (also accepts a user JWT) |
| `syncTripExpense` | Hotel/Activity/Transfer/Service change | `{ event:{ entity_name, entity_id, event_type } }` or `{ sourceKind, sourceId, tripId, action }` |

---

# PART D — Environment-variable / secret reference

**Edge Function secrets (Supabase → Project → Settings → Edge Functions):**

| Key name | Provider / use | Direction |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL (admin client) | internal |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role client (bypasses RLS) | internal — never expose |
| `N8N_SECRET` | n8n shared secret — **JWT-signed outbound**, **raw inbound** | both |
| `STRIPE_SECRET_KEY` | Stripe API + mode detection | outbound |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature | inbound |
| `GOOGLE_MAPS_API_KEY` | Google Places (search) + Time Zone — `placesAutocomplete` only | outbound |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API | outbound |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook `?s=` guard | inbound |
| `RESEND_API_KEY` | Resend email | outbound |
| `EMAIL_FROM` | Resend From address (default `noreply@triplanio.com`) | outbound |
| `PUBLIC_APP_URL` | Origin validation + email/checkout return links | internal |
| `ADMIN_EMAILS` | Comma-separated admin allow-list (`telegramGetWebhookInfo`) | internal |

**Frontend build vars (`VITE_*`, shipped in bundle — public by design):**

| Key name | Use |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Anon key for the SPA |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client (login + One Tap) |
| `VITE_MAPBOX_TOKEN` | Mapbox GL public token for all map surfaces; URL-restricted |
| `VITE_TRIPLANIO_BOT_USER_ID` | AI bot `users.id` (detect bot chat messages) — per-environment |

---

# PART E — Findings & optimisation notes

1. 🔴 **V-API-1 (data leak):** `getTripById` & `getTripByTelegramChatId` are unauthenticated full-trip readers — see §B.7. Highest priority.
2. 🟠 **n8n base URL hardcoded** in `callTriplanioAi` / `planTripWithAi` / `parseBookingWithAi`. Both prod and dev call the same Railway instance. Extract to an `N8N_BASE_URL` secret so dev can't write into prod's n8n state. (Pro: clean env separation. Con: must set the var in both projects before next deploy.)
3. 🟢 **Auth-helper duplication:** `getRequestUser`/`getUser` is re-implemented inline in ~8 functions (`planTripWithAi`, `parseBookingWithAi`, `checkSubscriptionStatus`, `getFxRates`, `getMapsApiKey`, `getActiveTrips`, `telegramDisconnect`, …) instead of importing `_shared/supabaseAdmin.ts`. Consolidating reduces drift. (Low risk, mechanical.)
4. 🟢 **`getDailyReminders` has no dedup log** (unlike `getPendingReminders`). If n8n retries within a day, users can get duplicate Telegram messages. Confirm n8n dedups, or add a `telegram_reminder_logs` write.
5. 🟢 **`telegramStartLink` access check uses `user.email`** (`isCallerParticipant(tripId, user.email!)`) while the rest of the codebase has migrated to `user.id`. Verify `trip_members.user_id` vs email — this may silently fail the participant check after the email→user_id migration. (Cross-reference: `triplanio-userid-migration`.)
