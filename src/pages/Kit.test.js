#!/usr/bin/env node
/**
 * Витрина `/kit` не имеет права молча разойтись с системой (TRIP-337).
 *
 * ★ ЗАЧЕМ. `/kit` — единственное место, куда смотрят, чтобы увидеть, из чего
 * состоит дизайн-система. Компоненты она импортирует настоящие, но СПИСОК того,
 * что показывать, написан руками (`BTN_VARIANTS`, `BADGE_VARIANTS`, …). Отсюда
 * две поломки, и обе молчаливые:
 *
 *   • завели `.btn--link` в CSS, в массив не дописали → витрина показывает
 *     девять кнопок из десяти и выглядит полной;
 *   • в массиве есть то, чего в CSS нет → витрина рисует несуществующее. Это
 *     уже случилось: вариант `badge--on-arrival` рисовался после того, как его
 *     правило схлопнули, — то есть страница посылала следующего применять
 *     пустышку.
 *
 * Дисциплиной «не забывать обновлять» это не лечится: именно она и не
 * сработала. Лечится тем, что расхождение КРАСНЕЕТ.
 *
 * ── ПЕРИМЕТР, И ПОЧЕМУ ОН ИМЕННО ТАКОЙ (замер, а не вкус) ──
 * Судим только МОДИФИКАТОРЫ КАНОН-СЕМЕЙ, записанные через `--`. Обе половины
 * этого предложения — результат прогона, и наивная альтернатива у каждой
 * неверна:
 *
 *   • КАНОН-СЕМЬИ (34 из `catalog.json`) — это то, что система объявляет своим
 *     языком. Семьи «на разборе» показывать на витрине незачем: их судьба —
 *     исчезнуть.
 *   • ТОЛЬКО `--`. У канон-семей 103 модификатора через `--`, но ещё 79 классов
 *     с ОДИНАРНЫМ дефисом, и это НЕ варианты, а отдельные объекты под общим
 *     префиксом: `input-group`, `sheet-row`, `empty-state`, `ai-blk`. Требовать
 *     их отдельными образцами — значит требовать несуществующей работы. Плюс 22
 *     класса с `__` — это ЭЛЕМЕНТЫ объекта (`card__body`), а не его обличья.
 *
 * ⚠️ ГРАНИЦА, НАЗВАННАЯ ВСЛУХ: у `t` вокабуляр записан одинарным дефисом
 * (`t-body`, `t-display`), поэтому под этот предикат он НЕ попадает. Его держит
 * гард `check:design` (ярус TYPOGRAPHY), а не витрина.
 *
 * ── ПОЧЕМУ «ЛИТЕРАЛ В ФАЙЛЕ» — НЕВЕРНЫЙ ВОПРОС ──
 * Первая редакция этой сверки спрашивала «встречается ли имя класса в
 * `Kit.jsx`». Ответ: 84 из 103 не встречаются — при том что кнопки и бейджи на
 * витрине ВИДНЫ. Причина в том, что имя собирается в рантайме (`btn--${v}` из
 * массива), литерала нет. Это ровно та слепота, которая записана у сверки C
 * гарда 2q. Поэтому видимым считается литерал ИЛИ имя, ДОСТРАИВАЕМОЕ из
 * массива, а таблица «массив → семья» объявлена ниже — тем же приёмом, что
 * `CONTRACT` в `Layout.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CATALOG = JSON.parse(read('../design/catalog.json'));
const CSS = read('../design/app.css');
const KIT_RAW = read('./Kit.jsx');

/** ⚠️ Комментарии гасятся ДО поиска литералов — иначе класс, упомянутый в
 *  комментарии (а в шапке `Kit.jsx` разобран как раз снятый `badge--on-arrival`),
 *  сходит за показанный. Тот же промах, что `--sp-9` из комментария на полу 2o.
 *  Гашение может только УБРАТЬ совпадения, то есть ошибается в красную сторону —
 *  безопасную для этой сверки. */
const KIT = KIT_RAW.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Та же нарезка, что у `familyOf` в `audit-design.mjs` и в самой витрине. */
const familyOf = (cls) => cls.replace(/(__|--).*/, '').split('-')[0];

const CANON = new Set(
  Object.entries(CATALOG.families).filter(([, st]) => st === 'canon').map(([f]) => f),
);

/** Все классы, объявленные в CSS системы. `walkRules` не заходит в комментарии,
 *  поэтому закомментированное правило классом не считается. */
function declaredClasses() {
  const out = new Set();
  postcss.parse(CSS).walkRules((rule) => {
    for (const m of rule.selector.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) out.add(m[1]);
  });
  return out;
}

/** Обличья под наблюдением: `--`-модификаторы канон-семей, без элементов. */
const VARIANTS = [...declaredClasses()]
  .filter((c) => c.includes('--') && !c.includes('__') && CANON.has(familyOf(c)))
  .sort();

/** Массив → семья, чьи обличья он достраивает. Разбор ОБЯЗАН падать громко:
 *  переименовали массив — тест красный, а не «расхождений нет». */
const ARRAYS = [
  { name: 'BTN_VARIANTS', family: 'btn' },
  { name: 'BADGE_VARIANTS', family: 'badge' },
  { name: 'SEV_LEVELS', family: 'sev' },
  { name: 'AVATAR_SIZES', family: 'avatar' },
];

function valuesOf(name) {
  const m = KIT.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`, 's'));
  assert.ok(m, `в Kit.jsx нет массива ${name} — сверке не с чем работать, и молча пройти она не имеет права`);
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).filter(Boolean);
}

/** Ступени лестницы витрина сверяет с живым CSS сама (`declaredSteps`), поэтому
 *  здесь достаточно знать, что она их перечисляет. */
const LAYOUT_STEPS = () => {
  const shown = new Set();
  if (!/const LAYOUT\s*=/.test(KIT)) return shown;
  for (const base of ['row', 'col', 'grid']) for (let i = 1; i <= 8; i++) shown.add(`${base}--g${i}`);
  return shown;
};

function shownOnKit() {
  const shown = new Set(LAYOUT_STEPS());
  for (const { name, family } of ARRAYS) for (const v of valuesOf(name)) shown.add(`${family}--${v}`);
  for (const c of VARIANTS) if (KIT.includes(c)) shown.add(c);
  return shown;
}

/** ★ ХРАПОВИК, А НЕ ЗАПРЕТ. Витрина сегодня показывает примерно половину
 *  вокабуляра — 51 обличье не видно никак. Требовать закрыть их одним PR значит
 *  требовать переписать страницу; требовать НИЧЕГО значит оставить дыру. Поэтому
 *  долг объявлен списком и может только СОКРАЩАТЬСЯ: новое обличье в эту клетку
 *  не помещается, а показанное обязано из неё уйти.
 *
 *  Форма та же, что у остальных обходов репозитория: список называет ровно то,
 *  что гасит, а не «выключить проверку». */
const NOT_SHOWN = new Set([
  // раскладка: выравнивание и поток — показаны только ступени зазора
  'row--a-baseline', 'row--a-start', 'row--div', 'row--flush', 'row--inline', 'row--j-between',
  'col--a-end', 'col--a-start', 'col--j-center', 'grow--fit',
  // плитка-иконка: четырнадцать обличий, ни одного образца
  'tile--2xl', 'tile--ai', 'tile--danger', 'tile--info', 'tile--lg', 'tile--quiet',
  'tile--round', 'tile--sm', 'tile--solid', 'tile--success', 'tile--warm', 'tile--warning',
  'tile--xl',
  // спиннер и тост: живут внутри других компонентов, отдельного образца нет
  'spin--ink', 'spin--lg', 'spin--onscrim', 'spin--ring', 'spin--xl',
  'toast--error', 'toast--info', 'toast--success', 'toast--warning',
  // поверхности и диалог
  'card--danger', 'card--flush', 'dlg--sm', 'dlg--wide',
  // прочее, поштучно
  'ai-blk--pill', 'avatar--ai', 'avatar--deleted', 'avatar--placeholder', 'avatar-stack--white',
  'btn--brand', 'doc-row--ai', 'empty-state--boxed', 'field-row--aside',
  'input-affix--end', 'input-affix--ic', 'input-unit--lead', 'sev--dashed',
  'sheet-row--danger', 'time--tr',
]);

// ── Сверка ──────────────────────────────────────────────────────────────────

test('★ периметр не пуст: разбор CSS и каталога состоялся', () => {
  // Защита от «зелёного теста над пустой комнатой»: сломанный разбор дал бы ноль
  // обличий и ноль расхождений, то есть тест зеленел бы, ничего не проверив.
  assert.ok(CANON.size >= 30, `канон-семей ${CANON.size} — каталог разобран неверно`);
  assert.ok(VARIANTS.length >= 80, `обличий ${VARIANTS.length} — CSS разобран неверно`);
});

test('★ НАПРАВЛЕНИЕ 1: обличье из CSS либо показано, либо объявлено в долге', () => {
  const shown = shownOnKit();
  const unaccounted = VARIANTS.filter((c) => !shown.has(c) && !NOT_SHOWN.has(c));
  assert.deepEqual(
    unaccounted,
    [],
    `эти обличья есть в системе, но их нет ни на витрине, ни в списке долга — ` +
      `покажи их или впиши в NOT_SHOWN с причиной:\n  ${unaccounted.join(' · ')}`,
  );
});

test('★★ НАПРАВЛЕНИЕ 2: витрина не показывает того, чего в CSS нет', () => {
  // Это случай `badge--on-arrival`: правило схлопнули, массив остался, страница
  // рисовала пустышку. Направление, в котором витрина ВРЁТ, а не молчит.
  const declared = declaredClasses();
  const lying = [];
  for (const { name, family } of ARRAYS) {
    for (const v of valuesOf(name)) if (!declared.has(`${family}--${v}`)) lying.push(`${family}--${v}`);
  }
  assert.deepEqual(lying, [], `витрина рисует классы, которых нет в CSS:\n  ${lying.join(' · ')}`);
});

test('★★★ ХРАПОВИК: долг может только сокращаться', () => {
  const shown = shownOnKit();
  const declared = declaredClasses();
  const stale = [...NOT_SHOWN].filter((c) => !declared.has(c) || shown.has(c));
  assert.deepEqual(
    stale,
    [],
    `эти записи долга больше не нужны — класс показан на витрине или удалён из CSS; ` +
      `убери их из NOT_SHOWN, иначе список перестанет быть правдой:\n  ${stale.join(' · ')}`,
  );
});
