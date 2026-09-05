/**
 * Server-side PostHog capture for Supabase Edge Functions (TRIP-213 Phase 2).
 *
 * Some product events are born on the server, not in the browser — revenue
 * (Stripe webhook), the North Star "trip reached 2 participants", lifecycle
 * reminders. This is the single fire-and-forget emitter for those.
 *
 * - Uses the PUBLIC project write key (the same `phc_…` key shipped in the
 *   browser bundle — safe to use here); read from the `POSTHOG_PROJECT_KEY` edge
 *   secret. No-op when it is unset, so local / unconfigured runs stay silent.
 * - `env` mirrors the frontend super-property (prod|dev) and is derived from the
 *   per-project `SENTRY_ENVIRONMENT` secret — no new env var for that.
 * - `distinct_id` MUST be the user's uid, matching the browser's
 *   posthog.identify(uid), so server + client events land on the same person.
 * - Fire-and-forget: analytics must NEVER block or fail the request; every error
 *   is swallowed.
 *
 * The module also owns the OTHER direction — erasing a person when their account
 * is deleted (`deletePersonAndEvents`, TRIP-518). Both live here because CI guard
 * 2j (rule C) keeps every PostHog key and host in this one file; the deletion side
 * needs a different host and a different key, which is precisely the kind of thing
 * that must not be copy-pasted into a function.
 */
import { envTag } from './envTag.ts';

/**
 * Capture a product-analytics event from an edge function.
 * `Deno.env` is read INSIDE the function (like `envTag`), never at module load —
 * so this module imports under `deno test` without `--allow-env` and its pure
 * exports (below) stay testable.
 * @param event       snake_case event name (e.g. 'purchase_completed')
 * @param distinctId  the user's uid (PostHog person). Skipped when null.
 * @param props       event properties (no PII beyond ids)
 * @param groups      optional group analytics, e.g. { trip: tripId }
 */
export function captureServer(
  event: string,
  distinctId: string | null | undefined,
  props: Record<string, unknown> = {},
  groups?: Record<string, string>,
): void {
  const token = Deno.env.get('POSTHOG_PROJECT_KEY');
  if (!token || !distinctId) return;
  const host = Deno.env.get('POSTHOG_HOST') || 'https://eu.i.posthog.com';
  const env = envTag() === 'development' ? 'dev' : 'prod';
  const body = {
    api_key: token,
    event,
    distinct_id: distinctId,
    properties: {
      ...props,
      env,
      $lib: 'edge',
      ...(groups ? { $groups: groups } : {}),
    },
    timestamp: new Date().toISOString(),
  };
  // Fire-and-forget — do not await, never throw into the caller.
  fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => { /* analytics is best-effort */ });
}

/**
 * The address and body of a person deletion — pure, so the shape is pinned by a
 * test instead of being discovered in production (`analytics_test.ts`).
 *
 * TWO HOSTS, and mixing them is the silent failure here: events are ingested on
 * `eu.i.posthog.com`, but this is the management API, which lives on
 * `eu.posthog.com`. Auth is a PERSONAL API key (scope `person:write`), never the
 * public `phc_…` ingestion key that `captureServer` uses.
 *
 * `bulk_delete` takes distinct ids, which is what we have: the browser
 * identifies people by their Supabase uid. `delete_events=true` is the whole
 * point — see `deletePersonAndEvents` below.
 */
export function personDeleteRequest(apiHost: string, projectId: string, distinctId: string) {
  return {
    url: `${apiHost.replace(/\/+$/, '')}/api/projects/${projectId}/persons/bulk_delete/?delete_events=true`,
    body: { distinct_ids: [distinctId] },
  };
}

/**
 * Erase a person from analytics when their account is deleted (TRIP-518).
 *
 * WHY EVENTS TOO, and why this is not a `$unset` of the identity properties:
 * person-on-events is enabled for this project, so `email` / `name` are stamped
 * onto every event AT INGESTION. Clearing the profile leaves those copies in
 * place, PostHog has no configurable event retention to age them out, and our
 * Privacy Policy says deletion erases the email and name. So the person goes
 * with their events, or the promise is false.
 *
 * Deletion is ASYNCHRONOUS on PostHog's side; a 2xx means accepted, not done.
 * Do not reuse a deleted distinct id — ours are Supabase uids, so this never
 * comes up.
 *
 * Best-effort like everything else here — analytics must never fail account
 * deletion — but NOT silent: a missing secret or a rejected call is logged, since
 * "it quietly did nothing" is exactly how this obligation would rot.
 *
 * @param distinctId  the user's uid, the same id the browser identifies with
 */
export async function deletePersonAndEvents(distinctId: string | null | undefined): Promise<void> {
  if (!distinctId) return;
  const key = Deno.env.get('POSTHOG_PERSONAL_API_KEY');
  const projectId = Deno.env.get('POSTHOG_PROJECT_ID');
  if (!key || !projectId) {
    console.error('posthog person delete skipped: POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID not set');
    return;
  }
  const apiHost = Deno.env.get('POSTHOG_API_HOST') || 'https://eu.posthog.com';
  const { url, body } = personDeleteRequest(apiHost, projectId, distinctId);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('posthog person delete failed', res.status, await res.text());
    }
  } catch (e) {
    console.error('posthog person delete failed', e);
  }
}

/**
 * North Star boundary — the trip becomes collaborative exactly when active
 * members WITH an account reach 2. Since TRIP-516 the owner is a real
 * `trip_members` row present from creation (count 1 at creation, 2 when the
 * first real member joins), so the threshold is 2, not 1. Pure so it is testable
 * under `deno test` without env permission (mirrors `resolveEnvTag`).
 */
export function reached2FromActiveCount(activeWithAccount: number | null | undefined): boolean {
  return activeWithAccount === 2;
}

/**
 * North Star: emit `trip_reached_2_participants` the moment a trip becomes
 * collaborative. Participants = active members WITH an account; offline
 * placeholders (user_id null) do NOT count. Since TRIP-516 the OWNER is a real
 * `trip_members` row (role='owner', status='active') present from creation, so
 * the count is 1 at creation and hits 2 the moment the first real member joins.
 * Fires once — when that makes it 2. Call right AFTER a join sets a member to
 * active. Best-effort (swallows errors).
 * @param admin  supabase admin client (injected so this module stays DB-agnostic)
 */
export async function emitTripReached2(
  // deno-lint-ignore no-explicit-any
  admin: { from: (t: string) => any },
  tripId: string | null | undefined,
  joinerUserId: string | null | undefined,
): Promise<void> {
  if (!tripId || !joinerUserId) return;
  try {
    const { count } = await admin.from('trip_members')
      .select('id', { count: 'exact', head: true })
      .eq('trip_id', tripId).eq('status', 'active').not('user_id', 'is', null);
    if (reached2FromActiveCount(count)) {
      captureServer('trip_reached_2_participants', joinerUserId, { trip_id: tripId }, { trip: tripId });
    }
  } catch { /* best-effort */ }
}
