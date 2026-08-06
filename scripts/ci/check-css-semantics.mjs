#!/usr/bin/env node
/**
 * CI-гард 2p · ЯРУС 2 визуального гейта (TRIP-340 PR3, решение Р13).
 *
 * ЧТО ЭТО. Для каждого класса считается НАБОР ИТОГОВЫХ ОБЪЯВЛЕНИЙ — что реально
 * достаётся элементу после разрешения каскада, — на BASE_REF и на HEAD. Разница
 * печатается строкой `.btn--primary padding 10px → 8px` и блокирует PR.
 *
 * ЗАЧЕМ ИМЕННО ОН. Единственный ранее существовавший способ доказать «визуально
 * ничего не поменялось» — `cmp` собранного CSS (ярус 1, приём PR #691). Он
 * доказывает МНОГО (байты те же), но умеет только «да/нет»: как только PR
 * НАМЕРЕННО что-то меняет, ярус 1 краснеет и молчит о том, ЧТО изменилось.
 * Фазы 04–09 эпика TRIP-337 состоят из намеренных правок, поэтому им нужен
 * инструмент, который не запрещает изменение, а НАЗЫВАЕТ его. Цена ошибки
 * известна поимённо: прогон по значениям свёл 111 радиусов, `.checkbox` под
 * 11px получил 17px и стал круглым — радиокнопкой на экране входа. Такой ход
 * этот гард печатает одной строкой.
 *
 * ★ ПОЧЕМУ АГРЕГАЦИЯ ПО КЛАССУ, А НЕ ПО ПРАВИЛУ. Наивный дифф «селектор →
 * объявления» краснеет на ПЕРЕНОСЕ правила из файла в файл с тем же значением —
 * а перенос это ровно то, что делают фазы 04–09 (закон 6: правило переезжает в
 * общий класс). Ложное срабатывание тут дороже пропуска: гард, который красный
 * на каждом правильном ходе, выключают. Поэтому объявления собираются со ВСЕХ
 * файлов и разрешаются каскадом — перенос между файлами невидим, изменение
 * ЗНАЧЕНИЯ видно.
 *
 * ★ ПОЧЕМУ postcss, А НЕ СВОЙ РАЗБОР. `postcss@8` уже прямая зависимость репо
 * (рунг 5 лестницы ponytail). Свой разборщик CSS — это третий парсер в проекте
 * и ровно тот класс подозреваемого, что уже дважды бил по этому эпику: «21
 * сырой радиус» вместо 2 и «163 токена двумя путями, один сломан». Здесь цена
 * тихой ошибки максимальна: гард печатал бы «изменений нет».
 *
 * ЧТО ГАРД НЕ ДЕЛАЕТ. Он НЕ предсказывает рантайм: настоящего победителя
 * каскада показывает только рендер (см. §9 эпика — `.wdg-h h4` бьёт и
 * `index.css`, и `app.css`). Он сравнивает ДВА СВОИХ ЗАМЕРА, посчитанных
 * одинаково с обеих сторон. Этого достаточно, чтобы поймать изменение, и
 * недостаточно, чтобы утверждать «на экране будет 8px».
 *
 * Escape: `visual-diff-exempt: <причина>` в ДОБАВЛЕННЫХ строках диффа (как
 * `floor-exempt` у 2o) — действует ровно один PR.
 *
 * Env: BASE_REF (по умолчанию origin/dev).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const EXEMPT = 'visual-diff-exempt';

const die = (msg, extra = []) => {
  console.error(`::error::check-css-semantics: ${msg}`);
  extra.forEach((l) => console.error(`  ${l}`));
  process.exit(2);
};

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  die(`unknown flag ${unknown.join(' ')}.`, [
    'Обновлять нечего: потолок — базовая ветка. Разрешить одно изменение:',
    `  ${EXEMPT}: <причина>`,
  ]);
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/* --------------------------- порядок каскада ------------------------------
 * Зафиксирован в main.jsx тремя строками (TRIP-339 Р9): app.css первым, экраны,
 * index.css последним. Здесь он ПОВТОРЁН, а не выведен из графа модулей: гард
 * обязан считать одинаково на обеих сторонах, а граф на базе и на HEAD может
 * отличаться. Если пиннинг в main.jsx изменят — сравнение останется честным
 * (обе стороны меряются этим же порядком), изменится лишь то, чьё значение
 * названо победителем.                                                      */
const fileRank = (p) => (p === 'src/design/app.css' ? 0 : p === 'src/index.css' ? 999 : 500);
const orderOf = (p, i) => [fileRank(p), p, i];

/** Специфичность (a,b,c): id · класс/атрибут/псевдокласс · элемент/псевдоэлемент.
 *  Грубее спеки (`:not()` не разворачивается), но одинаково для обеих сторон. */
const specificity = (sel) => {
  const s = sel.replace(/\s*[>+~]\s*/g, ' ');
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const c = (s.match(/(^|[\s(])[a-zA-Z][\w-]*/g) || []).length;
  return a * 10000 + b * 100 + c;
};

/** Состояние — ЧАСТЬ КЛЮЧА, а не победитель. Без этого `.btn:hover` (спец. выше)
 *  вытеснял бы базовое значение `.btn` из карты, и правка базы становилась
 *  НЕВИДИМОЙ — известная ловушка «ховер бьёт модификатор». */
const stateOf = (sel) => (sel.match(/:{1,2}[\w-]+(\([^)]*\))?/g) || []).sort().join('');

const classesOf = (sel) => [...new Set((sel.match(/\.(-?[a-zA-Z_][\w-]*)/g) || []).map((c) => c.slice(1)))];

/** media-контекст = все родительские at-rule'ы. Правило внутри `@media` — другой
 *  контекст: иначе мобильное значение схлопнулось бы с десктопным. */
const mediaOf = (node) => {
  const out = [];
  for (let p = node.parent; p; p = p.parent) if (p.type === 'atrule') out.push(`@${p.name} ${p.params}`);
  return out.reverse().join(' ');
};

/** Карта: `класс|media|состояние|свойство` → победившее значение. */
function semantics(files) {
  const best = new Map();
  const failures = [];
  for (const { path, css } of files) {
    let root;
    try {
      root = postcss.parse(css, { from: path });
    } catch (e) {
      // Непрочитанный файл выглядит как файл без стилей, то есть «изменений
      // нет» — самый дорогой из возможных неверных ответов для этого гарда.
      failures.push(`${path}: ${e.message}`);
      continue;
    }
    let i = 0;
    root.walkRules((rule) => {
      i += 1;
      const media = mediaOf(rule);
      for (const sel of rule.selectors || []) {
        const spec = specificity(sel);
        const state = stateOf(sel);
        const cls = classesOf(sel);
        if (!cls.length) continue;
        rule.walkDecls((decl) => {
          const weight = [decl.important ? 1 : 0, spec, ...orderOf(path, i)];
          for (const c of cls) {
            const key = `${c}|${media}|${state}|${decl.prop}`;
            const prev = best.get(key);
            if (!prev || cmpWeight(weight, prev.weight) >= 0) {
              best.set(key, { weight, value: decl.value.replace(/\s+/g, ' ').trim() });
            }
          }
        });
      }
    });
  }
  return { best, failures };
}

const cmpWeight = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x === y) continue;
    return x > y ? 1 : -1;
  }
  return 0;
};

/* ------------------------------ два замера -------------------------------- */

const listCss = (ref) => {
  const out = ref
    ? git(['ls-tree', '-r', '--name-only', ref, '--', 'src']).split('\n')
    : git(['ls-files', '--', 'src']).split('\n');
  return out.filter((p) => p.endsWith('.css'));
};

let baseFiles;
try {
  baseFiles = listCss(BASE_REF).map((p) => ({ path: p, css: git(['show', `${BASE_REF}:${p}`]) }));
} catch (e) {
  // Недостижимая база — КРАСНЫЙ, не пропуск: «нечего проверять» и «проверено,
  // чисто» не должны печатать одинаковый вердикт (правило 2o).
  die(`не могу прочитать ${BASE_REF}: ${e.message}`, ['git fetch origin dev']);
}
/* ★ РАБОЧЕЕ ДЕРЕВО, А НЕ ИНДЕКС. Первая редакция читала HEAD через
 * `git show :<path>` — то есть staging area. В CI разницы нет (там всё
 * закоммичено), поэтому гард выглядел бы исправным; локально он
 * печатал «изменений нет» на ЛЮБОЙ незастейдженной правке. Поймано
 * мутацией (.checkbox gap 9px→17px прошёл насквозь), не чтением кода. */
const headFiles = listCss(null).map((p) => ({ path: p, css: readFileSync(p, 'utf8') }));

const base = semantics(baseFiles);
const head = semantics(headFiles);
const failures = [...base.failures, ...head.failures];
if (failures.length) die(`postcss не разобрал ${failures.length} файл(ов) — замер занижен`, failures);

/* ------------------------------- сравнение -------------------------------- */

const changes = [];
for (const [key, { value }] of head.best) {
  const was = base.best.get(key);
  if (!was) changes.push({ key, from: null, to: value });
  else if (was.value !== value) changes.push({ key, from: was.value, to: value });
}
for (const [key, { value }] of base.best) if (!head.best.has(key)) changes.push({ key, from: value, to: null });

const exempt = git(['diff', '--unified=0', `${BASE_REF}...HEAD`, '--', 'src'])
  .split('\n')
  .filter((l) => l.startsWith('+') && l.includes(EXEMPT)).length;

const fmt = ({ key, from, to }) => {
  const [cls, media, state, prop] = key.split('|');
  const where = [media, state].filter(Boolean).join(' ');
  const move = from === null ? `+ ${to}` : to === null ? `− ${from}` : `${from} → ${to}`;
  return `  .${cls}${state}${where && media ? ` {${media}}` : ''} ${prop}: ${move}`;
};

console.log(`check-css-semantics (2p): HEAD vs ${BASE_REF}`);
console.log(`  классов под наблюдением: ${new Set([...head.best.keys()].map((k) => k.split('|')[0])).size}`);
console.log(`  объявлений сравнено:     ${head.best.size}`);

if (!changes.length) {
  console.log('  итоговые объявления не изменились ни у одного класса.');
  process.exit(0);
}

console.log(`\n  изменений: ${changes.length}${exempt ? ` · маркеров ${EXEMPT}: ${exempt}` : ''}`);
changes.slice(0, 60).sort((a, b) => a.key.localeCompare(b.key)).forEach((c) => console.log(fmt(c)));
if (changes.length > 60) console.log(`  … и ещё ${changes.length - 60}`);

if (exempt) {
  console.log(`\n  ${exempt} маркер(ов) ${EXEMPT} в диффе — изменения объявлены намеренными.`);
  process.exit(0);
}
console.error(
  `::error::check-css-semantics: итоговые объявления изменились у ${changes.length} ключ(ей). ` +
    `Если это намеренно — добавь строку \`${EXEMPT}: <причина>\` в диффе.`,
);
process.exit(1);
