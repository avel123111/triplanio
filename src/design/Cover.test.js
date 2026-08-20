/**
 * Дрейф-гард примитива <Cover>.
 *
 * Модель: обложек-градиентов больше нет. Дефолтная обложка = фоллбек-картинка из
 * бандла (`public/covers/fallback.webp`), которую несёт CSS-подложка `.cover` и на
 * которую ссылается JS-константа `COVER_FALLBACK` (для мест, что рендерят обложку
 * своим <img>: карточки трипов, StepReview, TripDot). Здесь пинятся ДВА инварианта:
 *   1. путь фоллбека в JS (`COVER_FALLBACK`) == путь в CSS-правиле `.cover` — две
 *      копии одного литерала (JS-слой и CSS-слой) расходятся молча;
 *   2. правил `.cover[data-cover="gradient_N"]` в app.css БОЛЬШЕ НЕТ — регресс
 *      вернул бы зоопарк из 16 правил и дубль набора данных.
 *
 * Файлы читаются ТЕКСТОМ (не import) — `node --test` не парсит JSX-модули ДС
 * (приём из Layout.test.js/fileType.test.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COVER_SRC = readFileSync(fileURLToPath(new URL('./Cover.jsx', import.meta.url)), 'utf8');
const CSS = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf8');

/** Литерал пути из `export const COVER_FALLBACK = '…';`. */
function fallbackFromJs() {
  const m = COVER_SRC.match(/COVER_FALLBACK\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

/** Тело базового правила `.cover { … }` из app.css (первое совпадение). */
function coverRuleBody() {
  const m = CSS.match(/\.cover\s*\{([^}]*)\}/);
  return m ? m[1] : '';
}

test('★ Cover: путь фоллбека в JS и в CSS-подложке .cover совпадает (нет дрейфа)', () => {
  const path = fallbackFromJs();
  assert.ok(path, 'COVER_FALLBACK не найден в Cover.jsx');
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    coverRuleBody(),
    new RegExp(`url\\(['"]?${escaped}['"]?\\)`),
    `.cover background не ссылается на ${path}`,
  );
});

test('★★ Cover: правил-градиентов .cover[data-cover] в app.css больше нет (выпил градиентов)', () => {
  const rules = CSS.match(/\.cover\[data-cover="gradient_\d+"\]\s*\{/g) || [];
  assert.equal(rules.length, 0, `ожидалось 0 правил .cover[data-cover], найдено ${rules.length}`);
});
