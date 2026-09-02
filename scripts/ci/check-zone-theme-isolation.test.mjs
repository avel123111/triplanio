/**
 * Инвариант: слой токенов неавторизованной зоны ВЫИГРЫВАЕТ у тёмной темы
 * приложения по каскаду (TRIP-445).
 *
 * ЗАЧЕМ ЭТОТ ТЕСТ СУЩЕСТВУЕТ. `public/site.css` и `src/design/app.css` живут на
 * одной странице: app.css в бандле, site.css — <link> после него. Порядок тут
 * ничего не решает, решает СПЕЦИФИЧНОСТЬ: `:root[data-theme="dark"]` = (0,2,0)
 * бьёт `html.site` = (0,1,1) независимо от того, кто подключён позже. Пересечение
 * имён — `--brand`, `--ink`, `--muted`, то есть весь текст и весь акцент зоны,
 * а фон остаётся сайтовым (`--white` тёмной темой не переопределён). Итог,
 * который за это платили: заголовки БЕЛЫЕ НА БЕЛОМ.
 *
 * Воспроизведение было такое: ОС тёмная → /terms → Print → закрыть диалог.
 * Chrome на печати переоценивает prefers-color-scheme в light и обратно — это
 * два события change у matchMedia, и `ThemeProvider` при `tp-theme === 'system'`
 * (дефолт у всех незалогиненных) на каждое переписывает [data-theme], вторым
 * возвращая dark. Любое переключение темы ОС, включая автоматическое по закату,
 * даёт то же самое.
 *
 * ПОЧЕМУ ТЕСТ, А НЕ ГАРД. Гард сторожит диффы; здесь же сторожить надо СВОЙСТВО
 * КАСКАДА, которое ломается тихой правкой ОДНОГО селектора и не видно ни 2p
 * (значения не менялись), ни 2ae (обе стороны объявляют токены, а не классы),
 * ни глазами в светлой ОС. Предикат дешёвый и детерминированный — значит тест.
 *
 * ⚠️ МУТАЦИИ, КОТОРЫМИ ТЕСТ ПРОВЕРЕН КРАСНЫМ (иначе зелёный ничего не значит —
 * [[triplanio-ci-guard-is-code]]): снять защитный блок `html.site[data-theme]`
 * — падает «зона проигрывает тёмной теме по --brand, --ink, --muted»; снести
 * `--ink` из зонного блока — падает на проверке достижимости базы; развести
 * значение `--ink` между базовым и защитным блоками — падает третья проверка
 * (именно она и молчала, пока файл читался без `unscope()`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unscope } from './zone-scope.mjs';

const SITE = 'public/site.css';
const APP = 'src/design/app.css';

/** Комментарии гасим пробелами — номера строк и смещения не должны съезжать. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/**
 * Специфичность одного составного селектора как пара (b, c): b — классы,
 * атрибуты и псевдоклассы, c — теги и псевдоэлементы. Идентификаторов (a) в
 * обоих слоях токенов нет, но считаем и их, чтобы сравнение было честным, если
 * появятся.
 */
function specificity(sel) {
  const s = sel.trim();
  const a = (s.match(/#[-\w]+/g) || []).length;
  const b = (s.match(/\.[-\w]+/g) || []).length
    + (s.match(/\[[^\]]+\]/g) || []).length
    + (s.match(/:(?!:)[-\w]+/g) || []).length;
  const c = (s.match(/(^|[\s>+~])[a-zA-Z][-\w]*/g) || []).length;
  return [a, b, c];
}

const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
const fmt = (s) => `(${s.join(',')})`;

/** Правила верхнего уровня: `селектор { объявления }`, вложенные @-блоки не нужны. */
function* rules(css) {
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    yield { selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean), body: m[2] };
  }
}

/** Кастомные свойства, объявленные в теле правила. */
const customProps = (body) => new Set([...body.matchAll(/(^|;|\s)(--[-\w]+)\s*:/g)].map((m) => m[2]));

/** Максимальная специфичность среди селекторов правила + сами имена токенов. */
function layer(css, matches) {
  const out = new Map(); // токен -> лучшая специфичность объявившего его селектора
  let best = null;
  for (const r of rules(css)) {
    const own = r.selectors.filter(matches);
    if (!own.length) continue;
    const props = customProps(r.body);
    if (!props.size) continue;
    const top = own.map(specificity).sort(cmp).at(-1);
    if (!best || cmp(top, best) > 0) best = top;
    for (const p of props) {
      const prev = out.get(p);
      if (!prev || cmp(top, prev) > 0) out.set(p, top);
    }
  }
  return { tokens: out, best };
}

/** Значение токена в правилах, чей селектор подходит под предикат. */
function values(css, matches) {
  const out = new Map();
  for (const r of rules(css)) {
    if (!r.selectors.some(matches)) continue;
    for (const m of r.body.matchAll(/(^|;|\s)(--[-\w]+)\s*:([^;}]*)/g)) out.set(m[2], m[3].trim());
  }
  return out;
}

/* ★ site.css ЧИТАЕТСЯ ЧЕРЕЗ `unscope()`, КАК ЕГО ЧИТАЮТ 2p И 2ae.
   Этот тест разбирает СЕЛЕКТОРЫ, а расщепление слоёв (TRIP-505) переписало их
   форму: блок токенов стал `:is(html.site,.site)`. Наивный разбор рвал его по
   запятой на `:is(html.site` и `.site)`, правил с селектором ровно `html.site`
   не оставалось ни одного — и `base` третьей проверки становилась ПУСТОЙ, то
   есть сверка защитного блока переставала краснеть при любой мутации значений,
   оставаясь зелёной. Ровно тот отказ, о котором предупреждает докблок
   `zone-scope.mjs`: «второй гард отстанет от первого молча». */
const site = unscope(readFileSync(SITE, 'utf8'));
const app = readFileSync(APP, 'utf8');

// Слой зоны: селектор навешен на корневой элемент И несёт класс `site`.
const zone = layer(site, (s) => /^(html|:root)?\.site\b|^html\.site\b/.test(s.replace(/\s+/g, '')));
// Слой темы приложения: `:root[data-theme=…]` БЕЗ потомков (пины вида
// `:root[data-theme="dark"] .consent` — это правила на самом элементе, они
// наследование зоны не трогают и в сравнение не входят).
const theme = layer(app, (s) => /^:root\[data-theme[^\]]*\]$/.test(s.trim()));

test('★ БАЗА ДОСТИЖИМА: оба слоя найдены и несут токены (пустое множество = красный, не пропуск)', () => {
  assert.ok(zone.tokens.size > 0, `в ${SITE} не найден слой токенов зоны — проверь селектор html.site`);
  assert.ok(theme.tokens.size > 0, `в ${APP} не найден слой тёмной темы — проверь селектор :root[data-theme=…]`);
  assert.ok(zone.tokens.has('--ink'), 'зона обязана объявлять --ink: без него сравнивать нечего и тест зеленел бы впустую');
});

test('★★★ зона выигрывает у тёмной темы приложения по КАЖДОМУ общему токену', () => {
  const shared = [...zone.tokens.keys()].filter((t) => theme.tokens.has(t)).sort();
  assert.ok(shared.length > 0, 'общих токенов нет — предикат перестал что-либо проверять, проверь оба слоя');

  const losing = shared.filter((t) => cmp(zone.tokens.get(t), theme.tokens.get(t)) <= 0);
  assert.deepEqual(
    losing,
    [],
    `зона ПРОИГРЫВАЕТ тёмной теме приложения по ${losing.length} токен(ам): ${losing.join(', ')}.\n`
    + `  специфичность зоны ${fmt(zone.best ?? [0, 0, 0])} ≤ темы ${fmt(theme.best ?? [0, 0, 0])}.\n`
    + '  Это «белые заголовки на белом фоне» на неавторизованных страницах: --ink уезжает\n'
    + '  в тёмное значение приложения, а фон остаётся сайтовым. Лечение — селектор слоя\n'
    + `  зоны в ${SITE} должен быть строго специфичнее, чем :root[data-theme="dark"].`,
  );
});

test('★★ ЗАЩИТНЫЙ БЛОК НЕ РАЗЪЕХАЛСЯ: значения трёх токенов совпадают с базовым слоем зоны', () => {
  // Защита от тёмной темы — отдельное правило `html.site[data-theme]`, то есть
  // ДУБЛЬ литералов. Дубль допустим только под гардом: правишь --ink в базовом
  // блоке, забываешь в защитном — и тема снова выигрывает, молча и точечно.
  const base = values(site, (s) => /^html\.site$/.test(s.trim()));
  const guard = values(site, (s) => /^html\.site\[data-theme\]$/.test(s.trim()));

  // Недостижимая база = КРАСНЫЙ, а не пропуск: пустая `base` отфильтровывает
  // сравнение в пустоту и делает проверку вечно зелёной.
  assert.ok(base.size > 0, 'базового блока html.site нет — сравнивать защитный блок не с чем');
  assert.ok(guard.size > 0, 'защитного блока html.site[data-theme] нет — изоляция зоны держится ни на чём');

  const drifted = [...guard.entries()]
    .filter(([k, v]) => base.has(k) && base.get(k) !== v)
    .map(([k, v]) => `${k}: базовый ${base.get(k)} ≠ защитный ${v}`);
  assert.deepEqual(drifted, [], `дубль значений разъехался:\n  ${drifted.join('\n  ')}`);

  // И обратная сторона: защитный блок обязан покрывать ВСЁ пересечение с темой.
  const shared = [...zone.tokens.keys()].filter((t) => theme.tokens.has(t));
  const uncovered = shared.filter((t) => !guard.has(t));
  assert.deepEqual(
    uncovered,
    [],
    `тема приложения объявляет ${uncovered.join(', ')} — допиши их в защитный блок html.site[data-theme]`,
  );
});

test('тёмная тема приложения НЕ объявляет --white: фон зоны остаётся сайтовым (это половина дефекта)', () => {
  // Если тема когда-нибудь переопределит и фон, симптом сменится с «белое по
  // белому» на «зона внезапно тёмная» — тоже неверно, но выглядит иначе, и
  // разбирать это надо зная, что предпосылка изменилась.
  assert.ok(!theme.tokens.has('--white'), 'тёмная тема стала объявлять --white — пересмотри изоляцию зоны целиком');
});
