#!/usr/bin/env node
/**
 * enrich-viator-destinations.mjs — разовое обогащение справочника cities
 * идентификаторами направлений Viator (Phase 2 ТЗ VIATOR_CITIES_TZ_2026-06-18).
 *
 * НАЗНАЧЕНИЕ
 *   Тянет полный список направлений Viator (GET /destinations), берёт только
 *   type === 'CITY', и сопоставляет каждое с строкой cities ПО КООРДИНАТАМ
 *   (ближайшая в радиусе BATCH_RADIUS_KM):
 *     - нашли существующий город  → проставляем cities.viator_dest_id;
 *     - не нашли                  → создаём новую строку cities (source='viator').
 *   Имя в матче НЕ участвует (Sevilla != Seville, тёзки, языки) — только координаты.
 *
 * ПОЧЕМУ ТУГОЙ РАДИУС
 *   Города Viator плотнее наших аэропортовых (La Jolla ~18 км от San Diego —
 *   отдельный CITY). Радиус рантайм-резолвера (resolve_city_id, 30 км в 0036) тут
 *   НЕ годится: склеит La Jolla с San Diego. Поэтому батч матчит тугo (~10 км):
 *   только истинно тот же город обогащаем, остальное — новая строка.
 *   (Рантайм-радиус resolve_city_id понижается отдельной мини-миграцией Ф2.)
 *
 * НАСТРОЙКА (.env в корне репо, НЕ коммитится)
 *   PROD_SERVICE_ROLE_KEY=...   # Supabase prod service_role (обходит RLS)
 *   DEV_SERVICE_ROLE_KEY=...    # Supabase dev  service_role
 *   VIATOR_API_KEY=...          # Viator affiliate key (exp-api-key)
 *   VIATOR_BASE=...             # опц., по умолчанию https://api.viator.com/partner
 *
 * ЗАПУСК (по топологии — на ОБА окружения отдельно)
 *   node scripts/enrich-viator-destinations.mjs dev   [--dry]
 *   node scripts/enrich-viator-destinations.mjs prod  [--dry]
 *   --dry — только посчитать, ничего не писать.
 *
 * ИДЕМПОТЕНТНОСТЬ
 *   Повторный прогон не плодит дублей: если у ближайшего города уже стоит этот
 *   viator_dest_id — пропуск; вставка только когда совпадения нет вовсе.
 *
 * БЕЗОПАСНОСТЬ
 *   service_role даёт полный доступ к БД. Держать только в .env, не коммитить.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- конфигурация ----------------------------------------------------------
const PROD_URL = 'https://tizscxrpuopobgcxbekf.supabase.co';
const DEV_URL = 'https://nydhzevdizkfaxdlikgc.supabase.co';
const BATCH_RADIUS_KM = 10;            // туго: «тот же город», не «рядом»
const VIATOR_VERSION = 'application/json;version=2.0';

// --- .env (минимальный парсер, без зависимостей) ---------------------------
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

// --- haversine (км) --------------------------------------------------------
function distKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// --- Viator /destinations --------------------------------------------------
async function fetchViatorDestinations(base, key) {
  const res = await fetch(`${base.replace(/\/$/, '')}/destinations`, {
    method: 'GET',
    headers: {
      'exp-api-key': key,
      Accept: VIATOR_VERSION,
      'Accept-Language': 'en-US',
    },
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

// --- main ------------------------------------------------------------------
async function main() {
  const env = loadEnv();
  const target = (process.argv[2] || '').toLowerCase();
  const dry = process.argv.includes('--dry');
  if (target !== 'prod' && target !== 'dev') {
    console.error('Usage: node scripts/enrich-viator-destinations.mjs <prod|dev> [--dry]');
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
  const cityDests = dests.filter(
    (d) => d?.type === 'CITY' &&
      Number.isFinite(d?.center?.latitude) && Number.isFinite(d?.center?.longitude),
  );
  console.log(`  total=${dests.length}, CITY-with-coords=${cityDests.length}`);

  // загрузка всех cities в память (несколько тысяч — ок для разового скрипта)
  console.log(`[${target}] loading cities…`);
  const cities = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('cities')
      .select('id, lat, lng, viator_dest_id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    cities.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`  cities loaded=${cities.length}`);

  // nearest within BATCH_RADIUS_KM (bbox-префильтр + haversine)
  const BOX = 0.2; // ~22 км по широте — безопасно перекрывает 10 км
  function nearestCity(lat, lng) {
    let best = null, bestD = Infinity;
    for (const c of cities) {
      if (c.lat == null || c.lng == null) continue;
      if (Math.abs(c.lat - lat) > BOX || Math.abs(c.lng - lng) > BOX) continue;
      const d = distKm(lat, lng, c.lat, c.lng);
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= BATCH_RADIUS_KM ? best : null;
  }

  const toUpdate = []; // { id, viator_dest_id }
  const toInsert = []; // new cities rows
  let skipped = 0;

  for (const d of cityDests) {
    const lat = d.center.latitude, lng = d.center.longitude;
    const vid = String(d.destinationId);
    const match = nearestCity(lat, lng);
    if (match) {
      if (match.viator_dest_id === vid) { skipped++; continue; }       // уже проставлен
      if (match.viator_dest_id && match.viator_dest_id !== vid) { skipped++; continue; } // занят другим — ручной разбор
      toUpdate.push({ id: match.id, viator_dest_id: vid });
      match.viator_dest_id = vid; // чтобы следующий dest не сел на ту же строку
    } else {
      const row = {
        name_en: d.name || null,
        lat, lng,
        time_zone: d.timeZone || null,
        iata_code: Array.isArray(d.iataCodes) && d.iataCodes.length ? d.iataCodes[0] : null,
        viator_dest_id: vid,
        source: 'viator',
      };
      toInsert.push(row);
      cities.push({ id: -1, lat, lng, viator_dest_id: vid }); // чтобы соседний dest матчился на него
    }
  }

  console.log(`[${target}] plan: update=${toUpdate.length}, insert=${toInsert.length}, skipped=${skipped}`);
  if (dry) { console.log('  --dry: ничего не записано'); return; }

  // запись пачками
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error } = await db.from('cities').insert(chunk);
    if (error) throw error;
    console.log(`  inserted ${Math.min(i + CHUNK, toInsert.length)}/${toInsert.length}`);
  }
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK);
    // по одному update на строку (PostgREST не делает bulk-update по разным значениям)
    await Promise.all(
      chunk.map((u) =>
        db.from('cities').update({ viator_dest_id: u.viator_dest_id, updated_at: new Date().toISOString() }).eq('id', u.id),
      ),
    );
    console.log(`  updated ${Math.min(i + CHUNK, toUpdate.length)}/${toUpdate.length}`);
  }
  console.log(`[${target}] done.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
