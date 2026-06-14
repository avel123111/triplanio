#!/usr/bin/env node
// One-off backfill of city_visits.city_name_en using LocationIQ reverse (en).
//
// Fills the canonical English city name for existing rows that have coordinates
// but no city_name_en yet. New rows are filled lazily on first hotel-panel open
// (see src/lib/stay22.js → ensureCityNameEn); this script covers historical rows.
//
// Run once per Supabase project (prod + dev):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... LOCATIONIQ_API_KEY=... \
//     node scripts/backfill-city-name-en.mjs
//
// LocationIQ Free is rate-limited (2 req/s) — the script throttles to be safe.

import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOCATIONIQ_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !LOCATIONIQ_API_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOCATIONIQ_API_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reverseEn(lat, lon) {
  const url = `https://us1.locationiq.com/v1/reverse?key=${LOCATIONIQ_API_KEY}`
    + `&lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=en`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`LocationIQ ${res.status}`);
  const d = await res.json();
  const a = d.address || {};
  return a.city || a.town || a.village || a.hamlet || a.suburb || a.municipality || d.name || '';
}

async function main() {
  const { data: rows, error } = await sb
    .from('city_visits')
    .select('id, latitude, longitude, city_name')
    .is('city_name_en', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);
  if (error) throw error;
  console.log(`Rows to backfill: ${rows.length}`);

  let ok = 0, skip = 0, fail = 0;
  for (const r of rows) {
    try {
      const en = await reverseEn(r.latitude, r.longitude);
      if (!en) {
        skip++;
        console.log(`- skip ${r.id} (no name)`);
      } else {
        const { error: upErr } = await sb.from('city_visits').update({ city_name_en: en }).eq('id', r.id);
        if (upErr) throw upErr;
        ok++;
        console.log(`✓ ${r.city_name} → ${en}`);
      }
    } catch (e) {
      fail++;
      console.error(`✗ ${r.id}: ${e.message}`);
    }
    await sleep(600); // stay under LocationIQ Free 2 req/s
  }
  console.log(`Done. ok=${ok} skip=${skip} fail=${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
