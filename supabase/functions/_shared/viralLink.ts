// Viral link marking (TRIP-329), Deno half. Mirror of src/lib/viralLink.js —
// an edge function cannot import from src/, so the table exists twice and
// src/lib/viralLink.test.js reads THIS file and fails when the two drift.
//
// The rule and the reasoning live in the frontend copy; keep both in step.

/** Link kind → the fixed pair it always carries. */
export const VIRAL_MARKS: Record<string, { utm_source: string; utm_medium: string }> = {
  public_link: { utm_source: 'trip_share', utm_medium: 'viral' },
  invite_link: { utm_source: 'trip_invite', utm_medium: 'viral' },
  invite_email: { utm_source: 'trip_invite', utm_medium: 'viral_email' },
  share_card: { utm_source: 'share_card', utm_medium: 'viral' },
};

/**
 * Append the campaign marks for a viral link. The trip id always rides
 * utm_campaign — it is the only one of the three marks with a `users` column,
 * so an id parked in utm_content would be lost for cookie refusers.
 *
 * Built by hand rather than through `new URL()`: the base here comes from the
 * PUBLIC_APP_URL secret and one caller sits outside a try/catch — a missing mark
 * is a reporting gap, a throw is a broken invite email.
 */
export function withViralMarks(
  url: string,
  kind: string,
  tripId: string,
  content?: string,
): string {
  // Checked for BEING an entry, not merely for being truthy: `VIRAL_MARKS.
  // constructor` resolves off the prototype, and a bare `if (marks)` would let
  // it through and ship a link marked with a campaign and no source.
  const marks = VIRAL_MARKS[kind];
  if (!url || !tripId || typeof marks?.utm_source !== 'string') return url;

  const params = new URLSearchParams({ ...marks, utm_campaign: `trip_${tripId}` });
  if (content) params.set('utm_content', content);

  return `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
}
