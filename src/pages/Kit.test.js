#!/usr/bin/env node
/**
 * Витрина `/kit` не имеет права молча разойтись с системой (TRIP-337 / TRIP-344).
 *
 * ★ ЗАЧЕМ. `/kit` — единственное место, куда смотрят, чтобы увидеть, из чего
 * состоит дизайн-система. Компоненты она импортирует настоящие, но НАБОР того,
 * что показывать, раньше был написан руками (`BTN_VARIANTS` … в самой витрине).
 * Отсюда две поломки, обе молчаливые: завели `.btn--link`, в список не дописали →
 * витрина показывает девять кнопок из десяти и выглядит полной; или в списке
 * есть то, чего в CSS нет → витрина рисует несуществующее (`badge--on-arrival`
 * рисовался после схлопывания правила). Дисциплиной это не лечится — лечится
 * тем, что расхождение КРАСНЕЕТ.
 *
 * ── ДВА ВИДА ИСТОЧНИКА ОСИ (редизайн TRIP-344) ──────────────────────────────
 * Реестр объектов (`kit-objects.js`) — тот же, по которому рисует страница —
 * объявляет источник каждой оси:
 *   • `maps` — КАРТА ВАРИАНТОВ, экспортированная примитивом (`BTN_VARIANTS` …).
 *     Значения читаются из ТЕКСТА модуля примитива (`node --test` JSX не
 *     импортирует), «показано» = `prefix--value`. Плюс `extras` — НЕ-union
 *     классы (`btn--sm` размер, `icon-btn--round` форма, булевы `fpill`). У этих
 *     семей направление 1 КРАСНЕЕТ на неполной карте — полнота, которую тип не
 *     даёт (`.jsx` без `as const`; истинно единый источник — перевод ДС в `.ts`).
 *   • `css` — CSS-ПРОИЗВОДНЫЙ список семьи: «показано» = все объявленные
 *     `.family--*`. Направление 1 для них тавтологично; их держит РАНТАЙМ
 *     (страница рисует список циклом, полна по построению) и скриншот облика.
 *
 * ── ПЕРИМЕТР, И ПОЧЕМУ ОН ИМЕННО ТАКОЙ ──────────────────────────────────────
 * Судим МОДИФИКАТОРЫ КАНОН-СЕМЕЙ через `--`, без `__` (это ЭЛЕМЕНТЫ объекта,
 * `card__body`, а не его обличья) и без тех, что склеивает сам компонент из
 * `index.jsx` (`<Avatar kind="ai"/>` рисует `avatar--ai`, строки в разметке нет).
 * У `t` вокабуляр записан одинарным дефисом — под предикат не попадает, его
 * держит `check:design` (ярус TYPOGRAPHY).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { KIT_OBJECTS } from './kit-objects.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CATALOG = JSON.parse(read('../design/catalog.json'));
const CSS = read('../design/app.css');

/** ⚠️ Комментарии гасятся ДО поиска — иначе класс из комментария сходит за
 *  показанный/эмитируемый. ОДНА функция на оба входа (модули примитивов и
 *  `index.jsx`): две копии регулярки молча разошлись бы. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Та же нарезка, что у `familyOf` в `audit-design.mjs` и в витрине. */
const familyOf = (cls) => cls.replace(/(__|--).*/, '').split('-')[0];

const CANON = new Set(
  Object.entries(CATALOG.families).filter(([, st]) => st === 'canon').map(([f]) => f),
);

/** Все классы, объявленные в CSS системы (комментарии `walkRules` не видит). */
function declaredClasses() {
  const out = new Set();
  postcss.parse(CSS).walkRules((rule) => {
    for (const m of rule.selector.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) out.add(m[1]);
  });
  return out;
}
const DECLARED = declaredClasses();

/** Обличья, которые компонент `index.jsx` склеивает САМ (выведены из-под суда
 *  направления 1: определить, что ветка сработала, можно только рендером;
 *  вместо «считать показанными» — вывести из наблюдения, а существование правила
 *  под них держит направление 2б). Читается ТОЛЬКО `index.jsx`: примитивы своих
 *  модулей (`IconBtn`/`Chip`/…) держит связка «карта на витрине» + направление 2. */
function emittedByComponents() {
  const idx = stripComments(read('../design/index.jsx'));
  const KIT = stripComments(read('./Kit.jsx'));
  const out = new Set();
  const parts = idx.split(/export const ([A-Z][A-Za-z0-9]*) *=/).slice(1);
  for (let i = 0; i < parts.length; i += 2) {
    const [name, body] = [parts[i], parts[i + 1] ?? ''];
    if (!new RegExp(`<${name}[ >/\\n]`).test(KIT)) continue; // компонент не на витрине
    for (const m of body.matchAll(/\b([a-z][\w-]*--[\w-]+)\b/g)) {
      if (CANON.has(familyOf(m[1]))) out.add(m[1]);
    }
  }
  return out;
}
const EMITTED = emittedByComponents();

/** Обличья под наблюдением направления 1: `--`-модификаторы канон-семей, без
 *  элементов и без тех, что компонент склеивает сам. */
const VARIANTS = [...DECLARED]
  .filter((c) => c.includes('--') && !c.includes('__') && CANON.has(familyOf(c)) && !EMITTED.has(c))
  .sort();

/** Значения карт вариантов — из ТЕКСТА модулей примитивов (единый источник:
 *  тот же массив, что типизирует проп). Регекс, а не импорт, потому что
 *  `node --test` не парсит JSX модулей `@/design/*.jsx`. */
const DESIGN_SRC = ['index.jsx', 'IconBtn.jsx', 'Tile.jsx', 'Chip.jsx', 'Seg.jsx', 'Stepper.jsx', 'Swatch.jsx', 'Stat.jsx', 'ListRow.jsx']
  .map((f) => stripComments(read(`../design/${f}`))).join('\n');
function mapValues(name) {
  const m = DESIGN_SRC.match(new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`, 's'));
  assert.ok(m, `карты ${name} нет ни в одном модуле примитивов — реестр витрины ссылается на несуществующий источник`);
  return [...m[1].matchAll(/["']([^"']*)["']/g)].map((x) => x[1]).filter(Boolean);
}

/** Тело рецепта объекта из `Kit.jsx` — от заголовка `<id>: (` до следующего
 *  заголовка рецепта. Нужно направлению 1в: сверить, что рецепт РЕНДЕРИТ карту,
 *  а не только реестр её ОБЪЯВИЛ. */
const KIT_SRC = stripComments(read('./Kit.jsx'));
function recipeBody(id) {
  const start = KIT_SRC.match(new RegExp(`\\n {2}'?${id.replace(/-/g, '\\-')}'?: \\(`));
  if (!start) return '';
  const rest = KIT_SRC.slice(start.index + start[0].length);
  const next = rest.match(/\n {2}'?[a-z][\w-]*'?: \(/);
  return next ? rest.slice(0, next.index) : rest;
}

/** Ступени лестницы row/col/grid витрина сверяет с живым CSS сама; здесь
 *  достаточно знать, что она их перечисляет (замер в браузере, не список тут). */
function layoutSteps() {
  const shown = new Set();
  for (const base of ['row', 'col', 'grid']) for (let i = 1; i <= 8; i++) shown.add(`${base}--g${i}`);
  return shown;
}

/** ★★★ Всё «показано», собранное ПО РЕЕСТРУ (единый источник со страницей):
 *  карта → `prefix--value`, extras → `prefix--extra`, css → все объявленные
 *  `.family--*`. */
function shownOnKit() {
  const shown = layoutSteps();
  for (const o of KIT_OBJECTS) {
    if (!o.family) continue;
    const prefix = o.prefix ?? o.family;
    for (const name of o.maps ?? []) for (const v of mapValues(name)) shown.add(`${prefix}--${v}`);
    for (const e of o.extras ?? []) shown.add(`${prefix}--${e}`);
    if (o.css) for (const c of DECLARED) if (c.includes('--') && !c.includes('__') && familyOf(c) === o.family) shown.add(c);
  }
  return shown;
}

/** ★ ХРАПОВИК ДОЛГА, а не запрет. Сегодня долг ПРИМИТИВА = 0. Остаются только
 *  `seg--filter`/`seg--view` — ЭКРАННЫЕ адаптивы Trips (order/flex в
 *  `.trips-toolbar`), не обличья самого `Seg`: показывать на витрине примитива
 *  нечем. Форма та же, что у остальных обходов: список называет ровно то, что
 *  гасит. */
// tt--block — режим ОБЁРТКИ тултипа (full-width блочный триггер), а не обличье
// самого пузыря: показывать на витрине нечем (TRIP-274 Ф2.2).
const NOT_SHOWN = new Set(['seg--filter', 'seg--view', 'tt--block']);

// ── Сверка ──────────────────────────────────────────────────────────────────

test('★ периметр не пуст: разбор CSS, каталога и реестра состоялся', () => {
  assert.ok(CANON.size >= 30, `канон-семей ${CANON.size} — каталог разобран неверно`);
  assert.ok(VARIANTS.length >= 80, `обличий ${VARIANTS.length} — CSS разобран неверно`);
  assert.ok(KIT_OBJECTS.length >= 25, `объектов в реестре ${KIT_OBJECTS.length} — реестр разобран неверно`);
});

test('★ карты примитивов не пусты и разбираются из текста модулей', () => {
  const named = [...new Set(KIT_OBJECTS.flatMap((o) => o.maps ?? []))];
  assert.ok(named.length >= 6, `карт в реестре ${named.length} — семья кнопки должна экспортировать 6+`);
  for (const name of named) assert.ok(mapValues(name).length >= 1, `карта ${name} пуста`);
});

test('★ ДАТЧИК: гашение комментариев в index.jsx несущее, а не декоративное', () => {
  // Мутация «снять гашение» краснеет, только пока в комментариях `index.jsx`
  // упомянут класс, которого нет в CSS (сегодня — мёртвый скин `.field--error`).
  const KIT = stripComments(read('./Kit.jsx'));
  const rawParts = read('../design/index.jsx').split(/export const ([A-Z][A-Za-z0-9]*) *=/).slice(1);
  const raw = new Set();
  for (let i = 0; i < rawParts.length; i += 2) {
    const [name, body] = [rawParts[i], rawParts[i + 1] ?? ''];
    if (!new RegExp(`<${name}[ >/\\n]`).test(KIT)) continue;
    for (const m of body.matchAll(/\b([a-z][\w-]*--[\w-]+)\b/g)) if (CANON.has(familyOf(m[1]))) raw.add(m[1]);
  }
  assert.ok(
    raw.size > EMITTED.size,
    `набор без гашения (${raw.size}) не шире рабочего (${EMITTED.size}) — в комментариях index.jsx ` +
      `больше нет имён классов, и мутация «снять гашение» перестала краснеть. Пин инертен.`,
  );
});

test('★ НАПРАВЛЕНИЕ 1: обличье из CSS либо показано, либо объявлено в долге', () => {
  const shown = shownOnKit();
  const unaccounted = VARIANTS.filter((c) => !shown.has(c) && !NOT_SHOWN.has(c));
  assert.deepEqual(
    unaccounted,
    [],
    `эти обличья есть в системе, но их нет ни на витрине (реестр не покрывает семью?), ни в долге — ` +
      `зарегистрируй объект/ось или впиши в NOT_SHOWN с причиной:\n  ${unaccounted.join(' · ')}`,
  );
});

test('★★★ НАПРАВЛЕНИЕ 1в: карту из реестра рецепт ЛИБО итерирует, ЛИБО кроет каждое значение', () => {
  // `shownOnKit()` берёт «показано» из ОБЪЯВЛЕНИЯ `maps`, не из рендера. Дыра:
  // добавь значение в CHIP_VARIANTS + правило в CSS — направления 1 и 2 зелёные,
  // а рукописный рецепт `chip`/`swatch` его не рисует (реестр врёт «полон по
  // построению»). Тут — сам рендер: рецепт объекта ЛИБО итерирует карту
  // (`КАРТА.map/.filter`, полнота по построению, как `btn`/`seg`/`stepper`), ЛИБО
  // содержит `="значение"` на КАЖДОЕ значение карты (рукописный набор проверен).
  const missing = [];
  for (const o of KIT_OBJECTS) {
    if (!o.maps?.length) continue;
    const body = recipeBody(o.id);
    assert.ok(body, `рецепта объекта «${o.id}» нет в Kit.jsx, а реестр объявил ему карту`);
    for (const name of o.maps) {
      if (new RegExp(`\\b${name}\\s*\\.\\s*(map|filter|forEach)`).test(body)) continue; // итерирует карту
      for (const v of mapValues(name)) if (!body.includes(`="${v}"`)) missing.push(`${o.id}: ${name} → "${v}"`);
    }
  }
  assert.deepEqual(missing, [], `реестр объявляет карту, но рецепт объекта её не рендерит ` +
    `(ни итерацией \`КАРТА.map\`, ни \`="значение"\` на каждое значение):\n  ${missing.join('\n  ')}`);
});

test('★★ НАПРАВЛЕНИЕ 2: витрина не показывает того, чего в CSS нет (карты + extras)', () => {
  // Случай `badge--on-arrival`: правило схлопнули, список остался, страница
  // рисовала пустышку. Проверяем ИСТОЧНИКИ-СПИСКИ (карты/extras); css-источник
  // тавтологичен (значения берутся ИЗ объявленных классов).
  const lying = [];
  for (const o of KIT_OBJECTS) {
    if (!o.family) continue;
    const prefix = o.prefix ?? o.family;
    for (const name of o.maps ?? []) for (const v of mapValues(name)) if (!DECLARED.has(`${prefix}--${v}`)) lying.push(`${prefix}--${v}`);
    for (const e of o.extras ?? []) if (!DECLARED.has(`${prefix}--${e}`)) lying.push(`${prefix}--${e}`);
  }
  assert.deepEqual(lying, [], `витрина заявляет классы, которых нет в CSS:\n  ${lying.join(' · ')}`);
});

test('★★ НАПРАВЛЕНИЕ 2б: обличье, которое эмитит компонент, обязано существовать в CSS', () => {
  // Восстанавливает покрытие, снятое выводом `EMITTED` из-под суда: удаление
  // правила из app.css при живом `<Avatar kind="ai"/>` не покраснело бы иначе.
  const dead = [...EMITTED].filter((c) => !DECLARED.has(c)).sort();
  assert.deepEqual(dead, [], `компонент ДС рисует эти классы, а правил под них в CSS нет:\n  ${dead.join(' · ')}`);
});

test('★★★ ХРАПОВИК: долг может только сокращаться', () => {
  const shown = shownOnKit();
  // Три причины протухания записи долга: класс показан, удалён из CSS, или вышел
  // из-под наблюдения (его эмитит сам компонент).
  const stale = [...NOT_SHOWN].filter((c) => !DECLARED.has(c) || shown.has(c) || EMITTED.has(c));
  assert.deepEqual(
    stale,
    [],
    `эти записи долга больше не нужны — класс показан, удалён из CSS или вышел из-под наблюдения; ` +
      `убери их из NOT_SHOWN:\n  ${stale.join(' · ')}`,
  );
});

test('★ ЦЕЛОСТНОСТЬ РЕЕСТРА: у каждого объекта с вариантами назван источник', () => {
  // Объект без источника (ни maps, ни css) при живых вариантах семьи в CSS —
  // молчаливая дыра: страница для него ничего не сгенерирует. Ловим явно.
  const orphan = KIT_OBJECTS.filter((o) => !o.special && !o.maps?.length && !o.css && o.family &&
    VARIANTS.some((c) => familyOf(c) === o.family));
  assert.deepEqual(orphan.map((o) => o.id), [], `у этих объектов есть варианты в CSS, но реестр не назвал источник: ${orphan.map((o) => o.id).join(' · ')}`);
});
