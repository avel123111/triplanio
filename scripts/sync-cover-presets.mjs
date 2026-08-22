#!/usr/bin/env node
/**
 * sync-cover-presets.mjs — перенос галереи обложек трипа DEV → PROD.
 *
 * НАЗНАЧЕНИЕ
 *   Картинки-пресеты обложек живут НЕ в репозитории, а в Supabase (публичный
 *   бакет `trip-cover-presets` + таблица-каталог `cover_presets`) — именно для
 *   того, чтобы пополнять набор без деплоя. Бакеты и таблицы у dev и prod
 *   РАЗДЕЛЬНЫЕ, поэтому мердж кода в `main` привозит на prod пустую галерею:
 *   схема (миграция `20260820191733_trip_cover_presets`) приезжает через CI/CD,
 *   а СОДЕРЖИМОЕ каталога — нет. Этот скрипт и есть недостающий шаг.
 *
 * ЧТО ДЕЛАЕТ (идемпотентно, можно гонять повторно)
 *   1. читает каталог dev  (`cover_presets`, service_role — таблица deny-all);
 *   2. докачивает в prod-бакет файлы, которых там ещё нет;
 *   3. вставляет в prod-каталог недостающие строки, сохраняя `sort`/`active`.
 *   Уже существующие файлы и строки не трогает: повторный запуск = «0 новых».
 *
 * ПОРЯДОК ЗАПУСКА
 *   ТОЛЬКО ПОСЛЕ мерджа `dev → main` и зелёного деплоя: до него на prod нет ни
 *   бакета, ни таблицы, и скрипт честно упадёт с этим сообщением.
 *
 * НАСТРОЙКА (один раз)
 *   В корне репозитория `.env` (в .gitignore, не коммитится) с двумя ключами —
 *   тот же файл, что использует `clone-trip.mjs`:
 *     PROD_SERVICE_ROLE_KEY=...   # Supabase prod → Settings → API → service_role
 *     DEV_SERVICE_ROLE_KEY=...    # Supabase dev  → Settings → API → service_role
 *   service_role обходит RLS: каталог — ярус D (deny-all), у публичного бакета
 *   намеренно НЕТ SELECT-политики (инвариант TRIP-48), листинг иначе не пройдёт.
 *
 * ЗАПУСК
 *   node scripts/sync-cover-presets.mjs            # разбор полётов, НИЧЕГО не пишет
 *   node scripts/sync-cover-presets.mjs --apply    # собственно перенос
 *
 * БЕЗОПАСНОСТЬ
 *   Пишет ТОЛЬКО в prod-бакет обложек и prod-таблицу `cover_presets`; из dev —
 *   читает. Ничьи обложки сломать не может: трип ссылается на URL картинки, а не
 *   на строку каталога. Ключи держать только в `.env`, никогда не коммитить.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// --- конфигурация проектов (те же ref-ы, что в clone-trip.mjs) --------------
const PROD_REF = 'tizscxrpuopobgcxbekf';
const DEV_REF = 'nydhzevdizkfaxdlikgc';
const BUCKET = 'trip-cover-presets';

const projectUrl = (ref) => `https://${ref}.supabase.co`;

/** Публичный URL объекта бакета пресетов у проекта `ref`. */
export function publicUrl(ref, name) {
  return `${projectUrl(ref)}/storage/v1/object/public/${BUCKET}/${name}`;
}

/**
 * Имя файла в бакете `ref`, если url — это ссылка на объект ЭТОГО бакета;
 * иначе null (в каталоге может лежать и посторонняя ссылка — её не мигрируем).
 */
export function objectName(url, ref) {
  const prefix = publicUrl(ref, '');
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
  const name = url.slice(prefix.length);
  return name ? decodeURIComponent(name) : null;
}

// --- загрузка .env (минимальный парсер, как в clone-trip.mjs) --------------
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

/** Все объекты бакета (пагинация: страница дашборда отдаёт по 100). */
async function listBucket(sb) {
  const out = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await sb.storage.from(BUCKET).list('', { limit, offset });
    if (error) throw new Error(`list ${BUCKET} failed: ${error.message}`);
    if (!data?.length) return out;
    out.push(...data.map((e) => e.name));
    if (data.length < limit) return out;
  }
}

async function main() {
  loadEnv();
  const DEV_KEY = process.env.DEV_SERVICE_ROLE_KEY;
  const PROD_KEY = process.env.PROD_SERVICE_ROLE_KEY;
  if (!DEV_KEY || !PROD_KEY) {
    console.error('Missing DEV_SERVICE_ROLE_KEY / PROD_SERVICE_ROLE_KEY (см. блок НАСТРОЙКА в шапке).');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');

  // Клиент подтягиваем ЗДЕСЬ, а не в шапке: пересчёт URL-ов закрыт тестом, и
  // тест не должен тащить за собой node_modules ради двух чистых функций.
  const { createClient } = await import('@supabase/supabase-js');
  const dev = createClient(projectUrl(DEV_REF), DEV_KEY, { auth: { persistSession: false } });
  const prod = createClient(projectUrl(PROD_REF), PROD_KEY, { auth: { persistSession: false } });

  console.log(`Галерея обложек: dev → prod${apply ? '' : '  [DRY RUN — ничего не пишем]'}`);

  // 1. Каталог dev — источник и набора, и порядка.
  const { data: devRows, error: devErr } = await dev
    .from('cover_presets').select('image_url, sort, active').order('sort', { ascending: true });
  if (devErr) throw new Error(`dev cover_presets select failed: ${devErr.message}`);
  if (!devRows?.length) { console.log('В dev-каталоге пусто — переносить нечего.'); return; }

  const items = [];
  for (const row of devRows) {
    const name = objectName(row.image_url, DEV_REF);
    if (!name) { console.warn(`  ! пропуск (ссылка вне бакета ${BUCKET}): ${row.image_url}`); continue; }
    items.push({ name, sort: row.sort, active: row.active, prodUrl: publicUrl(PROD_REF, name) });
  }
  console.log(`Каталог dev: ${devRows.length} строк(и), к переносу пригодно ${items.length}.`);

  // 2. Бакет на prod обязан УЖЕ существовать: его создаёт миграция через CI/CD.
  const { data: bucket, error: bucketErr } = await prod.storage.getBucket(BUCKET);
  if (bucketErr || !bucket) {
    console.error(`На prod нет бакета ${BUCKET}: ${bucketErr?.message || 'не найден'}.`);
    console.error('Сначала смёржи dev → main и дождись зелёного деплоя (миграция 20260820191733).');
    process.exit(1);
  }

  // 3. Файлы: докачиваем только отсутствующие. Перезалив существующего файла —
  //    не задача переноса: у него тот же URL, а значит те же байты у всех, кто
  //    его уже выбрал.
  const prodNames = new Set(await listBucket(prod));
  const missingFiles = items.filter((i) => !prodNames.has(i.name));
  console.log(`Файлы: на prod ${prodNames.size}, докачать ${missingFiles.length}.`);
  for (const item of missingFiles) {
    if (!apply) { console.log(`  + ${item.name}`); continue; }
    const { data: blob, error: dlErr } = await dev.storage.from(BUCKET).download(item.name);
    if (dlErr || !blob) { console.error(`  ! скачать ${item.name} не вышло: ${dlErr?.message}`); continue; }
    const { error: upErr } = await prod.storage.from(BUCKET)
      .upload(item.name, blob, { contentType: blob.type || 'image/webp', upsert: false });
    if (upErr) { console.error(`  ! залить ${item.name} не вышло: ${upErr.message}`); continue; }
    console.log(`  + ${item.name} (${blob.size} B)`);
  }

  // 4. Каталог: вставляем недостающие строки. Ключ идемпотентности — image_url
  //    (уникального индекса на нём нет, поэтому сверяем сами, а не ON CONFLICT).
  const { data: prodRows, error: prodErr } = await prod.from('cover_presets').select('image_url');
  if (prodErr) throw new Error(`prod cover_presets select failed: ${prodErr.message}`);
  const known = new Set((prodRows || []).map((r) => r.image_url));
  const missingRows = items.filter((i) => !known.has(i.prodUrl));
  console.log(`Каталог prod: ${known.size} строк(и), вставить ${missingRows.length}.`);
  if (missingRows.length && apply) {
    const { error } = await prod.from('cover_presets')
      .insert(missingRows.map((i) => ({ image_url: i.prodUrl, sort: i.sort, active: i.active })));
    if (error) throw new Error(`prod cover_presets insert failed: ${error.message}`);
  }
  for (const item of missingRows) console.log(`  + sort=${item.sort} ${item.name}`);

  console.log(apply
    ? 'Готово. Проверь витрину: select id,image_url,sort from public.cover_presets where active order by sort;'
    : 'Это был разбор полётов. Повтори с --apply, чтобы перенести.');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(e.message); process.exit(1); });
