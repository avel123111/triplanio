#!/usr/bin/env node
/**
 * clone-trip.mjs — клонирование трипа со всеми связанными данными PROD → DEV.
 *
 * НАЗНАЧЕНИЕ
 *   Берёт один трип из prod-Supabase и его дочерние записи, генерирует новые
 *   UUID, ремапит все внутренние ссылки и переписывает владельцев на одного
 *   dev-пользователя, после чего вставляет всё в dev-Supabase. Используется для
 *   воспроизведения реальных данных в тестовом окружении.
 *
 * ЧТО КЛОНИРУЕТСЯ
 *   trips → city_visits → hotel_stays / activities / transfers →
 *   trip_budgets → budget_categories → budget_expenses →
 *   trip_services → trip_documents → chats → chat_messages / chat_reads →
 *   trip_members
 *
 * ЧТО НЕ КЛОНИРУЕТСЯ (окруженческое / платёжное / интеграции)
 *   trip_subscriptions, stripe_events, notifications, partner_clicks,
 *   trip_telegram_integrations, telegram_link_tokens, telegram_reminder_logs,
 *   n8n_chat_messages, n8n_chat_histories.
 *
 * НАСТРОЙКА (один раз)
 *   В корне репозитория создать .env (НЕ коммитится — уже в .gitignore) с двумя
 *   service_role ключами:
 *     PROD_SERVICE_ROLE_KEY=...   # Supabase prod → Settings → API → service_role
 *     DEV_SERVICE_ROLE_KEY=...    # Supabase dev  → Settings → API → service_role
 *   service_role обходит RLS — иначе скрипт не прочитает/не запишет чужие трипы.
 *
 * ЗАПУСК
 *   node scripts/clone-trip.mjs <PROD_TRIP_ID> [DEV_USER_ID]
 *   DEV_USER_ID необязателен; по умолчанию — тестовый dev-пользователь ниже.
 *
 * БЕЗОПАСНОСТЬ
 *   service_role ключи дают полный доступ к БД. Держать только в .env, никогда
 *   не коммитить и не передавать. Скрипт пишет ТОЛЬКО в dev, из prod — читает.
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- конфигурация проектов -------------------------------------------------
const PROD_URL = 'https://tizscxrpuopobgcxbekf.supabase.co';
const DEV_URL = 'https://nydhzevdizkfaxdlikgc.supabase.co';
const DEFAULT_DEV_USER = '2c36dddc-d2a5-4cad-882b-c397503a8fba';

// --- загрузка .env (минимальный парсер, без зависимостей) ------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  try {
    const raw = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env может отсутствовать, если ключи уже в окружении */ }
}
loadEnv();

const PROD_KEY = process.env.PROD_SERVICE_ROLE_KEY;
const DEV_KEY = process.env.DEV_SERVICE_ROLE_KEY;

// --- аргументы -------------------------------------------------------------
const TRIP_ID = process.argv[2];
const DEV_USER = process.argv[3] || DEFAULT_DEV_USER;

if (!TRIP_ID) {
  console.error('Usage: node scripts/clone-trip.mjs <PROD_TRIP_ID> [DEV_USER_ID]');
  process.exit(1);
}
if (!PROD_KEY || !DEV_KEY) {
  console.error('Missing PROD_SERVICE_ROLE_KEY / DEV_SERVICE_ROLE_KEY (see .env setup in header).');
  process.exit(1);
}

const prod = createClient(PROD_URL, PROD_KEY, { auth: { persistSession: false } });
const dev = createClient(DEV_URL, DEV_KEY, { auth: { persistSession: false } });

// --- описание таблиц -------------------------------------------------------
// fk:   колонки-ссылки внутри клонируемого набора → ремап через idMap
// user: колонки-владельцы → переписываются на DEV_USER
// Порядок массива = порядок вставки (родитель раньше ребёнка).
const TABLES = [
  { name: 'trips',            scope: 'self',    fk: [],                                              user: ['created_by'] },
  { name: 'city_visits',      scope: 'trip_id', fk: [],                                              user: ['created_by'] },
  { name: 'hotel_stays',      scope: 'trip_id', fk: ['city_visit_id'],                               user: ['created_by'] },
  { name: 'activities',       scope: 'trip_id', fk: ['city_visit_id'],                               user: ['created_by'] },
  { name: 'transfers',        scope: 'trip_id', fk: ['from_city_visit_id', 'to_city_visit_id'],      user: ['created_by'] },
  { name: 'trip_budgets',     scope: 'trip_id', fk: [],                                              user: ['created_by'] },
  { name: 'budget_categories',scope: 'trip_id', fk: [],                                              user: ['created_by'] },
  { name: 'budget_expenses',  scope: 'trip_id', fk: ['category_id', 'source_id'],                    user: ['created_by'] },
  { name: 'trip_services',    scope: 'trip_id', fk: [],                                              user: ['created_by'] },
  { name: 'trip_documents',   scope: 'trip_id', fk: [],                                              user: ['created_by'] },
  { name: 'chats',            scope: 'trip_id', fk: [],                                              user: [] },
  { name: 'chat_messages',    scope: 'trip_id', fk: ['chat_id'],                                     user: ['user_id', 'created_by'] },
  { name: 'chat_reads',       scope: 'trip_id', fk: ['chat_id'],                                     user: ['user_id'] },
  { name: 'trip_members',     scope: 'trip_id', fk: [],                                              user: ['user_id', 'created_by', 'invited_by'] },
];

const idMap = new Map();         // oldId → newId (по всем таблицам)
const newTripId = randomUUID();
idMap.set(TRIP_ID, newTripId);

async function fetchRows(table, scope) {
  const q = prod.from(table).select('*');
  const { data, error } = scope === 'self'
    ? await q.eq('id', TRIP_ID)
    : await q.eq('trip_id', TRIP_ID);
  if (error) throw new Error(`read ${table}: ${error.message}`);
  return data || [];
}

function remapRow(row, cfg) {
  const out = { ...row };
  // новый id + регистрация в карте
  if (out.id !== undefined) {
    const nid = idMap.get(out.id) || randomUUID();
    idMap.set(out.id, nid);
    out.id = nid;
  }
  // trip_id всегда на новый трип
  if (out.trip_id !== undefined && out.trip_id !== null) out.trip_id = newTripId;
  // внутренние ссылки
  for (const col of cfg.fk) {
    if (out[col] != null && idMap.has(out[col])) out[col] = idMap.get(out[col]);
    // source_id может ссылаться на не-клонируемую сущность → если нет в карте, обнуляем
    else if (col === 'source_id' && out[col] != null && !idMap.has(out[col])) out[col] = null;
  }
  // владельцы → dev-пользователь
  for (const col of cfg.user) {
    if (out[col] !== undefined) out[col] = DEV_USER;
  }
  return out;
}

async function run() {
  console.log(`\nClone trip\n  prod trip : ${TRIP_ID}\n  dev user  : ${DEV_USER}\n  new trip  : ${newTripId}\n`);

  // Фаза 1: пройти таблицы по порядку, сгенерировать новые id и вставить.
  // idMap наполняется по ходу, поэтому fk дочерних таблиц уже видят новые id
  // родителей (порядок в TABLES это гарантирует).
  for (const cfg of TABLES) {
    const rows = await fetchRows(cfg.name, cfg.scope);
    if (rows.length === 0) { console.log(`  ${cfg.name.padEnd(18)} 0`); continue; }
    const mapped = rows.map((r) => remapRow(r, cfg));
    const { error } = await dev.from(cfg.name).insert(mapped);
    if (error) throw new Error(`write ${cfg.name}: ${error.message}`);
    console.log(`  ${cfg.name.padEnd(18)} ${mapped.length}`);
  }

  console.log(`\n✓ Done. New dev trip id: ${newTripId}\n`);
}

run().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exit(1); });
