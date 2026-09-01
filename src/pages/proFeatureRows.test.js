import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Гард СУЩЕСТВОВАНИЯ ключей матрицы фич /pro (TRIP-503). Pro.jsx строит строки
// таблицы шаблоном `t(`sub.${k}`)` из массива FEATURE_ROWS — ключ приезжает в t()
// ПЕРЕМЕННОЙ, поэтому гард 2d (check-i18n, проверка D) его НЕ видит по построению
// (шапка гарда прямо это оговаривает). Без этого теста опечатка в любой из шести
// строк = сырой ключ на живой странице тарифов, и ничто не краснеет — ровно та
// дыра, что закрыта для ProUpsellModal в proUpsell.test.js.
//
// Идиома репозитория (как limits.test.js): исходник читается ТЕКСТОМ, массив
// достаётся регексом. Pro.jsx НЕ импортируем — он тянет lucide и роняет
// `node --test` (memory/triplanio-stats-dashboard-redesign). Правило «CI-гард —
// это код»: тест увиден красным мутацией ключа перед коммитом.
const HERE = dirname(fileURLToPath(import.meta.url));

function featureRowsFromSource() {
  const src = readFileSync(join(HERE, 'Pro.jsx'), 'utf8');
  const block = src.match(/FEATURE_ROWS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, 'FEATURE_ROWS не найден в Pro.jsx — гард ослеп');
  const keys = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 6, `ожидалось ≥6 ключей в FEATURE_ROWS, найдено ${keys.length}`);
  return keys;
}

const SUB = Object.fromEntries(['en', 'es', 'ru'].map((loc) => [
  loc,
  JSON.parse(readFileSync(join(HERE, '..', 'lib', 'i18n', 'locales', loc, 'sub.json'), 'utf8')),
]));

test('каждый ключ FEATURE_ROWS (/pro) резолвится во всех локалях', () => {
  for (const k of featureRowsFromSource()) {
    for (const [loc, dict] of Object.entries(SUB)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(dict, k),
        `ключ sub.${k} отсутствует в ${loc}/sub.json`,
      );
    }
  }
});
