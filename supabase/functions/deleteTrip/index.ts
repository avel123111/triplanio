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
 *   2. Storage purge of both buckets (best-effort — an orphan file must never
 *      block the delete).
 *   3. The trip DELETE last; Postgres cascades wipe the 21 child tables.
 *
 * Auth: OWNER ONLY (trips.created_by === caller). Mirrors the RLS policy
 * `trips_delete: created_by = auth.uid()` — the admin client bypasses RLS, so
 * the check is duplicated explicitly here. Admin / viewer / member cannot
 * delete: a trip delete wipes every member's data, so only the creator may.
 *
 * Storage layout note: only trip documents (`${tripId}/…`) and covers
 * (`${tripId}/…`) are keyed by trip. Event / service / AI attachments live
 * under `attachments/<uid>/…` and `ai-uploads/<uid>/…` with NO trip in the
 * path, so a prefix list alone can't find them. We collect their object paths
 * from the DB `documents[]` arrays (storage_path, or parsed from file_url when
 * absent — AI uploads drop storage_path) and remove them explicitly, then add
 * a prefix sweep as a safety net for trip-keyed files.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { disconnectTripTelegram } from '../_shared/telegramTeardown.ts';

const DOCS_BUCKET = 'documents';
const COVERS_BUCKET = 'trip-covers';

/**
 * Extract a `documents` bucket object path from a stored file_url. Handles both
 * signed (…/object/sign/documents/<path>?token=…) and public
 * (…/object/public/documents/<path>) URLs. Returns null if it isn't a
 * documents-bucket URL.
 */
function pathFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  const m = url.match(/\/object\/(?:sign|public|authenticated)\/documents\/([^?]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/**
 * Walk every `documents[]` array attached to the trip and collect the object
 * paths in the `documents` bucket. Prefer storage_path; fall back to parsing
 * file_url (AI-block uploads persist only file_url + file_name).
 */
async function collectDocumentPaths(tripId: string): Promise<string[]> {
  const paths = new Set<string>();

  const addFromDocs = (docs: unknown) => {
    if (!Array.isArray(docs)) return;
    for (const d of docs) {
      if (!d || typeof d !== 'object') continue;
      const sp = (d as { storage_path?: unknown }).storage_path;
      if (typeof sp === 'string' && sp) { paths.add(sp); continue; }
      const p = pathFromUrl((d as { file_url?: unknown }).file_url);
      if (p) paths.add(p);
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

  return [...paths];
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
    // files under attachments/ and ai-uploads/), then sweep trip-keyed prefixes.
    try {
      const docPaths = await collectDocumentPaths(tripId);
      if (docPaths.length) await removePaths(DOCS_BUCKET, docPaths);
      await purgeBucketByPrefix(DOCS_BUCKET, tripId);     // trip documents (safety net)
      await purgeBucketByPrefix(COVERS_BUCKET, tripId);   // cover image
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
