// Subscription / plan helpers (frontend UI gating).
// The backend (getUserPlan / checkSubscriptionStatus edge functions) remains the
// source of truth for enforcement; this mirrors it for showing the right UI.

// A user is "active Pro" when their status is 'pro' and the subscription has not
// expired. Mirrors the server (getUserPlan): a 'pro' row with NO end date is
// treated as NOT active (free), to avoid client/server drift.
export function isProActive(user) {
  if (user?.subscription_status !== 'pro') return false;
  const end = user?.subscription_end_date;
  return !!end && new Date(end) > new Date();
}
