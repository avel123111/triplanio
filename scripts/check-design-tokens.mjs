#!/usr/bin/env node
/**
 * Design-system guard.
 *
 * Scans src/ for values that bypass the design tokens and reports them in four
 * tiers (the structural ones - layers, breakpoints, radii - also scan public/,
 * static .html pages included; see STRUCTURAL below):
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
 *   • RADII       — ENFORCED (since TRIP-321 Ф8) as two separate rules.
 *     (1) ABSOLUTE: a raw radius at or above the scale floor (--r-sm, 11px)
 *     fails, because that value IS expressible by the scale. Below the floor
 *     the scale has no step at all: that is shape, and stays a literal.
 *     (2) DEGENERATION, a ratchet vs BASE_REF: the browser clamps a radius to
 *     half the shorter side, so a legal step can silently render as a circle.
 *     Detecting it needs whole RULES parsed, since width/height and
 *     border-radius routinely sit on different lines. Rationale, the scale and
 *     the grandfathering all live at RADIUS_TOKENS below.
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

// Files allowed to contain raw COLOUR values (hex / palette classes).
// RATCHET — may only shrink. See the header for the three rules; lower
// WHITELIST_LIMIT to the new length every time an entry is retired.
const COLOR_WHITELIST = [
  'src/lib/externalBrands.js',                         // external brand registry
  'src/lib/avatarRamp.js',                             // avatar colour source
  'src/pages/login.css',                               // isolated; pending Lumo
  'src/index.css', 'src/design/app.css',               // token DEFINITIONS
  'src/lib/map/captureMap.js',                         // canvas map-capture (share image) needs concrete hex
  'src/components/chat/TriplanioAvatar.jsx',           // SVG illustration fills
  'src/components/AppErrorBoundary.jsx',               // crash screen — must not depend on tokens/CSS
  // — Added with the Lumo colour finale (TRIP-53): raw-by-nature sources —
  'src/lib/trip-gradients.js',                         // trip-cover gradient presets (colour data)
  'src/lib/budget/category-colors.js',                 // category token↔hex source map (token defs)
  'src/lib/map/mapTokens.js',                          // Mapbox paint fallbacks (need concrete hex)
  'src/components/site/SiteChrome.jsx',                // brand logo + country-flag SVGs
  'src/pages/Login.jsx',                               // Google + Triplanio logo SVGs
  // — Isolated standalone pages with embedded styles; pending a dedicated Lumo colour pass —
  'src/pages/Landing/LandingPage.jsx',                 // marketing page: demo visuals + brand icons
  'src/pages/JoinTrip.jsx',                            // standalone join page (embedded <style>)
  'src/pages/PublicTrip.css',                          // public read-only page styles
  'public/landing.css',                                // marketing landing: mockup/brand demo visuals (typography still enforced)
];

// Ratchet ceiling — the length of COLOR_WHITELIST above. Retiring an entry means
// lowering this number in the same commit; nothing may ever raise it.
const WHITELIST_LIMIT = 17;

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

// Files allowed to contain raw font-weight / line-height / letter-spacing (TRIP-165).
// Everywhere else emphasis is the .t-strong modifier and flush-centering is
// .t-flush — weight/line-height/tracking legally live ONLY in canon (.t-*), the two
// sanctioned modifiers (.t-strong/.t-flush) and base root rules. (letter-spacing
// added to this tier in the TRIP-165 audit 2026-07-02: tracking is a canon axis.)
//   • app.css   — home of the 10 canons + .t-strong/.t-flush + base `body`.
//   • index.css — Tailwind preflight / reset base.
//   • login.css — isolated auth base (pending Lumo; also a base/reset home).
//   • landing.css — STANDALONE marketing/legal stylesheet loaded WITHOUT app.css
//     (SiteChrome + static terms/privacy pages), so its bare h1..h4 + `body`
//     ARE the typographic canon home for that subtree — its own base.
//   • fonts.css — @font-face declarations DEFINE each font's weight axis
//     (font-weight: 400/500/600/700 per file); that's a font definition, not
//     text styling.
//   • PublicTrip.css — the standalone public reader's base root `.ptrip`
//     (like `body`) sets the base reading weight/line-height; the rest of the
//     page is on the closed set.
const WEIGHT_LH_ALLOW = [
  'src/design/app.css', 'src/index.css', 'src/pages/login.css', 'public/landing.css',
  'src/design/fonts.css', 'src/pages/PublicTrip.css',
];

// Files allowed to set inline JSX fontSize from a raw size token (var(--fs-*))
// rather than a .t-* canon class. Both are documented decorative/crash islands:
//   • AppErrorBoundary — crash screen, must render token-CSS-free (canons may be down).
//   • LandingPage      — marketing mockup chrome (fake-app visuals), not semantic app text.
const TYPO_INLINE_VAR_ALLOW = ['src/components/AppErrorBoundary.jsx', 'src/pages/Landing/LandingPage.jsx'];

// Files allowed a raw z-index (TRIP-321). landing.css owns its own small ladder.
// It is NOT an isolated sheet: SiteChrome injects it on the `/` and
// `/public/trip/:id` React routes, where app.css is already loaded, so --z-*
// resolves there and both sets share one root stacking context. The exemption
// therefore holds only while landing's numbers stay clear of the ladder - a
// `z-index: 300` added there would sit on the confirm floor unnoticed.
// Static public/*.html ARE isolated (they load only /landing.css), so a local
// stack there takes a per-line `design-token-exempt`, not a file exemption.
const LAYERS_ALLOW = ['public/landing.css'];

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
// landing.css is exempt — standalone marketing page with its own responsive design.
// 768 - третья ЛЕГАЛЬНАЯ ступень (решение Pavel, TRIP-321 Ф9): «брейкпоинт меню»
// из src/hooks/use-mobile.jsx, на котором выпадашки становятся шторками, а
// диалоги drawer'ами. Переставить его = сменить поведение на планшетах, то есть
// продуктовое решение, а не уборка, поэтому он вписан в шкалу, а не вычищен.
const BREAKPOINTS = [640, 768, 880];
const BREAKPOINT_ALLOW = ['public/landing.css'];

// ── RADII (TRIP-321 Ф8) ──────────────────────────────────────────────────────
// Шкала радиусов (зеркало --r-* из app.css). Пол шкалы делит забор надвое:
//   • >= пола и сырой  → долг: такое значение шкала выразить МОЖЕТ, привяжись;
//   • <  пола и сырой  → легально: ступени там нет вообще, это форма (волосяная
//     линия, точка, скруглённый конец штриха), а не шаг шкалы.
const RADIUS_TOKENS = {
  '--r-sm': 11, '--r-btn': 14, '--r-md': 16, '--r-xl': 20, '--r-card': 24, '--r-pill': 999,
  '--r-control': 14, '--r-seg-track': 14, '--r-seg-btn': 10,
};
// Пол именно --r-sm, а не минимум карты: --r-seg-btn (10px) ниже, но это
// производная ступень сегмент-контрола, а не самостоятельный шаг общей шкалы.
const RADIUS_FLOOR = RADIUS_TOKENS['--r-sm'];
// Таблетка заведомо больше любой стороны: зажимается всегда и намеренно.
const RADIUS_PILL = RADIUS_TOKENS['--r-pill'];
const RADII_ALLOW = ['public/landing.css'];    // автономный лендинг со своей шкалой

// ВЫРОЖДЕНИЕ. Браузер зажимает радиус до половины меньшей стороны, и зажимается
// НОВОЕ значение: на элементе 14px ступень 8px даёт 7px, то есть идеальный круг
// (так чекбокс и уехал в прод радиокнопкой на Ф3b). Связать размер с радиусом
// можно только разбором ПРАВИЛА целиком: width/height и border-radius сплошь и
// рядом на разных строках, и построчный скан их вместе не видит - именно
// поэтому проверка той фазы регрессию пропустила.
// Порог тут абсолютным быть НЕ может: все 12 уже зажатых правил легальны (2-3px
// точки и рейлы со скруглённым концом; пять из них - флекс-идиома min-width:0,
// где сторона по сути не задана). Регрессию отличает не величина, а то, что
// элемент СТАЛ круглым, поэтому храповик к базе PR, как у брейкпоинтов: уже
// зажатое дедовщинное, новое зажатое валит CI.

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
  // Флаг g обязателен: без него на строке разбирается только ПЕРВАЯ декларация.
  // Отсюда же ограничение - звать ТОЛЬКО через matchAll (он берёт копию регекса);
  // .test()/.exec() на общем g-регексе тащат lastIndex между вызовами и начнут
  // пропускать строки через одну.
  rawZIndex: /(?:z-index|zIndex)\s*:\s*['"]?(\d+)/gi,
  // TRIP-321 — брейкпоинт вне шкалы BREAKPOINTS.
  // Прелюдия @media целиком (может быть многострочной) — до открывающей «{».
  mediaPrelude: /@media([^{]*)\{/g,
  // Ширина внутри прелюдии: legacy `max-width: 700px` И range `width <= 700px`
  // / `700px <= width`. Иначе новый брейкпоинт заезжает через range-синтаксис.
  mediaWidth: /(?:(?:min-|max-)?width\s*[:<>=]+\s*(\d+)px)|(?:(\d+)px\s*[<>=]+\s*width)/g,
  // TRIP-321 Ф9 - брейкпоинты, живущие в JS: они переключают саму РАЗМЕТКУ
  // (выпадашка↔шторка, диалог↔drawer), но @media-скану не видны вовсе. Строка
  // внутри matchMedia() - та же прелюдия, поэтому разбирается тем же mediaWidth.
  // Шаблонная `${X - 1}px` литеральных цифр не несёт и сюда не попадает: её
  // источник - сама константа, так что двойного счёта нет.
  matchMediaCall: /matchMedia\(\s*[`'"]([^`'"]*)[`'"]/g,
  jsBreakpointConst: /(?:const|let|var)\s+\w*BREAKPOINT\w*\s*=\s*(\d+)/gi,
  innerWidthCompare: /innerWidth\s*([<>])=?\s*(\d+)/g,
  // TRIP-321 Ф8 — радиус в CSS и в инлайновом JSX (borderRadius: '12px' / 12).
  // Значение обрывается и на ЗАПЯТОЙ: в JSX-объекте она разделяет свойства, и
  // без неё захват уезжает в соседние (`borderRadius: 4, fontWeight: 700` читался
  // как радиус 700). В CSS у border-radius запятых не бывает, обрыв безвреден.
  // Поугловая форма (border-top-left-radius / borderBottomRightRadius) тоже
  // считается радиусом: иначе `border-top-left-radius: 16px` заезжает без писка.
  anyRadius: /border-?(?:(?:top|bottom)-?(?:left|right)-?)?radius:\s*([^;}\n,]+)/gi,
  // Правило целиком: «селектор { декларации }». Внутренние правила @media-блока
  // матчатся сами по себе, потому что своих скобок внутри не имеют.
  cssRule:   /([^{}@]+)\{([^{}]*)\}/g,
  hex:       /#[0-9a-fA-F]{3,8}\b/,
  paletteCls:new RegExp(`\\b(bg|text|border|ring|from|to|via|divide|outline|fill|stroke|placeholder|shadow|accent|caret)-${PALETTE}-[0-9]{2,3}(\\/[0-9]+)?\\b`),
};

// .html входит ради статических страниц public/: они несут свою вёрстку, и
// структурные ярусы обязаны её видеть. В src/ .html нет, поэтому дом
// типографики и цвета этим не меняется.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(jsx?|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

const typo = [];
const color = [];
// Off-scale ширины файла как МУЛЬТИМНОЖЕСТВО {ширина: сколько раз}. Скан идёт по
// целым прелюдиям @media, а не построчно: прелюдия бывает многострочной, и тогда
// построчный разбор её просто не видит.
const offScaleWidths = (text) => {
  const out = new Map();
  if (!text) return out;
  // Ключ - НАПРАВЛЕНИЕ плюс ширина («max:700»), а не голое число: переворот
  // min↔max меняет, по какую сторону брейкпоинта применяется правило, то есть
  // сдвигает точку переключения раскладки, но по самому числу неотличим и
  // проезжал храповик молча.
  const add = (dir, px) => {
    if (!Number.isFinite(px) || BREAKPOINTS.includes(px)) return;
    const k = `${dir}:${px}`;
    out.set(k, (out.get(k) || 0) + 1);
  };
  // Комментарии вырезаем (закомментированный @media — не брейкпоинт), но маркер
  // design-token-exempt сохраняем: иначе escape-люк в прелюдии не сработает.
  const body = text.replace(/\/\*[\s\S]*?\*\//g, (m) => (m.includes('design-token-exempt') ? ' design-token-exempt ' : ' '));
  const scanPrelude = (prelude) => {
    if (prelude.includes('design-token-exempt')) return;
    for (const w of prelude.matchAll(RE.mediaWidth)) {
      // w[1] — legacy `min-/max-width: Npx`; w[2] — range `Npx <= width`.
      // Направление выводится и из range-синтаксиса: `width <= 700px` это max,
      // а `700px <= width` — min. Общий ключ «range» схлопывал бы их в один, то
      // есть переворот, записанный через range, проехал бы храповик молча.
      const dir = /max-width/.test(w[0]) ? 'max'
        : /min-width/.test(w[0]) ? 'min'
        : w[1] !== undefined ? (/</.test(w[0]) ? 'max' : 'min')   // width <op> Npx
        : (/</.test(w[0]) ? 'min' : 'max');                       // Npx <op> width
      add(dir, Number(w[1] ?? w[2]));
    }
  };
  for (const q of body.matchAll(RE.mediaPrelude)) scanPrelude(q[1]);
  // Те же ширины, но из JS (почему - см. RE.matchMediaCall).
  for (const q of body.matchAll(RE.matchMediaCall)) scanPrelude(q[1]);
  for (const q of body.matchAll(RE.jsBreakpointConst)) add('const', Number(q[1]));
  // `innerWidth < N` это тот же max-width, `> N` — min-width. Направление тут
  // тоже обязано быть в ключе, иначе переворот сравнения проедет храповик.
  for (const q of body.matchAll(RE.innerWidthCompare)) add(q[1] === '<' ? 'max' : 'min', Number(q[2]));
  return out;
};

// ── RADII (TRIP-321 Ф8) ──────────────────────────────────────────────────────
// Разбить значение по пробелам ВЕРХНЕГО уровня: `calc(var(--r-md) - 8px)` внутри
// обязан содержать пробелы по синтаксису, и наивный split рвёт его на куски,
// после чего значение молча читается как 16 вместо 8.
const topLevelParts = (v) => {
  const out = []; let buf = ''; let depth = 0;
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (buf) out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
};
// Длина в пикселях: литерал, токен шкалы или calc(токен ± Npx). Всё прочее
// (проценты, em, неизвестный var) → null = «не наше дело», а не 0. Меряет и
// радиусы, и стороны (width/height): вырождение сравнивает одно с другим.
const lengthPx = (v) => {
  if (!v) return null;
  v = v.trim().replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/^['"]|['"]$/g, '');
  const c = v.match(/^calc\(\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*([+-])\s*([\d.]+)px\s*\)$/);
  if (c) { const b = RADIUS_TOKENS[c[1]]; return b === undefined ? null : (c[2] === '+' ? b + Number(c[3]) : b - Number(c[3])); }
  const t = v.match(/^var\(\s*(--[a-z0-9-]+)/);
  if (t) return RADIUS_TOKENS[t[1]] ?? null;
  const m = v.match(/^([\d.]+)(?:px)?$/);      // JSX допускает голое число: borderRadius: 12
  return m ? Number(m[1]) : null;
};
// Долг правила 1: сырые радиусы >= пола, мультимножество {значение: сколько раз}.
const rawRadiiAtOrAboveFloor = (text, isJsx) => {
  const out = new Map();
  if (!text) return out;
  for (const line of text.split('\n')) {
    if (line.includes('design-token-exempt')) continue;
    for (const m of line.matchAll(RE.anyRadius)) {
      // split('/') отсекает хвост: вертикальные радиусы эллипса и `/* … */`.
      for (const part of topLevelParts(m[1].split('/')[0])) {
        // ТОЛЬКО литерал; токен и calc(токен) не долг. В JSX единица
        // подразумевается, и голое `borderRadius: 16` это те же 16px: не считать
        // его значит не видеть основную форму инлайновых стилей.
        const lit = part.match(isJsx ? /^['"]?([\d.]+)(?:px)?['"]?$/ : /^([\d.]+)px$/);
        if (!lit) continue;
        const px = Number(lit[1]);
        if (px >= RADIUS_FLOOR && px < RADIUS_PILL) out.set(px, (out.get(px) || 0) + 1);
      }
    }
  }
  return out;
};
// Правила, где радиус зажимается в круг: {селектор: эффективный радиус}. Ключ
// селектор, а не строка: он переживает сдвиг файла, а номер строки нет.
const clampedRules = (text) => {
  const out = new Map();
  if (!text) return out;
  for (const m of text.matchAll(RE.cssRule)) {
    const body = m[2];
    if (!/border-radius/.test(body) || body.includes('design-token-exempt')) continue;
    const decl = (prop) => {
      const r = body.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`));
      return r ? r[1].trim() : null;
    };
    const raw = decl('border-radius');
    if (!raw || raw.includes('%')) continue;              // 50% = примитив формы, не шкала
    const radii = topLevelParts(raw.split('/')[0]).map(lengthPx).filter((v) => v !== null);
    if (!radii.length) continue;
    const radius = Math.max(...radii);
    if (radius >= RADIUS_PILL) continue;                  // --r-pill: намеренная таблетка
    const sides = [lengthPx(decl('width')) ?? lengthPx(decl('min-width')),
                   lengthPx(decl('height')) ?? lengthPx(decl('min-height'))].filter((v) => v !== null);
    if (!sides.length) continue;                          // размер не задан здесь, судить не можем
    const side = Math.min(...sides);
    // Сторона 0 - это `min-width: 0`, стандартный enabler сжатия во флексе, а не
    // размер элемента. Без этой отсечки любое правило, куда добавили min-width:0,
    // падало бы с «СТАЛО КРУГОМ»: ложное срабатывание, от которого гард отключают.
    if (!side) continue;
    if (radius < side / 2) continue;                      // ложится целиком, формы не меняет
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/\s+/g, ' ');
    out.set(sel, Math.min(radius, side / 2));
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

// SCANNED - дом типографики и цвета: src/ плюс лендинг. Прочие статические
// страницы public/ (юр. тексты, og-заглушки) сюда нельзя: у них свой шрифт, а
// цветовой белый список - ХРАПОВИК, куда записи добавлять запрещено, так что
// без записи они сразу валят CI.
const SCANNED = [...walk(ROOT), 'public/landing.css'];
// STRUCTURAL - дом слоёв, брейкпоинтов и радиусов: ВЕСЬ public/, включая .html.
// Эти три оси не про текст, поэтому статические страницы им подчиняются даже со
// своей типографикой - а дыра была именно там: privacy/terms.html держали свой
// z-index, свои @media и вторую шкалу радиусов (--radius-card/--radius-btn) вне
// поля зрения гарда.
const STRUCTURAL = [...new Set([...SCANNED, ...walk('public')])];
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

// ── LAYERS (TRIP-321 Ф9) ── свой проход по STRUCTURAL, а не строка в главном
// цикле: этаж - вещь структурная, и public/*.html держат собственные z-index.
const layers = [];  // сырой z-index мимо шкалы --z-*
for (const file of STRUCTURAL) {
  if (LAYERS_ALLOW.includes(file)) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (line.includes('design-token-exempt')) return;
    // Значение в отчёт: на строке с двумя декларациями иначе две одинаковые
    // записи, и непонятно, какой именно этаж мимо шкалы.
    for (const z of line.matchAll(RE.rawZIndex)) {
      if (Number(z[1]) >= 10) layers.push(`${file}:${i + 1}  z-index:${z[1]}  ${line.trim().slice(0, 90)}`);
    }
  });
}

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
for (const file of STRUCTURAL) {
  if (BREAKPOINT_ALLOW.includes(file)) continue;
  const now = offScaleWidths(readFileSync(file, 'utf8'));
  for (const n of now.values()) bpTotal += n;
  if (!baseSrc) continue;                       // база недоступна — сверять не с чем
  const was = offScaleWidths(baseFile(file));   // null → пустая карта (файл новый)
  for (const [key, n] of now) {                 // key = «направление:ширина», см. offScaleWidths
    const had = was.get(key) || 0;
    if (n > had) bpNew.push(`${file}  ${key}px ×${n - had}` + (had ? ` (было ×${had})` : ' (новая ширина)'));
  }
}
const bpOver = bpNew.length > 0;
console.log(`\nBREAKPOINTS — ${bpTotal} off the ${BREAKPOINTS.join('/')} scale (grandfathered):`);
bpNew.forEach((l) => console.log('  ✗ ' + l));
if (bpOver) console.log(`  ✗ new off-scale breakpoint vs ${BASE_REF}. Use ${BREAKPOINTS.join(' or ')}, or put \`design-token-exempt\` in the @media prelude with a reason.`);
else if (!baseSrc) console.log(`  ✓ ${BASE_REF} unavailable — composition not compared`);
else console.log('  ✓ ratchet intact — no off-scale width appeared vs ' + BASE_REF + ' (normalising one moves the layout switch: visual decision, not a sweep)');

// ── RADII (TRIP-321 Ф8) ── обоснование обоих правил см. у RADIUS_TOKENS.
const radiiDebt = [];   // правило 1: сырые радиусы >= пола шкалы
const radiiClamp = [];  // правило 2: правила, СТАВШИЕ круглыми против базы
let radiiDebtTotal = 0;
let clampedTotal = 0;
for (const file of STRUCTURAL) {
  if (RADII_ALLOW.includes(file)) continue;
  // Два РАЗНЫХ признака, и путать их нельзя. Голая единица (`borderRadius: 16`)
  // подразумевается только в JSX; в CSS и в <style> статической страницы это
  // невалидно, и считать её долгом значит выдумывать нарушение.
  const isJsx = /\.jsx?$/.test(file);
  // А вот РАЗМЕЧЕННЫЙ правилами CSS есть и в .css, и внутри <style> у .html —
  // значит вырождение обязано проверяться в обоих, иначе охрана public/ покрывает
  // только половину забора.
  const hasCssRules = !isJsx;
  const src = readFileSync(file, 'utf8');
  // Правило 1 АБСОЛЮТНОЕ, без сверки с базой: долг доведён до нуля, поэтому
  // дедовщина не нужна, и правило одинаково работает локально и на PR dev→main.
  for (const [px, n] of rawRadiiAtOrAboveFloor(src, isJsx)) {
    radiiDebtTotal += n;
    radiiDebt.push(`${file}  ${px}px ×${n}`);
  }
  const nowClamp = hasCssRules ? clampedRules(src) : new Map();
  clampedTotal += nowClamp.size;
  if (!hasCssRules || !baseSrc) continue;                  // база недоступна, сверять не с чем
  const wasClamp = clampedRules(baseFile(file));
  for (const [sel, eff] of nowClamp) {
    if (wasClamp.has(sel)) continue;                       // уже зажималось = дедовщина
    radiiClamp.push(`${file}  {${sel.slice(-58)}}  рисуется ${eff}px = круг`);
  }
}
const radiiOver = radiiDebt.length > 0 || radiiClamp.length > 0;
console.log(`\nRADII (enforced) — ${radiiDebtTotal} сырых >= ${RADIUS_FLOOR}px (пол шкалы) · ${clampedTotal} зажатых в круг (grandfathered):`);
radiiDebt.forEach((l) => console.log('  ✗ сырой радиус: ' + l));
radiiClamp.forEach((l) => console.log('  ✗ СТАЛО КРУГОМ: ' + l));
if (radiiDebt.length) console.log(`  ✗ радиус >= ${RADIUS_FLOOR}px шкала выражает: привяжись к --r-*, либо пометь строку \`design-token-exempt\` с причиной.`);
if (radiiClamp.length) console.log('  ✗ браузер зажимает радиус до половины МЕНЬШЕЙ стороны, и зажимается НОВОЕ значение: элемент стал круглым (так чекбокс превратился в радиокнопку). Возьми ступень ниже или оставь литерал.');
if (!radiiOver) {
  const vs = baseSrc ? `новых вырождений против ${BASE_REF} нет` : `${BASE_REF} unavailable — вырождение не сверялось`;
  console.log(`  ✓ ни одного сырого радиуса >= пола шкалы; ${vs}`);
}

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

const failed = typo.length > 0 || layers.length > 0 || bpOver || radiiOver || (COLOR_ENFORCED && color.length > 0) || (TYPO_COMP_ENFORCED && compSum > 0) || wlFailed;
console.log(`\n${hr}\n${failed ? '✗ FAILED' : '✓ PASSED'}\n${hr}\n`);
process.exit(failed ? 1 : 0);
