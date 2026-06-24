#!/usr/bin/env node
// One-off: retire the legacy storage buckets `documents` + `trip-covers` AFTER
// the backfill has moved every live file into `trips` and that's been verified.
//
// Empties each bucket (recursively) then deletes the bucket. This PERMANENTLY
// removes whatever is left — by this point that is only orphan objects (files
// with no live DB reference: discarded AI uploads, replaced covers, re-uploads).
// Verify first that no live `documents[]` / `cover_image_url` still points at a
// legacy bucket (the backfill verification query) before running this.
//
// Run once per Supabase project (dev then prod):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/retire-legacy-buckets.mjs
// Preview without deleting:
//   DRY_RUN=1 SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/retire-legacy-buckets.mjs

import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRY_RUN } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const dry = !!DRY_RUN;
const BUCKETS = ['documents', 'trip-covers'];

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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

async function main() {
  console.log(`Retire legacy buckets${dry ? ' [DRY RUN]' : ''}`);
  for (const bucket of BUCKETS) {
    const objects = await listAll(bucket);
    console.log(`${bucket}: ${objects.length} object(s) to delete, then drop bucket`);
    if (dry) { objects.slice(0, 20).forEach((p) => console.log(`  - ${bucket}/${p}`)); continue; }

    for (let i = 0; i < objects.length; i += 100) {
      const chunk = objects.slice(i, i + 100);
      const { error } = await sb.storage.from(bucket).remove(chunk);
      if (error) console.error(`  remove chunk failed (${bucket}):`, error.message);
    }
    const { error: delErr } = await sb.storage.deleteBucket(bucket);
    if (delErr) console.error(`  deleteBucket ${bucket} failed:`, delErr.message);
    else console.log(`  ${bucket} dropped ✓`);
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
