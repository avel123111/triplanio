// TRIP-431 (Phase 1): держит регрессию приватности — RPC get_my_trip_cards
// (композит главной, TRIP-403) НЕ должна отдавать сырой `email` участника на
// фронт. Адрес с доменом — PII; на главной он играл единственную роль (инициал
// безымянного аватара), и эта роль перенесена на сервер полем `name`
// (displayName-эквивалент в SQL). Тест краснеет, если ключ `'email'` вернут в
// проекцию участников, или если поле `'name'` из неё уберут.
//
// Проверяем ПОСЛЕДНЮЮ по таймстампу миграцию, что определяет функцию — именно
// её тело действует после `db push` (миграции катятся по возрастанию версии).
// Это структурный гард на форму ответа, не на живую БД (её тут нет).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

// Комментарии гасим ПЕРЕД разбором (как trip-data-include.test.js): иначе тест
// покраснел бы на слове «email» в шапке-документации, а не на коде.
const strip = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

// Последняя по имени (=таймстампу) миграция, которая CREATE-ит функцию.
function activeDefinition() {
  const files = readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith('.sql'))
    .sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const code = strip(readFileSync(MIGRATIONS + files[i], 'utf8'));
    if (/create\s+(or\s+replace\s+)?function\s+public\.get_my_trip_cards/i.test(code)) {
      return { file: files[i], code };
    }
  }
  return null;
}

test('active get_my_trip_cards never returns a raw participant email', () => {
  const def = activeDefinition();
  assert.ok(def, 'no migration defines public.get_my_trip_cards');

  // Проекция участников (CTE parts) отдаёт серверно-резолвнутое имя…
  assert.match(def.code, /'name'/, `${def.file}: participant projection lost the 'name' field`);
  // …и НЕ отдаёт сырой email как ключ jsonb-объекта карточки.
  assert.doesNotMatch(def.code, /'email'/, `${def.file}: participant projection leaks raw 'email'`);
});
