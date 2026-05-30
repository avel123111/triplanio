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
# NOTE: getTripDetails was moved to the JWT list — it must require auth. It used
# to be here as a base44 carry-over, but on Supabase verify_jwt=false exposed the
# full trip payload to anyone with the public anon key + a tripId (fail-open).
NO_JWT=(stripe-webhook telegramWebhook triplanioAiReply seedTripBudget syncTripExpense)

# Functions with verify_jwt = TRUE (default)
JWT=(getTripDetails inviteTripMember respondTripInvite removeTripMember updateTripMemberRole resolveProfiles \
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
