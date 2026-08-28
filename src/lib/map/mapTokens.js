// Bridge between the Lumo CSS design tokens and Mapbox paint. Mapbox GL paint
// properties (line-color, …) take a concrete colour string, not a CSS var, so we
// read the resolved value of a design token off the document root at draw time
// and feed it in. Reading it live (instead of a hard-coded hex) is what lets the
// route lines follow the day/night theme: on a theme switch we re-read the token
// and re-apply the paint (see repaintRouteLines + useMapSurface).
//
// `--map-route` / `--map-route-ring` are authored per-theme in src/design/app.css
// (the route colour mirrors --brand; the ring is its translucent selection
// casing). Маркеры живых карт сюда не ходят — это DOM-узлы, токены приезжают в
// них каскадом. Исключение — карта share-карточки: её пины пекутся в растр (см.
// `pinImage.js`), каскада у растра нет, поэтому цвета он берёт здесь, и берёт
// ПОД СВОЮ СХЕМУ (`schemeToken` ниже), а не под тему документа.

const FALLBACK_ROUTE = '#2173C8'; // matches light --map-route; only used pre-paint / in SSR
const FALLBACK_RING = 'rgba(33,115,200,.30)';

// Resolved value of a CSS custom property on :root, trimmed. Returns the fallback
// when there's no document (SSR) or the property is unset. Module-internal.
function cssToken(name, fallback = '') {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// ═══════════════════════════════════════════════════════════════════════════
// ТОКЕН ЧУЖОЙ ТЕМЫ (TRIP-443)
//
// У карты share-карточки СВОЯ тема (кнопка «день/ночь» в плашке карты), и она
// не обязана совпадать с темой приложения: светлую карточку собирают из тёмного
// приложения и наоборот. Значит маршрут и пины на ней надо красить токенами ТОЙ
// темы, которую выбрали для КАРТЫ, — а `getComputedStyle` умеет отдать только
// текущую: тёмная половина токенов объявлена селектором `:root[data-theme="dark"]`,
// и подсунуть этот атрибут вложенному «пробнику» нельзя — `:root` не совпадёт.
//
// Поэтому значения обеих тем читаются ОДИН раз из самих правил (CSSOM). Это не
// обход дизайн-системы: источник тот же самый `app.css`, просто читаем мы его
// декларацию, а не результат каскада. Второго набора хексов в коде не заводится
// (правило #6). Не нашли правило (SSR, кросс-доменная таблица) — падаем на живое
// значение с корня: хуже, но не пусто.
// ═══════════════════════════════════════════════════════════════════════════

/** Токены, которые умеем отдавать «за чужую тему». Список — ВХОДЫ облика карты:
 *  цвет маршрута + всё, что читает пин `.tmk` (роль → `--tmk`, заливка ядра). */
const THEME_TOKEN_NAMES = [
  '--map-route', '--map-route-ring',
  '--brand', '--surface', '--success', '--warm', '--ev-transfer',
];

/** Нормализованный селектор: одинарные кавычки → двойные, лишние пробелы прочь. */
const normSel = (s) => String(s || '').replace(/'/g, '"').replace(/\s+/g, ' ').trim();

/**
 * Разложить объявления кастомных свойств по темам. ЧИСТАЯ функция от списка
 * правил (`{ selectorText, style }`) — её и судит тест, а не DOM.
 *
 * Берём ТОЛЬКО корневые блоки темы (`:root` и `:root[data-theme="dark"]`), а не
 * всё, где встречается `data-theme`: в app.css таким селектором покрашены и
 * отдельные компоненты (`[data-theme="dark"] .btn--primary:hover`), и их
 * объявления к теме документа отношения не имеют. Позже объявленное побеждает —
 * это и есть каскад для двух правил одинаковой специфичности.
 *
 * @param {Iterable<{ selectorText?: string, style?: any }>} rules
 * @param {string[]} names
 * @returns {{ light: Record<string,string>, dark: Record<string,string> }}
 */
export function collectThemeVars(rules, names) {
  const out = { light: {}, dark: {} };
  for (const rule of rules || []) {
    const parts = normSel(rule && rule.selectorText).split(',').map((p) => p.trim());
    const theme = parts.includes(':root[data-theme="dark"]') ? 'dark'
      : parts.includes(':root') ? 'light' : null;
    if (!theme || !rule.style) continue;
    for (const n of names) {
      const v = String(rule.style.getPropertyValue(n) || '').trim();
      if (v) out[theme][n] = v;
    }
  }
  return out;
}

// Плоский список правил документа, включая вложенные в @media/@supports.
// Кросс-доменная таблица бросает на `cssRules` — такую просто пропускаем.
function* allRules(sheets) {
  for (const sheet of sheets || []) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // cross-origin
    yield* walk(rules);
  }
}
function* walk(rules) {
  for (const r of rules || []) {
    if (r.selectorText) yield r;
    if (r.cssRules) yield* walk(r.cssRules);
  }
}

// Кэш на сессию: таблицы стилей за жизнь вкладки не меняются, а разбор всех
// правил — не то, что стоит делать на каждый кадр перекраски.
let _themeVars = null;
function themeVars() {
  if (_themeVars) return _themeVars;
  if (typeof document === 'undefined') return { light: {}, dark: {} };
  try {
    _themeVars = collectThemeVars(allRules(document.styleSheets), THEME_TOKEN_NAMES);
  } catch { _themeVars = { light: {}, dark: {} }; }
  return _themeVars;
}

/**
 * Значение токена для СХЕМЫ карты ('LIGHT' | 'DARK'). Без схемы (undefined) —
 * живое значение текущей темы документа, как и было.
 */
export function schemeToken(name, scheme, fallback = '') {
  if (!scheme) return cssToken(name, fallback);
  const v = themeVars()[scheme === 'DARK' ? 'dark' : 'light'][name];
  return v || cssToken(name, fallback);
}

/** Значения сразу нескольких токенов под схему — для сборки облика пина. */
export function schemeTokens(names, scheme) {
  const out = {};
  names.forEach((n) => { out[n] = schemeToken(n, scheme); });
  return out;
}

// The single route colour (solid + dashed share it; dashed just paints faded).
// `scheme` ('LIGHT'|'DARK') просит цвет ЧУЖОЙ темы — карта карточки живёт со
// своей; без него всё как раньше — живой токен темы документа.
export function routeColor(scheme) {
  return schemeToken('--map-route', scheme, FALLBACK_ROUTE);
}

// Translucent casing colour drawn under a selected route segment.
export function routeRingColor() {
  return cssToken('--map-route-ring', FALLBACK_RING);
}

// Rose accent for the "planned" (future) country fill + city markers — read live
// from the existing --ev-activity token so it follows day/night with a repaint.
// trip + manual fills reuse the brand routeColor() above (distinguished by opacity).
export function futureFillColor() {
  return cssToken('--ev-activity', '#E8639B');
}
