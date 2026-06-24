#!/usr/bin/env node
// One-off backfill: consolidate every trip file into the private `trips` bucket
// under the flat key `<tripId>/<name>`, re-sign URLs, and rewrite the DB.
//
// Migrates objects out of the legacy buckets:
//   documents/<tripId>/<file>            (trip docs)        → trips/<tripId>/<file>
//   documents/attachments/<uid>/<file>   (event/service)    → trips/<tripId>/<uid>-<file>
//   documents/ai-uploads/<uid>/<file>    (AI uploads)       → trips/<tripId>/<uid>-<file>
//   trip-covers/<tripId>/<file>          (cover, public)    → trips/<tripId>/<file>
//   trip-covers/new/<file>               (cover, pre-trip)  → trips/<tripId>/<file>
//
// DB-driven: we walk the rows that hold file references (jsonb `documents[]` on
// trip_documents/activities/hotel_stays/transfers, `details.documents[]` on
// trip_services, and `trips.cover_image_url`), so the trip↔object link is the
// DB itself — no fragile path-prefix matching. Covers in `new/` are migrated
// correctly because we read them off their owning trip row.
//
// Idempotent: the target key is derived deterministically from the source key,
// and rows already pointing at `trips/<tripId>/…` are skipped. Per object we
// copy → re-sign → rewrite DB → remove source, so a crash mid-run leaves the
// source intact for a clean re-run.
//
// Run once per Supabase project (dev FIRST, verify, then prod):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-storage-trips.mjs
// Preview without writing:
//   DRY_RUN=1 SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-storage-trips.mjs

import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRY_RUN } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const dry = !!DRY_RUN;

const TRIP_BUCKET = 'trips';
const LEGACY_BUCKETS = ['documents', 'trip-covers'];
const SIGNED_URL_TTL = 315360000; // 10 years

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const stats = { moved: 0, skipped: 0, failed: 0, unmatched: 0, rowsUpdated: 0 };
const movedSources = new Set(); // `${bucket}/${path}` we relocated (for orphan report)

function parseStorageObjectUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  const m = url.match(/\/object\/(?:sign|public|authenticated)\/([^/]+)\/([^?]+)/);
  if (!m) return null;
  let path = m[2];
  try { path = decodeURIComponent(path); } catch { /* keep raw */ }
  return { bucket: m[1], path };
}

// Deterministic flat name for the target key: drop the leading prefix segment
// (`attachments` / `ai-uploads` / `new` / `_drafts` / the old <tripId>) and join
// the rest with '-' so the embedded <uid> keeps uniqueness without nesting.
function flatName(oldPath) {
  const parts = oldPath.split('/').filter(Boolean);
  return parts.length <= 1 ? parts[0] : parts.slice(1).join('-');
}

const isMigrated = (bucket, path, tripId) => bucket === TRIP_BUCKET && path.startsWith(`${tripId}/`);

async function ensureAtNewPath(oldBucket, oldPath, newPath) {
  // copy source → trips/newPath, tolerating an already-copied target and a
  // source that a prior run already removed (verify the target exists instead).
  const { error } = await sb.storage.from(oldBucket).copy(oldPath, newPath, { destinationBucket: TRIP_BUCKET });
  if (error && !/exists/i.test(error.message || '')) {
    if (/not.?found|does not exist/i.test(error.message || '')) {
      const { error: probe } = await sb.storage.from(TRIP_BUCKET).createSignedUrl(newPath, 60);
      if (probe) throw new Error(`source gone and target missing: ${error.message}`);
      return; // already migrated by a prior run
    }
    throw error;
  }
}

// Returns { url, path } for the migrated object, or throws.
async function migrateObject(oldBucket, oldPath, tripId) {
  const newPath = `${tripId}/${flatName(oldPath)}`;
  if (dry) { stats.moved++; return { url: `(dry) trips/${newPath}`, path: newPath }; }
  await ensureAtNewPath(oldBucket, oldPath, newPath);
  const { data, error } = await sb.storage.from(TRIP_BUCKET).createSignedUrl(newPath, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) throw new Error(`sign failed: ${error?.message}`);
  await sb.storage.from(oldBucket).remove([oldPath]); // best-effort
  movedSources.add(`${oldBucket}/${oldPath}`);
  stats.moved++;
  return { url: data.signedUrl, path: newPath };
}

// Locate an object reference (file_url preferred; storage_path is legacy
// documents-bucket only). Returns { bucket, path } or null.
function locate(doc) {
  const fromUrl = parseStorageObjectUrl(doc?.file_url);
  if (fromUrl) return fromUrl;
  if (typeof doc?.storage_path === 'string' && doc.storage_path) {
    return { bucket: 'documents', path: doc.storage_path };
  }
  return null;
}

async function processDocs(docs, tripId, label) {
  if (!Array.isArray(docs)) return { changed: false, docs };
  let changed = false;
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    const loc = locate(doc);
    if (!loc) { stats.unmatched++; console.warn(`  ? unmatched doc in ${label}:`, doc.file_name || doc.file_url); continue; }
    if (isMigrated(loc.bucket, loc.path, tripId)) {
      if (doc.storage_path !== loc.path) { doc.storage_path = loc.path; changed = true; }
      stats.skipped++;
      continue;
    }
    try {
      const res = await migrateObject(loc.bucket, loc.path, tripId);
      doc.file_url = res.url;
      doc.storage_path = res.path;
      changed = true;
    } catch (e) {
      stats.failed++;
      console.error(`  x failed ${loc.bucket}/${loc.path} (${label}): ${e.message}`);
    }
  }
  return { changed, docs };
}

async function backfillTable(table, col /* 'documents' | 'details' */) {
  const { data, error } = await sb.from(table).select(`id, trip_id, ${col}`).not(col, 'is', null);
  if (error) { console.error(`read ${table} failed`, error.message); return; }
  for (const row of data ?? []) {
    const tripId = row.trip_id;
    if (!tripId) continue;
    if (col === 'documents') {
      const { changed, docs } = await processDocs(row.documents, tripId, `${table}#${row.id}`);
      if (changed && !dry) {
        const { error: upErr } = await sb.from(table).update({ documents: docs }).eq('id', row.id);
        if (upErr) console.error(`  x update ${table}#${row.id}:`, upErr.message); else stats.rowsUpdated++;
      } else if (changed) stats.rowsUpdated++;
    } else {
      const details = row.details || {};
      const { changed, docs } = await processDocs(details.documents, tripId, `${table}#${row.id}`);
      if (changed && !dry) {
        const { error: upErr } = await sb.from(table).update({ details: { ...details, documents: docs } }).eq('id', row.id);
        if (upErr) console.error(`  x update ${table}#${row.id}:`, upErr.message); else stats.rowsUpdated++;
      } else if (changed) stats.rowsUpdated++;
    }
  }
}

async function backfillCovers() {
  const { data, error } = await sb.from('trips').select('id, cover_image_url').not('cover_image_url', 'is', null);
  if (error) { console.error('read trips covers failed', error.message); return; }
  for (const row of data ?? []) {
    const loc = parseStorageObjectUrl(row.cover_image_url);
    if (!loc) continue; // external / non-storage URL
    if (loc.bucket !== TRIP_BUCKET && !LEGACY_BUCKETS.includes(loc.bucket)) continue;
    if (isMigrated(loc.bucket, loc.path, row.id)) { stats.skipped++; continue; }
    try {
      const res = await migrateObject(loc.bucket, loc.path, row.id);
      if (!dry) {
        const { error: upErr } = await sb.from('trips').update({ cover_image_url: res.url }).eq('id', row.id);
        if (upErr) console.error(`  x update cover trips#${row.id}:`, upErr.message); else stats.rowsUpdated++;
      } else stats.rowsUpdated++;
    } catch (e) {
      stats.failed++;
      console.error(`  x cover failed ${loc.bucket}/${loc.path} (trips#${row.id}): ${e.message}`);
    }
  }
}

async function listAll(bucket, prefix = '') {
  const out = [];
  const limit = 100;
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit, offset });
    if (error) { console.error(`list ${bucket}/${prefix} failed`, error.message); break; }
    if (!data?.length) break;
    for (const e of data) {
      const full = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...await listAll(bucket, full)); // folder
      else out.push(full);
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

async function reportOrphans() {
  console.log('\n--- orphan report (objects left in legacy buckets) ---');
  for (const bucket of LEGACY_BUCKETS) {
    const remaining = (await listAll(bucket)).filter((p) => !movedSources.has(`${bucket}/${p}`));
    console.log(`${bucket}: ${remaining.length} object(s) not migrated by this run`);
    remaining.slice(0, 50).forEach((p) => console.log(`  - ${bucket}/${p}`));
    if (remaining.length > 50) console.log(`  … +${remaining.length - 50} more`);
  }
}

async function main() {
  console.log(`Backfill storage → '${TRIP_BUCKET}' bucket${dry ? ' [DRY RUN]' : ''}`);
  await backfillTable('trip_documents', 'documents');
  await backfillTable('activities', 'documents');
  await backfillTable('hotel_stays', 'documents');
  await backfillTable('transfers', 'documents');
  await backfillTable('trip_services', 'details');
  await backfillCovers();
  if (!dry) await reportOrphans();
  console.log('\nDone.', JSON.stringify(stats));
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
