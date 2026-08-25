#!/usr/bin/env node
/**
 * Design-system guard.
 *
 * Scans src/ for values that bypass the design tokens and reports them in five
 * tiers:
 *   • TYPOGRAPHY  — ENFORCED. Raw font sizes (text-[Npx], font-size:Npx,
 *     inline fontSize:<number>) must come from --fs-* tokens. A violation
 *     fails the check (exit 1). Typography is fully migrated, so this protects
 *     it from regressing.
 *   • COLOR       — ENFORCED (since TRIP-53). Raw hex + raw Tailwind palette
 *     classes fail the check outside COLOR_WHITELIST.
 *   • LAYERS      — ENFORCED (since TRIP-321). A raw z-index of 10 or more —
 *     in CSS or as a JSX `zIndex:` prop — is a new unnamed floor outside the
 *     --z-* ladder and fails the check. Below 10 is a component-local stack.
 *   • BREAKPOINTS — ENFORCED as a composition ratchet (since TRIP-321). A
 *     breakpoint cannot be a token (custom properties are invalid in media
 *     features), so the scale lives here. Off-scale @media widths are compared
 *     per file against BASE_REF: one may disappear, none may appear. A count
 *     alone would be bypassable — normalise one 768px, add a 777px, same total.
 *     Range syntax and multiline preludes are parsed; escape hatch is
 *     `design-token-exempt` inside the @media prelude.
 *   • SPACING     — ENFORCED as a composition ratchet (since TRIP-339). Раз
 *     `gap:10` и `gap:11` независимы, два одинаковых на вид блока формально
 *     различны и не схлопываются никогда — поэтому язык значений закрывается
 *     раньше, чем начинается схлопывание объектов (эпик TRIP-337, фаза Ф1).
 *     Мультимножество сырых px-величин сверяется с BASE_REF ПО ВСЕМУ РЕПО:
 *     величина может исчезнуть, но не появиться. Область — репозиторий, а не
 *     файл, потому что фазы 04–09 переносят правила в базу, и пофайловый
 *     счётчик краснел бы на файле-приёмнике при каждом правильном ходе.
 *     Предикат (что вообще считается сырым отступом) — код, см. SPACING_PROPS;
 *     escape — `design-token-exempt` на строке.
 *
 * Whitelisted files legitimately carry raw values (external brand colours,
 * Mapbox/canvas paint that needs concrete hex, SVG illustration fills, the
 * token-definition stylesheets, and work explicitly deferred).
 *
 * COLOR_WHITELIST is a RATCHET (TRIP-321): it is the unification worklist, so it
 * may only ever shrink. Three rules keep it honest and all three FAIL the check:
 *   1. an entry naming a file that no longer exists  — stale, delete the line;
 *   2. an entry whose file has 0 raw colour left     — done, delete the line so
 *      the file becomes protected (that is the whole point of cleaning it);
 *   3. more entries than WHITELIST_LIMIT             — the list grew, i.e. some
 *      change bought itself an exemption instead of using a token;
 *   4. WHITELIST_LIMIT higher than on the PR base    — see below.
 * Rule 4 is what makes this a real ratchet. Rules 1-3 all live inside THIS file,
 * so a change can add a whitelist entry and raise the ceiling in the same commit
 * and rule 3 still passes. The ceiling is therefore also compared against the
 * base revision (BASE_REF, as in scripts/ci/*): it may go down, never up.
 * Need a genuinely raw colour in an otherwise clean file? Annotate THAT LINE
 * with `design-token-exempt` — never re-add the whole file.
 *
 * Env: BASE_REF (default origin/dev). Unresolvable ref → rule 4 is skipped
 * (local runs outside a checkout with the base fetched); rules 1-3 still apply.
 *
 * Run: npm run check:design
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const COLOR_ENFORCED = true; // Lumo colour pass landed (TRIP-53): raw colour now fails CI

const ROOT = 'src';
// Сканируемое ВНЕ `src`. Константа, а не литерал в двух местах: ярус SPACING
// собирает базовое множество через `git ls-tree … -- <пути>`, и стоит этому
// списку разъехаться со `SCANNED`, как файл, отсутствующий на базовой стороне,
// прочитается «новым» ЦЕЛИКОМ — красный на том самом PR, который всего лишь
// вносит его в периметр (ровно это ждало бы подзадачу 10 с site.css).
const SCAN_EXTRA = ['public/site.css'];

// Files allowed to contain raw COLOUR values (hex / palette classes).
// RATCHET — may only shrink. See the header for the three rules; lower
// WHITELIST_LIMIT to the new length every time an entry is retired.
const COLOR_WHITELIST = [
  'src/lib/externalBrands.js',                         // external brand registry
  'src/lib/avatarRamp.js',                             // avatar colour source
  'src/index.css', 'src/design/app.css',               // token DEFINITIONS
  'src/lib/map/captureMap.js',                         // canvas map-capture (share image) needs concrete hex
  'src/components/AppErrorBoundary.jsx',               // crash screen — must not depend on tokens/CSS
  // — Added with the Lumo colour finale (TRIP-53): raw-by-nature sources —
  'src/lib/budget/category-colors.js',                 // category token↔hex source map (token defs)
  'src/lib/map/mapTokens.js',                          // Mapbox paint fallbacks (need concrete hex)
  'src/pages/Login.jsx',                               // Google + Triplanio logo SVGs
  // login.css — МЁРТВЫЙ лист старого логина (не импортируется), удерживается до
  // Ф6 CSS-teardown (TRIP-460): экран переехал на зонную ДС site.css §AUTH. Его
  // сырые цвета остаются как были на dev — трогать умирающий файл смысла нет.
  'src/pages/login.css',                               // dead (pending Ф6 teardown); raw colours untouched
  // — Isolated standalone pages with embedded styles; pending a dedicated Lumo colour pass —
  // (TRIP-460) LandingPage.jsx re-added: retiring it after the Hero-only draft
  // (which briefly had 0 raw colour) was premature — the full 11-section 1:1
  // port carries demo/brand-mock colours from the prototype verbatim
  // (avatars, Telegram/WhatsApp icon tints, budget bar segments, map pins),
  // matching its original origin/dev reason (demo visuals + brand icons).
  // NB: keep this block free of apostrophes — the guard test parses
  // COLOR_WHITELIST by single-quote pairs, so a stray one mis-seeds the
  // fixture and the whole spacing suite goes red (TRIP-460 B3).
  'src/pages/Landing/LandingPage.jsx',                 // marketing page: demo visuals + brand icons
  'public/site.css',                                // marketing landing: mockup/brand demo visuals (typography still enforced)
];

// Ratchet ceiling — the length of COLOR_WHITELIST above. Retiring an entry means
// lowering this number in the same commit; nothing may ever raise it.
// PublicTrip.css retired (TRIP-461): the public reader moved into public/site.css.
const WHITELIST_LIMIT = 13;

// The ceiling on the PR base, so raising it cannot be self-approved by editing
// this file. null = base not resolvable (no such ref, or the base predates this
// constant) → rule 4 is skipped rather than guessed.
const BASE_REF = process.env.BASE_REF || 'origin/dev';
const baseSrc = (() => {
  try {
    return execFileSync('git', ['show', `${BASE_REF}:scripts/check-design-tokens.mjs`], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // ref missing (shallow clone / fresh fork) — not a violation
  }
})();
// 0 is a VALID ceiling (debt fully paid), so `|| null` would wrongly disable the
// check exactly when it matters most. null means "constant absent/unparsable".
const baseConst = (name) => {
  const raw = baseSrc?.match(new RegExp(`^const ${name} = (\\d+)`, 'm'))?.[1];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
};
// A file as it exists on the PR base (null = added in this PR / base unavailable).
const baseFile = (path) => {
  if (!baseSrc) return null; // BASE_REF itself unresolvable
  try {
    return execFileSync('git', ['show', `${BASE_REF}:${path}`], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};
const baseLimit = (() => {
  try {
    return baseConst('WHITELIST_LIMIT');
  } catch {
    return null;
  }
})();

// Files allowed to contain raw FONT SIZES.
const TYPO_WHITELIST = [
  // src/design/app.css is NO LONGER whitelisted (TRIP-165): it now has 0 raw px /
  // 0 clamp / 0 em, so typography is enforced there too — new raw sizes fail CI.
  // (Its --fs-* token defs are `--fs-nano: 10px;` etc. — no `font-size:` prefix,
  // so the fontSizePx/Clamp/Em regexes don't match them.)
  'src/index.css', 'src/pages/login.css', // --fs-* token defs / Tailwind-preflight 1em/1rem resets only
];

// Files allowed to contain raw font-weight / line-height / letter-spacing (TRIP-165/410).
// Система Geologica (single-font): 10 канонов .t-* + РОВНО три санкционированных
// модификатора — .t-strong (вес), .t-flush (line-height:1), .tp-caption (CAPS +
// трекинг, поверх канона). Модификатор .t-sans УДАЛЁН (мета-ярус — Geologica, не
// моно). Weight/line-height/tracking legally live ONLY in canon (.t-*), these
// modifiers and base root rules. (letter-spacing added to this tier in the TRIP-165
// audit 2026-07-02: tracking is a canon axis.)
//   • app.css   — home of the 10 canons + .t-strong/.t-flush/.tp-caption + base `body`.
//   • index.css — Tailwind preflight / reset base.
//   • login.css — isolated auth base (pending Lumo; also a base/reset home).
//   • site.css — STANDALONE marketing/legal stylesheet loaded WITHOUT app.css
//     (SiteChrome + static terms/privacy pages), so its bare h1..h4 + `body`
//     ARE the typographic canon home for that subtree — its own base.
//   • fonts.css — @font-face declarations DEFINE each font's weight axis
//     (font-weight: 400/500/600/700 per file); that's a font definition, not
//     text styling.
// (PublicTrip.css retired in TRIP-461 — the public reader now lives in site.css.)
const WEIGHT_LH_ALLOW = [
  'src/design/app.css', 'src/index.css', 'src/pages/login.css', 'public/site.css',
  'src/design/fonts.css',
];

// Files allowed to set inline JSX fontSize from a raw size token (var(--fs-*))
// rather than a .t-* canon class. Both are documented decorative/crash islands:
//   • AppErrorBoundary — crash screen, must render token-CSS-free (canons may be down).
//   • LandingPage      — marketing mockup chrome (fake-app visuals), not semantic app text.
const TYPO_INLINE_VAR_ALLOW = ['src/components/AppErrorBoundary.jsx', 'src/pages/Landing/LandingPage.jsx'];

// Files allowed a raw z-index (TRIP-321). site.css is the STANDALONE marketing/
// legal stylesheet — it is loaded WITHOUT app.css, so the --z-* tokens do not
// resolve there at all; it owns its own tiny ladder. Anywhere else a raw layer is
// a bug, and a genuinely local stack takes a per-line `design-token-exempt`.
const LAYERS_ALLOW = ['public/site.css'];

// Sanctioned responsive scale (TRIP-321). A breakpoint CANNOT be a token: custom
// properties are not allowed in media-feature values, so `@media (max-width:
// var(--bp))` is invalid CSS and the numbers must stay literal. The scale is
// therefore held by this guard instead of by the stylesheet.
// Off-scale breakpoints are GRANDFATHERED, and the ratchet compares the MULTISET
// of off-scale widths against BASE_REF — not a count. A count alone is bypassable:
// normalise one grandfathered 768px and add a 777px and the total is unchanged.
// Comparing identities means an off-scale width may disappear, never appear.
// Normalising an existing one moves where the layout switches, so each is a
// visual decision, not a sweep.
// site.css is exempt — standalone marketing page with its own responsive design.
const BREAKPOINTS = [640, 880];
const BREAKPOINT_ALLOW = ['public/site.css'];

// ── SPACING (TRIP-339) — язык значений отступа ──────────────────────────────
// Шкала: --sp-1 2px · --sp-2 4 · --sp-3 6 · --sp-4 8 · --sp-5 10 · --sp-6 12 ·
// --sp-7 16 · --sp-8 20. Она НЕ двигается; модификаторы .row--gN легальны.
//
// ПРЕДИКАТ — ЭТО КОД, А НЕ ЧИСЛО. Три независимых прогона по «сырым отступам»
// дали 962 / 1011 / 1304 и 38 / 45 / 42 уникальных (TRIP-337 §12). Расхождение
// не в чьих-то ошибках, а в том, что «сырой отступ» никем не определён. Поэтому
// абсолютное число тут не константа и ни на что не влияет — его печатает сам
// этот предикат:
//   • свойства — padding/margin/gap + longhand'ы и логические (см. SPACING_PROPS);
//     `grid-gap`/`scroll-padding` НЕ попадают: перед именем обязан стоять `;{`
//     или пробел, а не дефис;
//   • shorthand разбирается ПОЗНАЧЕННО: `padding: 8px 12px` — это ДВЕ единицы
//     словаря. Иначе правка 12→10 внутри shorthand'а невидима для храповика;
//   • px внутри `calc()` и внутри фолбэка `var(--x, 96px)` считается: скобка не
//     отмывает литерал (9 и 4 живых случая соответственно);
//   • отрицательное — ОТДЕЛЬНАЯ величина (`-8px` ≠ `8px`): иначе смена знака
//     проходит мимо храповика. Оговорка: минус читается как знак, только если
//     он ПРИЖАТ к числу. В `calc(var(--num) - 14px)` (PublicTrip.css, 1 живой
//     случай) это оператор вычитания, и величина считается как `14px` — литерал
//     не теряется, но величиной он числится положительной;
//   • ноль не считается: `0px` не ступень и роли не несёт (1 живой случай);
//   • `var(--sp-N)` — уже на шкале, к сырым не относится.
// Инлайновые отступы в JSX сюда НЕ входят намеренно: их держит храповик 2l
// (`scripts/ci/check-inline-styles.mjs`), и двойной учёт дал бы двойную красноту
// за один и тот же ход.
//
// ОБЛАСТЬ — РЕПОЗИТОРИЙ, А НЕ ФАЙЛ, и это не удобство, а требование эпика.
// Фазы 04–09 переносят правила ИЗ файлов экранов В app.css. Пофайловый счётчик
// краснел бы на файле-приёмнике при каждом таком переносе, то есть ровно на
// правильном движении (в app.css уже большая часть сырых значений).
//
// УСТРОЙСТВО — как у BREAKPOINTS: не счёт, а МУЛЬТИМНОЖЕСТВО {величина: сколько
// раз}, сверяемое с BASE_REF. Величина может исчезнуть, но не появиться. Счёта
// одного мало по той же причине, что и у брейкпоинтов: заменил одно значение,
// добавил другое — сумма та же. Что это даёт:
//   перенос правила между файлами            → нейтрально
//   два правила схлопнулись в одно           → вниз
//   сырое значение заменено на var(--sp-N)   → вниз
//   появилась новая величина 19px            → КРАСНЫЙ
//   прогон 11px → 12px                       → КРАСНЫЙ (count(12) вырос)
// Последняя строка — не побочный эффект, а §10 «никаких прогонов по значениям»:
// именно такой прогон уже сделал .checkbox круглым (TRIP-321 Ф3b).
//
// ⚠️ ОЖИДАЕМАЯ КРАСНОТА, КОТОРАЯ НЕ ЕСТЬ ПОЛОМКА. В 04–06 при схлопывании двух
// объектов канон-значение побеждает по большинству, и count(канона) вырастет.
// Это правильно — §10 требует, чтобы такой ход был ВИДЕН, — но встречать это
// надо как ожидаемое. Выход штатный: `design-token-exempt` на строке с причиной.
//
// ИЗВЕСТНАЯ ДЫРА, названная чтобы не была тихой: маркер исключения снимает
// строку со счёта на ОБЕИХ сторонах, поэтому дописать его к строке, которую ты
// иначе не трогаешь, — значит освободить бюджет под новое значение той же
// величины. Машиной это здесь не закрывается (в отличие от 2o маркер тут
// построчный и вечный, как у цвета с типографикой), но добавление маркера
// видно в диффе и обязано нести причину — это решение ревью, а не гарда.
//
// ВТОРАЯ ИЗВЕСТНАЯ ДЫРА, того же класса, что понижение токена на гарде 2o
// (`163 → 162`: имя не сократилось, а СПРЯТАЛОСЬ): величину можно увести в
// собственную переменную — `--x: 19px; padding: var(--x)`. Объявление `--x`
// не является объявлением отступа, предикат его не видит, и счётчик падает,
// хотя словарь не сократился. Живых случаев сегодня НОЛЬ: единственные
// px-значные переменные в `src/**.css` — сама шкала `--sp-1…8`. Закрывать это
// счётом «всех `--x: Npx`» нельзя по той же причине, по которой пол 2o не
// считает переменные на вариантах: закон 3 в правильном исполнении производит
// их пачками, и предикат стал бы тормозом на верном движении.
//
// public/site.css — вне периметра до подзадачи 10 (standalone-лендинг со
// своим языком; там ещё 171 сырое значение / 30 уникальных).
const SPACING_PROPS = [
  // Longhand'ы ПЕРВЫМИ: иначе альтернатива `padding` съест префикс `padding-top`.
  'padding-inline-start', 'padding-inline-end', 'padding-block-start', 'padding-block-end',
  'margin-inline-start', 'margin-inline-end', 'margin-block-start', 'margin-block-end',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-inline', 'padding-block',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline', 'margin-block',
  'row-gap', 'column-gap',
  'padding', 'margin', 'gap',
];
const SPACING_ALLOW = ['public/site.css'];

const PALETTE = '(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
const RE = {
  textPx:    /text-\[[0-9.]+px\]/,
  fontSizePx:/font-size:\s*[0-9.]+px/,
  fontSizeClamp:/font-size:\s*clamp\(/,
  fontSizeEm:/font-size:\s*(?!1(em|rem)\b)[0-9.]+r?em/,
  inlineFs:  /fontSize:\s*[0-9.]+[,\s}]/,
  // Inline JSX fontSize sourced from a raw size token (var(--fs-*)) instead of a
  // .t-* canon class — bypasses the numeric inlineFs regex. Enforced everywhere
  // except the two documented decorative/crash islands (see TYPO_INLINE_VAR_ALLOW).
  inlineFsVar:/fontSize:\s*['"]?var\(--fs/,
  // TRIP-165 — вес, межстрочный интервал и трекинг легально живут ТОЛЬКО в
  // канон-правилах / .t-strong / .t-flush / базовых root-правилах (body, .ptrip).
  // В компонентных/страничных CSS их быть не должно — эмфаза даётся классом
  // .t-strong, флеш-центровка — .t-flush, трекинг фиксирует сам канон.
  fontWeightNum:/font-weight:\s*[0-9]/,
  lineHeightNum:/line-height:\s*[0-9.]/,
  // Трекинг (letter-spacing) — часть канона (каждый .t-* фиксирует трекинг). В
  // сыром CSS / JSX-<style> легально только в канон-доме + base-root'ах
  // (WEIGHT_LH_ALLOW). Ранее не сканировался → booking-эйбрау держали .04em мимо
  // канона (TRIP-165 аудит 2026-07-02). Escape для разрядки глифов — design-token-exempt.
  letterSpacingNum:/letter-spacing:\s*-?[0-9.]/,
  // TRIP-321 — этаж ≥10 обязан быть --z-*. Кавычки: React применяет zIndex:'999'.
  rawZIndex: /(?:z-index|zIndex):\s*['"]?(\d+)/,
  // TRIP-321 — брейкпоинт вне шкалы BREAKPOINTS.
  // Прелюдия @media целиком (может быть многострочной) — до открывающей «{».
  mediaPrelude: /@media([^{]*)\{/g,
  // Ширина внутри прелюдии: legacy `max-width: 700px` И range `width <= 700px`
  // / `700px <= width`. Иначе новый брейкпоинт заезжает через range-синтаксис.
  mediaWidth: /(?:(?:min-|max-)?width\s*[:<>=]+\s*(\d+)px)|(?:(\d+)px\s*[<>=]+\s*width)/g,
  // TRIP-339 — объявление отступа. Перед именем обязан стоять `;`, `{` или
  // пробел, поэтому `grid-gap` / `scroll-padding` (там дефис) не ловятся.
  spacingDecl: new RegExp(`(?:^|[;{\\s])(${SPACING_PROPS.join('|')})\\s*:\\s*([^;}]*)`, 'gi'),
  // Длина в px внутри значения. Знак — часть величины. `(?<![\\w.])` не пускает
  // хвост более длинного токена (`--sp-4`, `1e2px`) за начало числа.
  spacingPx: /(?<![\w.])(-?\d*\.?\d+)px\b/g,
  hex:       /#[0-9a-fA-F]{3,8}\b/,
  paletteCls:new RegExp(`\\b(bg|text|border|ring|from|to|via|divide|outline|fill|stroke|placeholder|shadow|accent|caret)-${PALETTE}-[0-9]{2,3}(\\/[0-9]+)?\\b`),
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(jsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

const typo = [];
const color = [];
const layers = []; // raw z-index off the --z-* ladder (TRIP-321)
// Off-scale ширины файла как МУЛЬТИМНОЖЕСТВО {ширина: сколько раз}. Скан идёт по
// целым прелюдиям @media, а не построчно: прелюдия бывает многострочной, и тогда
// построчный разбор её просто не видит.
const offScaleWidths = (text) => {
  const out = new Map();
  if (!text) return out;
  // Комментарии вырезаем (закомментированный @media — не брейкпоинт), но маркер
  // design-token-exempt сохраняем: иначе escape-люк в прелюдии не сработает.
  const body = text.replace(/\/\*[\s\S]*?\*\//g, (m) => (m.includes('design-token-exempt') ? ' design-token-exempt ' : ' '));
  for (const q of body.matchAll(RE.mediaPrelude)) {
    if (q[1].includes('design-token-exempt')) continue;
    for (const w of q[1].matchAll(RE.mediaWidth)) {
      const px = Number(w[1] ?? w[2]);
      if (!Number.isFinite(px) || BREAKPOINTS.includes(px)) continue;
      out.set(px, (out.get(px) || 0) + 1);
    }
  }
  return out;
};
const bp = [];     // @media widths off the BREAKPOINTS scale (TRIP-321)

// Сырые величины отступа ОДНОГО файла как МУЛЬТИМНОЖЕСТВО {«12px»: сколько
// раз} — предикат описан у SPACING_PROPS. Пофайловая гранулярность нужна не
// вердикту (он репозиторный), а ОТЧЁТУ: см. комментарий у spacingHead.
// Комментарии гасим ПРОБЕЛАМИ той же длины, сохраняя переводы строк: иначе
// съезжают и смещения, и номера строк, а построчный `design-token-exempt`
// перестаёт попадать на свою строку.
const spacingValues = (text) => {
  const out = new Map();
  if (!text) return out;
  const body = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lines = text.split('\n');
  for (const d of body.matchAll(RE.spacingDecl)) {
    // Строка ОБЪЯВЛЕНИЯ (не файла): значение бывает многострочным, но маркер
    // ставится там, где человек его видит — у имени свойства.
    // Отсчёт ведётся от ИМЕНИ СВОЙСТВА, а не от начала матча: граничный символ
    // `[;{\s]` матчем СЪЕДЕН и сам бывает переводом строки (свойство в нулевой
    // колонке) — от начала матча номер уехал бы на строку выше, и построчный
    // маркер молча перестал бы срабатывать. Та же дыра, что у мутации 4 в
    // тесте, только с другого конца. `indexOf` тут точен: граничный символ
    // ровно один и заведомо не буква, так что имя свойства встречается первым.
    const line = body.slice(0, d.index + d[0].indexOf(d[1])).split('\n').length;
    if (lines[line - 1]?.includes('design-token-exempt')) continue;
    for (const px of d[2].matchAll(RE.spacingPx)) {
      const n = Number(px[1]);
      if (!Number.isFinite(n) || n === 0) continue;  // ноль — не ступень
      const key = `${n}px`;
      out.set(key, (out.get(key) || 0) + 1);
    }
  }
  return out;
};

// Raw-colour count per whitelisted file — the unification worklist (TRIP-321).
// A whitelisted file that reaches 0 must leave the list; see the header.
const wlDebt = new Map(COLOR_WHITELIST.map((f) => [f, 0]));

// ── TRIP-165 typography-composition report (REPORT-ONLY until migration done) ──
// Measures the remaining "not yet on a .t-* canon" surface so we can track the
// unification worklist to zero. Does NOT affect exit code — flip TYPO_COMP_ENFORCED
// to true only once every component text is on a .t-* class (TRIP-165 finale).
const TYPO_COMP_ENFORCED = true; // TRIP-165 finale: worklist reached 0 → block any text outside the 10 canons
const TOKEN_SIZES = new Set(['9.5', '11', '12.5', '13', '14.5', '16', '16.5', '26', '44']); // TRIP-183 плотная шкала «Экзо» (+16 = --fs-h4, не-канон 16px: анти-zoom/крупная кнопка)
// Files that legitimately DEFINE typography (token/canon/base rules) — not component text.
// AppErrorBoundary = crash screen, intentionally token/CSS-free (must render even if
// the design system fails to load) → exempt.
const TYPO_COMP_ALLOW = ['src/index.css', 'src/design/app.css', 'src/design/fonts.css', 'src/pages/login.css', 'src/components/AppErrorBoundary.jsx'];
const area = (f) => {
  const m = f.replace('src/', '').match(/^(design|pages\/[A-Za-z]+|components\/[a-z]+|lib\/[a-z]+|lib)/);
  return m ? m[1] : f.replace('src/', '');
};
const typoComp = {}; // area -> { offSize, inlineWeight, inlineLh, inlineLs, inlineFamily }
const bump = (f, k) => { const a = area(f); (typoComp[a] ||= { offSize: 0, inlineWeight: 0, inlineLh: 0, inlineLs: 0, inlineFamily: 0 })[k]++; };

const SCANNED = [...walk(ROOT), ...SCAN_EXTRA];
for (const file of SCANNED) {
  const isCss = file.endsWith('.css');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const loc = `${file}:${i + 1}`;
    // Per-line escape hatch for legit raw typography (layout line-height on a
    // stacked price column, decorative glyph). Same annotation as colour/composition.
    const dtExempt = line.includes('design-token-exempt');
    // typography — raw sizes. The `font-size:` / `font-weight:` / `line-height:`
    // regexes match CSS syntax (hyphenated), so they ALSO catch CSS-in-JS <style>
    // blocks inside .jsx WITHOUT false-matching inline camelCase props (fontSize:).
    // That closes the old isCss blind spot where <style> template strings in
    // components hid raw typography from the guard (TRIP-165 audit 2026-07-02).
    if (!TYPO_WHITELIST.includes(file) && !dtExempt) {
      if (RE.textPx.test(line))        typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (RE.fontSizePx.test(line))    typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (RE.fontSizeClamp.test(line)) typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (RE.fontSizeEm.test(line))    typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (!isCss && RE.inlineFs.test(line)) typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (!isCss && !TYPO_INLINE_VAR_ALLOW.includes(file) && RE.inlineFsVar.test(line)) typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
    }
    // TRIP-165 Фаза 3 — weight / line-height closed set. Legal only in canon /
    // .t-strong / .t-flush / base-root homes (WEIGHT_LH_ALLOW); the per-line
    // design-token-exempt escape covers genuine layout line-height.
    if (!WEIGHT_LH_ALLOW.includes(file) && !dtExempt) {
      if (RE.fontWeightNum.test(line)) typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (RE.lineHeightNum.test(line)) typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (RE.letterSpacingNum.test(line)) typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
    }
    // layers — the overlap ladder must stay in --z-* (TRIP-321)
    if (!dtExempt && !LAYERS_ALLOW.includes(file)) {
      const z = line.match(RE.rawZIndex);
      if (z && Number(z[1]) >= 10) layers.push(`${loc}  ${line.trim().slice(0, 90)}`);
    }
    // colour — scanned for EVERY file. Outside the whitelist a hit is a
    // violation; inside it, the hit is counted as remaining debt so a file that
    // reaches 0 can be forced off the list instead of silently staying exempt.
    {
      const whitelisted = COLOR_WHITELIST.includes(file);
      // One raw-colour hit: a violation, or — on a whitelisted file — one unit of debt.
      const recordHit = () => {
        if (whitelisted) wlDebt.set(file, wlDebt.get(file) + 1);
        else color.push(`${loc}  ${line.trim().slice(0, 90)}`);
      };
      const isTokenDef = /--[a-z0-9-]+\s*:/.test(line); // skip token definitions
      // Pure white / black are theme-neutral (white text on a brand surface,
      // black scrims) — they don't fragment the palette the way a raw brand/
      // accent hex does, so they're allowed. Flag a line only if it carries a
      // NON-neutral hex.
      // Per-line escape hatch for legit raw colour (data-viz palettes, map
      // backdrops) inside otherwise token-clean active files — annotate the
      // line with `design-token-exempt` instead of whitelisting the whole file.
      const exempt = line.includes('design-token-exempt');
      const hexes = line.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
      const nonNeutralHex = hexes.some((h) => !/^#(fff|ffffff|000|000000)$/i.test(h));
      if (!exempt && !isTokenDef && nonNeutralHex)            recordHit();
      if (!exempt && !isCss && RE.paletteCls.test(line))      recordHit();
    }
    // typography composition (report-only) — only component files, not canon/token defs
    // Skip lines with a container-computed fontSize (e.g. `fontSize: size * 0.55`) —
    // those are decorative glyphs (avatar initials), not text, scaled to their box.
    const computedGlyph = /fontSize:\s*[A-Za-z_$][\w$]*\s*[*/]/.test(line);
    // Per-line escape hatch for legit non-canon inline type (marketing/decorative).
    const typoExempt = line.includes('design-token-exempt');
    if (!TYPO_COMP_ALLOW.includes(file) && !computedGlyph && !typoExempt) {
      // off-token raw px sizes (CSS `font-size: Npx` / inline `fontSize: 'Npx'|N`)
      const cssSize = line.match(/font-size:\s*([\d.]+)px/);
      if (cssSize && !TOKEN_SIZES.has(cssSize[1])) bump(file, 'offSize');
      const jsSize = line.match(/fontSize:\s*['"]?([\d.]+)(?:px)?['"]?[,\s}]/);
      if (!isCss && jsSize && !TOKEN_SIZES.has(jsSize[1])) bump(file, 'offSize');
      // inline JSX typography props (component sets its own type instead of a .t-* class)
      if (!isCss) {
        if (/fontWeight:/.test(line))    bump(file, 'inlineWeight');
        if (/lineHeight:/.test(line))    bump(file, 'inlineLh');
        if (/letterSpacing:/.test(line)) bump(file, 'inlineLs');
        if (/fontFamily:/.test(line))    bump(file, 'inlineFamily');
      }
    }
  });
}

const hr = '─'.repeat(60);
console.log(`\n${hr}\nDesign-token guard\n${hr}`);
console.log(`\nTYPOGRAPHY (enforced) — ${typo.length} violation(s):`);
typo.forEach((l) => console.log('  ✗ ' + l));
if (!typo.length) console.log('  ✓ none — all text sizes use --fs-* tokens');

console.log(`\nCOLOUR (${COLOR_ENFORCED ? 'enforced' : 'report-only, pending Lumo'}) — ${color.length} occurrence(s):`);
color.slice(0, 40).forEach((l) => console.log('  • ' + l));
if (color.length > 40) console.log(`  … and ${color.length - 40} more`);
if (!color.length) console.log('  ✓ none');

console.log(`\nLAYERS (enforced) — ${layers.length} raw z-index off the --z-* ladder:`);
layers.forEach((l) => console.log('  ✗ ' + l));
if (!layers.length) console.log('  ✓ none — every stacking layer is a --z-* token');

// Ратчет по составу — см. комментарий у BREAKPOINTS.
// Ратчет по СОСТАВУ: для каждого сканируемого файла считаем мультимножество
// off-scale ширин и сверяем с тем же файлом на базе PR. Ширина может исчезнуть,
// но не появиться — и «нормализовал 768, добавил 777» больше не проходит, хотя
// суммарное число не изменилось.
const bpNew = [];
let bpTotal = 0;
for (const file of SCANNED) {
  if (BREAKPOINT_ALLOW.includes(file)) continue;
  const now = offScaleWidths(readFileSync(file, 'utf8'));
  for (const n of now.values()) bpTotal += n;
  if (!baseSrc) continue;                       // база недоступна — сверять не с чем
  const was = offScaleWidths(baseFile(file));   // null → пустая карта (файл новый)
  for (const [px, n] of now) {
    const had = was.get(px) || 0;
    if (n > had) bpNew.push(`${file}  ${px}px ×${n - had}` + (had ? ` (было ×${had})` : ' (новая ширина)'));
  }
}
const bpOver = bpNew.length > 0;
console.log(`\nBREAKPOINTS — ${bpTotal} off the ${BREAKPOINTS.join('/')} scale (grandfathered):`);
bpNew.forEach((l) => console.log('  ✗ ' + l));
if (bpOver) console.log(`  ✗ new off-scale breakpoint vs ${BASE_REF}. Use ${BREAKPOINTS.join(' or ')}, or put \`design-token-exempt\` in the @media prelude with a reason.`);
else if (!baseSrc) console.log(`  ✓ ${BASE_REF} unavailable — composition not compared`);
else console.log('  ✓ ratchet intact — no off-scale width appeared vs ' + BASE_REF + ' (normalising one moves the layout switch: visual decision, not a sweep)');

// ── SPACING — храповик по СОСТАВУ, область = репозиторий (TRIP-339) ──
// Почему репозиторий, а не файл, и почему мультимножество, а не счёт — см.
// комментарий у SPACING_PROPS. Здесь только сама сверка.
//
// База берётся списком файлов из дерева BASE_REF, а не по именам файлов HEAD:
// иначе удалённый на HEAD файл не попал бы в базовое множество, и снос целого
// экрана читался бы как «величина исчезла» ровно так же, как её схлопывание, —
// но, что важнее, ПЕРЕИМЕНОВАННЫЙ файл дал бы базу пустой и его значения
// посчитались бы новыми.
//
// Обе стороны держатся ФАЙЛ → {величина: сколько раз}, хотя вердикт считается
// по сумме. Плоская карта «величина → сколько раз» вердикт даёт тот же, а вот
// отчёт делает вредным: на частой величине («12px ×112, было ×111») адреса
// брались из общей кучи и показывали шесть случайных мест из ста двенадцати —
// ни одно из них не тронуто этим PR. Разработчик получал «где-то в репо стало
// на одно больше». Пофайловая дельта называет ровно те файлы, где счётчик
// поднялся, и вердикт от этого НЕ становится пофайловым: перенос правила между
// файлами по-прежнему нейтрален — про него в отчёте просто не будет речи,
// потому что суммарно ничего не выросло.
//
// Шум, названный чтобы не удивлял: на СТОРОНЕ ОТЧЁТА переименованный файл
// выглядит новым (`— путь новый`), потому что пути сопоставляются по имени.
// Проявляется только вместе с настоящим ростом той же величины где-то ещё, то
// есть засоряет и без того красный вывод, а настоящий виновник стоит выше —
// список отсортирован по дельте. Лечится `--find-renames`, но это новый вызов
// git и новая ветка кода ради косметики уже красного отчёта. ВЕРДИКТА это не
// касается: там переименование нейтрально (см. абзац про базовый список).
const byFile = (files, read) => {
  const out = new Map();
  for (const f of files) out.set(f, spacingValues(read(f)));
  return out;
};
// Периметр объявлен ОДИН раз на обе стороны: разъедутся — база и HEAD увидят
// разные множества файлов, и значения «нового» пути посчитаются приростом
// (мутация 8 в тесте). Инлайны в JSX держит храповик 2l — тут только CSS.
const inSpacingScope = (f) => f.endsWith('.css') && !SPACING_ALLOW.includes(f);
const spacingHead = byFile(SCANNED.filter(inSpacingScope), (f) => readFileSync(f, 'utf8'));
const spacingBase = (() => {
  if (!baseSrc) return null;            // BASE_REF недостижим — сверять не с чем
  try {
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', BASE_REF, '--', ROOT, ...SCAN_EXTRA], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n').filter(inSpacingScope);
    return byFile(files, baseFile);
  } catch {
    return null;
  }
})();
/** ФАЙЛ → {величина: раз}  ⇒  {величина: раз} по всему репо. Это и есть вердикт. */
const totals = (byFileMap) => {
  const out = new Map();
  for (const vals of byFileMap.values()) for (const [k, n] of vals) out.set(k, (out.get(k) || 0) + n);
  return out;
};
const headTotals = totals(spacingHead);
const spGrew = [];
if (spacingBase) {
  const baseTotals = totals(spacingBase);
  for (const [key, n] of [...headTotals].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
    const had = baseTotals.get(key) || 0;
    if (n <= had) continue;
    // Виноваты только файлы, где счётчик ИМЕННО ЭТОЙ величины поднялся.
    const culprits = [...spacingHead]
      .map(([file, vals]) => ({ file, now: vals.get(key) || 0, was: spacingBase.get(file)?.get(key) || 0 }))
      .filter(({ now, was }) => now > was)
      .sort((a, b) => (b.now - b.was) - (a.now - a.was))   // кто прибавил больше — тот выше
      .map(({ file, now, was }) => `        ${file}: ×${now} (было ×${was}${spacingBase.has(file) ? '' : ' — путь новый'})`);
    spGrew.push(`${key} ×${n} (было ×${had}${had ? '' : ' — НОВАЯ величина'})\n${culprits.join('\n')}`);
  }
}
const spTotal = [...headTotals.values()].reduce((a, b) => a + b, 0);
const spOver = spGrew.length > 0;
console.log(`\nSPACING — ${spTotal} сырых значений отступа, ${headTotals.size} уникальных (шкала --sp-1…8: 2/4/6/8/10/12/16/20):`);
spGrew.forEach((l) => console.log('  ✗ ' + l));
if (spOver) {
  console.log(`  ✗ величина отступа выросла против ${BASE_REF}. Храповик крутится только вниз: возьми ступень \`var(--sp-N)\`, схлопни правило с существующим — или поставь на строке \`design-token-exempt\` с причиной.`);
  console.log('    Перенос правила между файлами и схлопывание двух правил в одно этот храповик НЕ трогают — он считает по всему репо.');
} else if (!spacingBase) console.log(`  ✓ ${BASE_REF} unavailable — состав не сверялся`);
else console.log(`  ✓ ratchet intact — ни одна величина не выросла против ${BASE_REF} (прогон по значениям «11→12» тут краснеет: §10 запрещает их, а сумма при таком прогоне не меняется)`);

// ── COLOUR WHITELIST — ratchet + unification worklist (TRIP-321) ──
// The per-file counts below are the remaining raw-colour debt: this is the
// Ф2 progress meter, and it is only allowed to go down.
const wlStale = COLOR_WHITELIST.filter((f) => !existsSync(f));
const wlClean = COLOR_WHITELIST.filter((f) => existsSync(f) && wlDebt.get(f) === 0);
const wlTotal = [...wlDebt.values()].reduce((a, b) => a + b, 0);
console.log(`\nCOLOUR WHITELIST (ratchet — ${COLOR_WHITELIST.length}/${WHITELIST_LIMIT} entries) — ${wlTotal} raw colour(s) still exempt:`);
[...wlDebt.entries()].sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`    ${String(n).padStart(3)}  ${f}`));
wlStale.forEach((f) => console.log(`  ✗ stale — file no longer exists, delete the entry: ${f}`));
wlClean.forEach((f) => console.log(`  ✗ clean — 0 raw colour left; delete the entry and lower WHITELIST_LIMIT: ${f}`));
if (COLOR_WHITELIST.length > WHITELIST_LIMIT) {
  console.log(`  ✗ whitelist grew — ${COLOR_WHITELIST.length} entries > limit ${WHITELIST_LIMIT}. Use a per-line \`design-token-exempt\`, not a file exemption.`);
}
const ceilingRaised = baseLimit !== null && WHITELIST_LIMIT > baseLimit;
if (ceilingRaised) {
  console.log(`  ✗ ceiling raised — WHITELIST_LIMIT ${baseLimit} → ${WHITELIST_LIMIT} vs ${BASE_REF}. The ratchet only turns down: bind the colour to a token, or annotate that line \`design-token-exempt\`.`);
}
const wlFailed = wlStale.length > 0 || wlClean.length > 0 || COLOR_WHITELIST.length > WHITELIST_LIMIT || ceilingRaised;
if (!wlFailed) {
  const vs = baseLimit === null ? `${BASE_REF} unavailable — ceiling not compared` : `ceiling ${WHITELIST_LIMIT} ≤ ${baseLimit} on ${BASE_REF}`;
  console.log(`  ✓ ratchet intact — every entry exists and still carries debt; ${vs}`);
}

// ── TRIP-165 typography-composition report (report-only) ──
const compAreas = Object.entries(typoComp).sort((a, b) => {
  const sum = (o) => o.offSize + o.inlineWeight + o.inlineLh + o.inlineLs + o.inlineFamily;
  return sum(b[1]) - sum(a[1]);
});
const compTotal = compAreas.reduce((acc, [, o]) => {
  acc.offSize += o.offSize; acc.inlineWeight += o.inlineWeight; acc.inlineLh += o.inlineLh;
  acc.inlineLs += o.inlineLs; acc.inlineFamily += o.inlineFamily; return acc;
}, { offSize: 0, inlineWeight: 0, inlineLh: 0, inlineLs: 0, inlineFamily: 0 });
const compSum = compTotal.offSize + compTotal.inlineWeight + compTotal.inlineLh + compTotal.inlineLs + compTotal.inlineFamily;
console.log(`\nTYPOGRAPHY COMPOSITION (report-only, TRIP-165 — migrate to .t-* canons) — ${compSum} site(s) left:`);
console.log(`  off-token size: ${compTotal.offSize} · inline weight: ${compTotal.inlineWeight} · inline line-height: ${compTotal.inlineLh} · inline tracking: ${compTotal.inlineLs} · inline font-family: ${compTotal.inlineFamily}`);
for (const [a, o] of compAreas) {
  const s = o.offSize + o.inlineWeight + o.inlineLh + o.inlineLs + o.inlineFamily;
  if (s) console.log(`    ${String(s).padStart(3)}  ${a}`);
}
if (!compSum) console.log('  ✓ none — every component text is on a .t-* canon');

const failed = typo.length > 0 || layers.length > 0 || bpOver || spOver || (COLOR_ENFORCED && color.length > 0) || (TYPO_COMP_ENFORCED && compSum > 0) || wlFailed;
console.log(`\n${hr}\n${failed ? '✗ FAILED' : '✓ PASSED'}\n${hr}\n`);
process.exit(failed ? 1 : 0);
