/**
 * deleteTrip
 *
 * POST body: { tripId }
 *
 * Owner-only trip delete. Runs the external side-effects that FK cascades can't
 * reach BEFORE the row is irreversibly gone:
 *   1. Telegram teardown via the single _shared/telegramTeardown source
 *      (critical — aborts the delete if it fails, so a retry is idempotent).
 *   2. Storage purge of the `trips` bucket (best-effort — an orphan file must
 *      never block the delete).
 *   3. The trip DELETE last; Postgres cascades wipe the child tables.
 *
 * Auth: OWNER ONLY (trips.created_by === caller). Mirrors the RLS policy
 * `trips_delete: created_by = auth.uid()` — the admin client bypasses RLS, so
 * the check is duplicated explicitly here.
 *
 * Storage layout. Every trip file lives in the single private `trips` bucket as
 * `<tripId>/<uid>-<file>` (covers included), so the whole trip is one flat
 * prefix. A single prefix sweep removes 100% of a trip's files — including the
 * cover, which has no `documents[]` entry. (Verified 2026-06-24 on prod+dev:
 * every stored document path sits under its `<tripId>/` prefix, so the former
 * DB-path collector was pure overlap and was removed — TRIP-13.)
 */

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { disconnectTripTelegram } from '../_shared/telegramTeardown.ts';

const BUCKET = 'trips';

/** Sweep everything under `${prefix}/` in the trips bucket, paginated (best-effort). */
async function purgeBucketByPrefix(prefix: string): Promise<void> {
  const limit = 100;
  let offset = 0;
  for (;;) {
    const { data: files, error } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit, offset });
    if (error) { console.error(`deleteTrip: list ${BUCKET}/${prefix} failed`, error); return; }
    if (!files?.length) return;
    const toRemove = files.filter((f) => f.name).map((f) => `${prefix}/${f.name}`);
    if (toRemove.length) {
      const { error: rmErr } = await supabaseAdmin.storage.from(BUCKET).remove(toRemove);
      if (rmErr) console.error(`deleteTrip: remove ${BUCKET}/${prefix} failed`, rmErr);
    }
    if (files.length < limit) return;
    offset += limit;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Step 0 — auth.
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    let body: { tripId?: string };
    try { body = await req.json(); } catch { body = {}; }
    const tripId = body?.tripId;
    if (!tripId) return Response.json({ error: 'Missing tripId' }, { status: 400, headers: corsHeaders });

    // Step 1 — ownership: OWNER ONLY (mirrors RLS trips_delete).
    const { data: trip, error: tripErr } = await supabaseAdmin
      .from('trips').select('id, created_by').eq('id', tripId).single();
    if (tripErr || !trip) return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
    if (trip.created_by !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });

    // Step 2 — Telegram teardown (critical). Routed through the single teardown
    // source so trip-delete never drifts from manual disconnect / Pro-rollback /
    // member-leave. Runs BEFORE the delete: if it throws, the trip stays intact
    // and a retry is idempotent (teardown deletes by row existence).
    try {
      await disconnectTripTelegram(supabaseAdmin, { tripId });
    } catch (e) {
      console.error('deleteTrip: telegram teardown failed', e);
      return Response.json(
        { error: e instanceof Error ? e.message : 'Telegram teardown failed' },
        { status: 500, headers: corsHeaders },
      );
    }

    // Step 3 — storage purge (best-effort, must NOT block the delete). Sweep the
    // `<tripId>/` prefix in the trips bucket (all trip files). The share-cards /
    // share-maps buckets are dead as of TRIP-48 (the card is rendered in the
    // browser now, nothing is written there), so there is nothing to purge there.
    try {
      await purgeBucketByPrefix(tripId);
    } catch (e) {
      console.error('deleteTrip: storage purge failed', e);
    }

    // Step 4 — delete the trip (critical, last). FK cascades wipe all child
    // tables; purchase / partner_clicks are SET NULL (kept for accounting).
    const { error: delErr } = await supabaseAdmin.from('trips').delete().eq('id', tripId);
    if (delErr) {
      console.error('deleteTrip: delete failed', delErr);
      return Response.json({ error: delErr.message }, { status: 500, headers: corsHeaders });
    }

    return Response.json({ ok: true }, { headers: corsHeaders });

  } catch (error) {
    console.error('deleteTrip error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
