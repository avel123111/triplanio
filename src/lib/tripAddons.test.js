import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ADDON_KEYS, PRO_ONLY_ADDONS, getAddons, normalizeAddons } from './tripAddons.js';

// Drift guard — множество Pro-аддонов живёт в ТРЁХ рантаймах (кросс-рантаймного
// импорта нет: Vite/JS ↔ Deno/TS ↔ Postgres):
//   1. фронт   — src/lib/tripAddons.js            (PRO_ONLY_ADDONS)
//   2. edge     — supabase/functions/_shared/proAddons.ts (PRO_ONLY_ADDONS)
//   3. SQL      — public.is_pro_addon(text)        (миграция, тело = array[...])
// Один список, три рантайма, один гард: изменить множество = править ОДИН список,
// этот тест краснеет, пока все три не совпали (TRIP-416). Паттерн «источник +
// зеркало + гард», как errorCodes (2v) / db-types (2t).
const EXPECTED = ['budget', 'chat', 'telegram_assistant'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Отсортированный список литералов в кавычках из фрагмента (blindness-sensor: пусто = провал). */
function quotedList(snippet, label) {
  const list = [...snippet.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.ok(list.length > 0, `не удалось выделить список аддонов из ${label} — гард ослеп`);
  return list;
}

test('PRO_ONLY_ADDONS is exactly budget/chat/telegram_assistant (frontend)', () => {
  assert.deepEqual([...PRO_ONLY_ADDONS].sort(), EXPECTED);
});

test('edge-зеркало proAddons.ts совпадает с фронтом', () => {
  const src = readFileSync(join(ROOT, 'supabase/functions/_shared/proAddons.ts'), 'utf8');
  const m = src.match(/PRO_ONLY_ADDONS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'не найден литерал PRO_ONLY_ADDONS в proAddons.ts — гард ослеп');
  assert.deepEqual(quotedList(m[1], 'proAddons.ts'), EXPECTED);
});

test('SQL-зеркало is_pro_addon() совпадает с фронтом', () => {
  const migDir = join(ROOT, 'supabase/migrations');
  const src = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(migDir, f), 'utf8'))
    .find((s) => /function\s+public\.is_pro_addon/i.test(s));
  assert.ok(src, 'не найдена миграция с function public.is_pro_addon — гард ослеп');
  const m = src.match(/is_pro_addon[\s\S]*?array\s*\[([^\]]*)\]/i);
  assert.ok(m, 'не найдено тело array[...] у is_pro_addon — гард ослеп');
  assert.deepEqual(quotedList(m[1], 'is_pro_addon'), EXPECTED);
});


// ── Один нормализатор на два источника ───────────────────────────────────────
// Включённые аддоны решают состав меню трипа, а приезжают из ДВУХ мест: двери
// трипа (`trip.details.addons`) и карточки главной (`card.addons`). Если бы
// «включено» считалось по-разному, меню на первом кадре отличалось бы от меню на
// втором — то самое мигание, ради которого всё затевалось. Инвариант: оба пути
// дают побайтово один ответ.

test('★ карточка и трип дают одинаковый набор аддонов', () => {
  // В мешке НАРОЧНО есть truthy-не-true (1): если пути разойдутся хотя бы одной
  // трактовкой «включено», тест это увидит. С однотипным {true,false} он был бы
  // зелёным при двух разных реализациях — проверено мутацией.
  const raw = { budget: true, chat: false, hotels_selection: 1 };
  assert.deepEqual(normalizeAddons(raw), getAddons({ details: { addons: raw } }));
});

test('нормализатор белый: включено ТОЛЬКО при строгом true', () => {
  for (const truthy of [1, '1', 'true', 'on', {}, []]) {
    assert.equal(normalizeAddons({ [ADDON_KEYS.BUDGET]: truthy })[ADDON_KEYS.BUDGET], false,
      `${JSON.stringify(truthy)} не должно включать аддон`);
  }
  assert.equal(normalizeAddons({ [ADDON_KEYS.BUDGET]: true })[ADDON_KEYS.BUDGET], true);
});

test('пустой/отсутствующий мешок → все аддоны выключены, ключи на месте', () => {
  for (const empty of [undefined, null, {}]) {
    const bag = normalizeAddons(empty);
    for (const key of Object.values(ADDON_KEYS)) {
      assert.equal(bag[key], false, `${key} при ${String(empty)}`);
    }
  }
});
