#!/usr/bin/env node
/**
 * import-viator-destinations.mjs — TRIP-146 Phase 3, шаг 2 (загрузка сырья).
 *
 * Заменяет enrich-viator-destinations.mjs (тот матчил по координатам и ПИСАЛ в
 * cities, плодя дубли — это корень фрагментации TRIP-69). Здесь скрипт НИЧЕГО не
 * матчит и НЕ трогает cities: он только тянет чистый Viator-фид и складывает его
 * СЫРЬЁМ в staging-таблицу `public.viator_import`. Весь матч/резолв в geonameid
 * делает SQL (scripts/cities-rebuild.sql) против газеттира — там стабильный ключ.
 *
 * ЧТО ТЯНЕМ
 *   GET /destinations → берём type IN (CITY, TOWN, VILLAGE) с координатами.
 *   На строку: destinationId, name, center.lat/lng, timeZone, iataCodes[0].
 *   country_code в фиде НЕТ — добивается на резолве из газеттира.
 *
 * ПРЕДУСЛОВИЕ
 *   Таблица public.viator_import должна существовать — её создаёт PART 0
 *   в scripts/cities-rebuild.sql (запусти его перед этим скриптом).
 *
 * НАСТРОЙКА (.env в корне репо, НЕ коммитится)
 *   PROD_SERVICE_ROLE_KEY / DEV_SERVICE_ROLE_KEY  # Supabase service_role
 *   VIATOR_API_KEY                                # Viator affiliate key
 *   VIATOR_BASE                                   # опц., дефолт api.viator.com/partner
 *
 * ЗАПУСК (на каждое окружение отдельно — топология проекта)
 *   node scripts/import-viator-destinations.mjs dev   [--dry]
 *   node scripts/import-viator-destinations.mjs prod  [--dry]
 *   --dry — посчитать и НЕ писать.
 *
 * ИДЕМПОТЕНТНОСТЬ
 *   Полная замена: TRUNCATE viator_import → вставка свежего фида. Повторный
 *   прогон даёт то же состояние.
 *
 * БЕЗОПАСНОСТЬ
 *   service_role обходит RLS — держать ключи только в .env, не коммитить.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROD_URL = 'https://tizscxrpuopobgcxbekf.supabase.co';
const DEV_URL = 'https://nydhzevdizkfaxdlikgc.supabase.co';
const VIATOR_VERSION = 'application/json;version=2.0';
const WANTED_TYPES = new Set(['CITY', 'TOWN', 'VILLAGE']);

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const out = {};
  try {
    const raw = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch { /* .env может отсутствовать — возьмём из process.env */ }
  return { ...out, ...process.env };
}

async function fetchViatorDestinations(base, key) {
  const res = await fetch(`${base.replace(/\/$/, '')}/destinations`, {
    method: 'GET',
    headers: { 'exp-api-key': key, Accept: VIATOR_VERSION, 'Accept-Language': 'en-US' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Viator /destinations ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const list = json?.destinations;
  if (!Array.isArray(list)) throw new Error('Unexpected /destinations payload (no destinations[])');
  return list;
}

async function main() {
  const env = loadEnv();
  const target = (process.argv[2] || '').toLowerCase();
  const dry = process.argv.includes('--dry');
  if (target !== 'prod' && target !== 'dev') {
    console.error('Usage: node scripts/import-viator-destinations.mjs <prod|dev> [--dry]');
    process.exit(1);
  }
  const url = target === 'prod' ? PROD_URL : DEV_URL;
  const serviceKey = target === 'prod' ? env.PROD_SERVICE_ROLE_KEY : env.DEV_SERVICE_ROLE_KEY;
  const viatorKey = env.VIATOR_API_KEY;
  const viatorBase = env.VIATOR_BASE || 'https://api.viator.com/partner';
  if (!serviceKey) { console.error(`Missing ${target.toUpperCase()}_SERVICE_ROLE_KEY in .env`); process.exit(1); }
  if (!viatorKey) { console.error('Missing VIATOR_API_KEY in .env'); process.exit(1); }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  console.log(`[${target}] fetching Viator destinations…`);
  const dests = await fetchViatorDestinations(viatorBase, viatorKey);
  const rows = dests
    .filter((d) => WANTED_TYPES.has(d?.type)
      && Number.isFinite(d?.center?.latitude) && Number.isFinite(d?.center?.longitude))
    .map((d) => ({
      viator_dest_id: String(d.destinationId),
      name: d.name || null,
      lat: d.center.latitude,
      lng: d.center.longitude,
      time_zone: d.timeZone || null,
      iata: Array.isArray(d.iataCodes) && d.iataCodes.length ? d.iataCodes[0] : null,
      dest_type: d.type,
    }));
  const byType = rows.reduce((a, r) => ((a[r.dest_type] = (a[r.dest_type] || 0) + 1), a), {});
  console.log(`  total=${dests.length}, wanted-with-coords=${rows.length}`, byType);

  if (dry) { console.log('  --dry: ничего не записано'); return; }

  // Полная замена staging: вычистить и залить свежий фид.
  const { error: delErr } = await db.from('viator_import').delete().neq('viator_dest_id', '');
  if (delErr) { console.error('viator_import delete failed (создан ли PART 0 cities-rebuild.sql?):', delErr.message); process.exit(1); }

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await db.from('viator_import').insert(chunk);
    if (error) throw error;
    console.log(`  inserted ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
  console.log(`[${target}] done — viator_import filled. Next: scripts/cities-rebuild.sql PART 1 (resolve + report).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
