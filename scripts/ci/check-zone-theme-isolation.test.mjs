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
 * ⚠️ МУТАЦИЯ, КОТОРОЙ ТЕСТ ПРОВЕРЕН КРАСНЫМ (иначе зелёный ничего не значит —
 * [[triplanio-ci-guard-is-code]]): вернуть селектор к голому `html.site` —
 * падает «зона проигрывает тёмной теме по --brand, --ink, --muted». Снести
 * `--ink` из зонного блока — падает на проверке достижимости базы.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const site = readFileSync(SITE, 'utf8');
const app = readFileSync(APP, 'utf8');

// Слой зоны: селектор навешен на КОРНЕВОЙ ЭЛЕМЕНТ и несёт класс `site`.
// ★ Комбинатора в нём быть не должно. Прежний предикат сначала выбрасывал ВСЕ
// пробелы, поэтому `html.site[data-theme] .consent` (правило на ПОТОМКЕ —
// защита чужого элемента, см. вторую половину файла) склеивалось в
// `html.site[data-theme].consent` и попадало в слой токенов зоны. Его токены
// тогда требовались и в защитном блоке `html.site[data-theme]`, где им делать
// нечего: они принадлежат баннеру, а не зоне.
const zone = layer(site, (s) => /^(html|:root)?\.site\b[^\s>+~]*$/.test(s.trim()));
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

/* ═══════════════════════════════════════════════════════════════════════════
   ВТОРАЯ ПОЛОВИНА ИЗОЛЯЦИИ: ЧУЖОЙ ЭЛЕМЕНТ НА СТРАНИЦЕ ЗОНЫ.

   Блок выше сторожит ТОКЕНЫ ЗОНЫ — они на `html.site` и от тёмной темы
   защищены. Но на странице зоны стоит и чужой элемент: баннер cookie
   (`ConsentBanner.jsx`) смонтирован ВНЕ роутера, чтобы показываться и на
   анонимных входах. Он читает токены ПРИЛОЖЕНИЯ, а те на `:root` — то есть на
   том же `<html>`, где стоит `.site`. Защита зоны его не покрывает по
   построению.

   Что за это заплатили: при тёмной ОС (тема по умолчанию `system`) баннер
   вставал `rgb(31,33,47)` на белом листе лендинга. Человек видел тёмное пятно
   на светлой странице, куда ещё даже не логинился. Комментарий в app.css
   утверждал «сайт-зона всегда светлая — сюда не попадает»: неверно, `.site` и
   `[data-theme]` — один и тот же элемент.

   Гард 2p этого не увидит: у правила подлежащее `.consent`, ключ единицы тот же,
   а `[data-theme]` сидит на ПРЕДКЕ — значения «не менялись». Поэтому тест.

   ⚠️ МУТАЦИИ, КОТОРЫМИ ТЕСТЫ ПРОВЕРЕНЫ КРАСНЫМИ: снести правило зоны целиком —
   падает первый; убрать из него `--surface` — падает второй; сменить в нём
   `--ink` на любое другое значение — падает третий.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Объединение кастомных свойств по всем правилам, чей селектор подходит. */
function propsOf(css, matches) {
  const out = new Map();
  for (const r of rules(css)) {
    if (!r.selectors.some(matches)) continue;
    for (const m of r.body.matchAll(/(^|;|\s)(--[-\w]+)\s*:([^;}]*)/g)) out.set(m[2], m[3].trim());
  }
  return out;
}

/** Тёмный близнец баннера в app.css: `:root[data-theme="dark"] .consent`. */
const twinSel = (s) => /\[data-theme="dark"\]/.test(s) && /\.consent\b/.test(s);
/** Защита зоны в site.css: правило на `.consent` под `html.site[data-theme]`. */
const shieldSel = (s) => /^html\.site\[data-theme\]\s+\.consent$/.test(s.trim().replace(/\s+/g, ' '));

const twin = propsOf(app, twinSel);
const shield = propsOf(site, shieldSel);

test('★★★ зона ЗАЩИЩАЕТ баннер и выигрывает у тёмного близнеца по специфичности', () => {
  const twinSels = [...rules(app)].flatMap((r) => r.selectors).filter(twinSel);
  assert.ok(twinSels.length > 0, 'тёмного правила для .consent не найдено — предикат перестал что-либо проверять');
  assert.ok(shield.size > 0,
    `в ${SITE} нет правила html.site[data-theme] .consent — баннер на страницах зоны\n`
    + '  берёт тёмную палитру приложения и встаёт тёмным пятном на белом листе.');

  const shieldSpec = specificity('html.site[data-theme] .consent');
  const losing = twinSels.filter((s) => cmp(shieldSpec, specificity(s)) <= 0);
  assert.deepEqual(losing, [],
    `защита зона ${fmt(shieldSpec)} НЕ бьёт близнеца: ${losing.join(' | ')}`);
});

test('★★★ защита покрывает КАЖДЫЙ токен, который близнец темнит', () => {
  assert.ok(twin.size > 0, 'близнец не объявляет токенов — сравнивать нечего');
  const uncovered = [...twin.keys()].filter((t) => !shield.has(t)).sort();
  assert.deepEqual(uncovered, [],
    `близнец темнит ${uncovered.join(', ')}, а защита зоны их не перекрывает —\n`
    + '  ровно эти свойства баннера уедут в тёмное на светлой странице.');
});

test('★★ значения защиты не разъехались со светлой дельтой .consent в app.css', () => {
  // Защита — ДУБЛЬ литералов из app.css. Дубль допустим только под сверкой:
  // правишь светлую дельту, забываешь здесь — и баннер в зоне тихо расходится
  // с баннером в приложении.
  const base = propsOf(app, (s) => /^\.consent$/.test(s.trim()));
  const drifted = [...shield.entries()]
    .filter(([k, v]) => base.has(k) && base.get(k) !== v)
    .map(([k, v]) => `${k}: app ${base.get(k)} ≠ зона ${v}`);
  assert.deepEqual(drifted, [], `дубль значений разъехался:\n  ${drifted.join('\n  ')}`);

  const missing = [...shield.keys()].filter((t) => !base.has(t)).sort();
  assert.deepEqual(missing, [],
    `защита объявляет ${missing.join(', ')}, чего нет в светлой дельте .consent —\n`
    + '  значит она не «возвращает светлое», а вводит своё третье значение.');
});
