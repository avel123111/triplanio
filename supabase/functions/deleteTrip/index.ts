/**
 * deleteTrip
 *
 * POST body: { tripId }
 *
 * Replaces the old frontend `supabase.from('trips').delete()` so that the
 * external side-effects that FK cascades can't reach run BEFORE the row is
 * irreversibly gone:
 *   1. Telegram teardown via the single _shared/telegramTeardown source
 *      (critical — aborts the delete if it fails, so a retry is idempotent).
 *   2. Storage purge across the trips + legacy buckets (best-effort — an orphan
 *      file must never block the delete).
 *   3. The trip DELETE last; Postgres cascades wipe the 21 child tables.
 *
 * Auth: OWNER ONLY (trips.created_by === caller). Mirrors the RLS policy
 * `trips_delete: created_by = auth.uid()` — the admin client bypasses RLS, so
 * the check is duplicated explicitly here. Admin / viewer / member cannot
 * delete: a trip delete wipes every member's data, so only the creator may.
 *
 * Storage layout note (transitional). The target layout keys every trip file
 * under a single private bucket `trips` as `<tripId>/<uid>-<file>` (covers
 * included). During the migration window files may still live in the legacy
 * buckets: `documents` (trip docs `<tripId>/…`, event/service attachments
 * `attachments/<uid>/…`, AI uploads `ai-uploads/<uid>/…`) and `trip-covers`
 * (`<tripId>/…`). Covers carry NO entry in any `documents[]` array, so only a
 * prefix sweep can reach them. We therefore (1) collect DB-tracked attachment
 * paths from `documents[]` (storage_path, or parsed from file_url when absent —
 * legacy AI uploads drop storage_path), remembering which bucket each lives in,
 * and (2) sweep the `<tripId>/` prefix across ALL THREE buckets as the safety
 * net for trip-keyed files (covers especially). Once the backfill is done and
 * the legacy buckets are retired this collapses to the `trips` bucket alone
 * (step 3.3-B).
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { disconnectTripTelegram } from '../_shared/telegramTeardown.ts';

const NEW_BUCKET = 'trips';
const LEGACY_DOCS_BUCKET = 'documents';
const LEGACY_COVERS_BUCKET = 'trip-covers';
// Buckets swept by `<tripId>/` prefix. Transitional set; trims to [NEW_BUCKET]
// in step 3.3-B after the backfill retires the legacy buckets.
const PREFIX_SWEEP_BUCKETS = [NEW_BUCKET, LEGACY_DOCS_BUCKET, LEGACY_COVERS_BUCKET];

/**
 * Parse a stored file_url into { bucket, path }. Handles signed
 * (…/object/sign/<bucket>/<path>?token=…), public and authenticated URLs for
 * the new `trips` bucket and the legacy `documents` / `trip-covers` buckets.
 * Returns null if it isn't one of those storage URLs.
 */
function parseStorageUrl(url: unknown): { bucket: string; path: string } | null {
  if (typeof url !== 'string' || !url) return null;
  const m = url.match(/\/object\/(?:sign|public|authenticated)\/(trips|documents|trip-covers)\/([^?]+)/);
  if (!m) return null;
  let path = m[2];
  try { path = decodeURIComponent(path); } catch { /* keep raw */ }
  return { bucket: m[1], path };
}

/**
 * Walk every `documents[]` array attached to the trip and collect object paths
 * grouped by bucket. Prefer file_url (it names the bucket); fall back to
 * storage_path keyed under the legacy `documents` bucket (the only place
 * storage_path historically pointed before the `trips` migration).
 */
async function collectDocumentPaths(tripId: string): Promise<Map<string, Set<string>>> {
  const byBucket = new Map<string, Set<string>>();
  const add = (bucket: string, path: string) => {
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Set<string>());
    byBucket.get(bucket)!.add(path);
  };

  const addFromDocs = (docs: unknown) => {
    if (!Array.isArray(docs)) return;
    for (const d of docs) {
      if (!d || typeof d !== 'object') continue;
      const parsed = parseStorageUrl((d as { file_url?: unknown }).file_url);
      if (parsed) { add(parsed.bucket, parsed.path); continue; }
      const sp = (d as { storage_path?: unknown }).storage_path;
      if (typeof sp === 'string' && sp) add(LEGACY_DOCS_BUCKET, sp);
    }
  };

  // Tables with a top-level `documents` jsonb column.
  for (const table of ['trip_documents', 'activities', 'hotel_stays', 'transfers']) {
    const { data, error } = await supabaseAdmin.from(table).select('documents').eq('trip_id', tripId);
    if (error) { console.error(`deleteTrip: read ${table}.documents failed`, error); continue; }
    for (const row of data ?? []) addFromDocs((row as { documents?: unknown }).documents);
  }

  // Services keep their documents under details.documents.
  {
    const { data, error } = await supabaseAdmin.from('trip_services').select('details').eq('trip_id', tripId);
    if (error) console.error('deleteTrip: read trip_services.details failed', error);
    for (const row of data ?? []) {
      addFromDocs((row as { details?: { documents?: unknown } }).details?.documents);
    }
  }

  return byBucket;
}

/** Remove explicit object paths in chunks (best-effort). */
async function removePaths(bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await supabaseAdmin.storage.from(bucket).remove(chunk);
    if (error) console.error(`deleteTrip: remove ${bucket} chunk failed`, error);
  }
}

/** Sweep everything under `${prefix}/` in a bucket, paginated (best-effort). */
async function purgeBucketByPrefix(bucket: string, prefix: string): Promise<void> {
  const limit = 100;
  let offset = 0;
  for (;;) {
    const { data: files, error } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit, offset });
    if (error) { console.error(`deleteTrip: list ${bucket}/${prefix} failed`, error); return; }
    if (!files?.length) return;
    const toRemove = files.filter((f) => f.name).map((f) => `${prefix}/${f.name}`);
    if (toRemove.length) {
      const { error: rmErr } = await supabaseAdmin.storage.from(bucket).remove(toRemove);
      if (rmErr) console.error(`deleteTrip: remove ${bucket}/${prefix} failed`, rmErr);
    }
    if (files.length < limit) return;
    offset += limit;
  }
}

Deno.serve(async (req) => {
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

    // Step 3 — storage purge (best-effort, must NOT block the delete). Collect
    // DB-tracked attachment paths first (the only way to reach event/service/AI
    // files under attachments/ and ai-uploads/), then sweep the `<tripId>/`
    // prefix across the new `trips` bucket and the legacy buckets — the only way
    // to reach covers (they have no `documents[]` entry).
    try {
      const byBucket = await collectDocumentPaths(tripId);
      for (const [bucket, paths] of byBucket) {
        if (paths.size) await removePaths(bucket, [...paths]);
      }
      for (const bucket of PREFIX_SWEEP_BUCKETS) {
        await purgeBucketByPrefix(bucket, tripId);
      }
    } catch (e) {
      console.error('deleteTrip: storage purge failed', e);
    }

    // Step 4 — delete the trip (critical, last). FK cascades wipe all 21 child
    // tables; trip_subscriptions / partner_clicks are SET NULL (kept).
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
