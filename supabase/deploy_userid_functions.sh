#!/usr/bin/env bash
# Deploys the edge functions changed by the email->user_id migration.
# verify_jwt flags below match the production settings (preserved).
#
# Usage:
#   supabase login                      # once, if not already
#   ./supabase/deploy_userid_functions.sh <PROJECT_REF>
#
#   dev  ref: nydhzevdizkfaxdlikgc
#   prod ref: tizscxrpuopobgcxbekf
#
# Run from the repo root.
set -euo pipefail

REF="${1:?Usage: $0 <PROJECT_REF>}"

# Functions that must keep verify_jwt = FALSE (webhooks / public / automation / no-JWT callers)
NO_JWT=(getTripDetails stripe-webhook telegramWebhook triplanioAiReply seedTripBudget syncTripExpense)

# Functions with verify_jwt = TRUE (default)
JWT=(inviteTripMember respondTripInvite removeTripMember updateTripMemberRole resolveProfiles \
     resendTripInvite getUserPlan createStripeCheckout createBillingPortal telegramStartLink \
     ensureShareToken copyTrip deleteMyAccount checkSubscriptionStatus getActiveTrips \
     telegramDisconnect addOfflineTripMember callTriplanioAi)

for fn in "${NO_JWT[@]}"; do
  echo "→ deploy $fn (no-verify-jwt)"
  supabase functions deploy "$fn" --project-ref "$REF" --no-verify-jwt
done

for fn in "${JWT[@]}"; do
  echo "→ deploy $fn"
  supabase functions deploy "$fn" --project-ref "$REF"
done

echo "✅ Done: ${#NO_JWT[@]} + ${#JWT[@]} functions deployed to $REF"
