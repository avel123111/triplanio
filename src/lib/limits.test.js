import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FREE_ACTIVE_TRIP_LIMIT } from './limits.js';

// Дрифт-гард — порог свободного лимита активных трипов живёт в ДВУХ рантаймах
// (кросс-язычного импорта нет: Vite/JS ↔ Postgres):
//   1. фронт — src/lib/limits.js            (FREE_ACTIVE_TRIP_LIMIT — UX-предпроверка)
//   2. SQL   — public.can_create_trip(uuid) (count_active_owned_trips(uid) < N — АВТОРИТЕТ)
// Один порог, два рантайма, один гард: сменить лимит = править ОБА, этот тест краснеет,
// пока JS↔SQL не совпали (TRIP-436). Паттерн «источник + зеркало + гард», как
// tripAddons.test.js. i18n-проза («1 активное путешествие») — намеренно НЕ покрыта
// (задокументировано в limits.js): её сверить машинно нельзя, обновлять руками.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('SQL can_create_trip threshold == FREE_ACTIVE_TRIP_LIMIT', () => {
  const migDir = join(ROOT, 'supabase/migrations');
  // Таймстамп-имена → сортировка = хронология; берём ПОСЛЕДНЕЕ определение
  // (create or replace может переопределить порог более поздней миграцией).
  const src = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse()
    .map((f) => readFileSync(join(migDir, f), 'utf8'))
    .find((s) => /function\s+public\.can_create_trip/i.test(s));
  assert.ok(src, 'не найдена миграция с function public.can_create_trip — гард ослеп');
  const m = src.match(/can_create_trip[\s\S]*?count_active_owned_trips\s*\([^)]*\)\s*<\s*(\d+)/i);
  assert.ok(m, 'не найден порог count_active_owned_trips(...) < N в can_create_trip — гард ослеп');
  assert.equal(Number(m[1]), FREE_ACTIVE_TRIP_LIMIT);
});
