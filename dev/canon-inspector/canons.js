// TRIP-165/183 · Canon inspector — canon registry + live detection.
// TRIP-183: каноны «Экзо» (см. mockup-имена + поканонные CANON_MODS ниже); числа пробятся из app.css.
//
// The 10 typography canons are defined ONCE, in src/design/app.css (the .t-*
// co-selector rules). This module does NOT re-hardcode their numeric specs —
// it PROBES the live stylesheet: it renders a hidden element per canon class
// and reads getComputedStyle. So the reference values always come straight
// from app.css; if a canon changes there, detection follows automatically.
//
// The same is true for the two sanctioned orthogonal modifiers (.t-strong,
// .t-flush, app.css Фаза 3) — they combine with ANY canon. We probe every
// canon × modifier-subset combination, so a modified element is recognised as
// "canon + modifier" instead of falling through as off-canon.
//
// Only the human-facing labels/roles live here (the tool's own copy).

// `mockup` — имя стиля из файла типографики «Экзо» (TRIP-183), присланного Павлом.
// Каноны у себя мы НЕ переименовывали (наши имена = cls / name), но по именам файла
// ориентироваться удобнее — показываем их рядом («макет: …»). Гарнитуры те же
// (Exo 2 / Golos Text / JetBrains Mono); TRIP-183 переставил параметры и перевёл
// мета-ярус (meta/label/meta-md) в моно. Числа инспектор берёт из ЖИВОГО app.css.
export const CANONS = [
  { id: 1,  cls: 't-display',    name: 'Display',    mockup: 'hero',     role: 'Герой, 1 на экран (Exo 2)' },
  { id: 2,  cls: 't-title',      name: 'Title',      mockup: 'h1',       role: 'Заголовок страницы (Exo 2)' },
  { id: 3,  cls: 't-heading',    name: 'Heading',    mockup: 'h2',       role: 'Заголовок экрана / секции (Exo 2)' },
  { id: 4,  cls: 't-subheading', name: 'Subheading', mockup: 'h3',       role: 'Заголовок панели / карточки (Exo 2)' },
  { id: 5,  cls: 't-label',      name: 'Label',      mockup: 'title',    role: 'Кнопки, крупные лейблы (Golos 700)' },
  { id: 6,  cls: 't-body',       name: 'Body',       mockup: 'body',     role: 'Основной текст, абзацы (Golos 400)' },
  { id: 7,  cls: 't-ui',         name: 'UI',         mockup: 'body-med', role: 'Плотный интерфейсный текст (Golos 600)' },
  { id: 8,  cls: 't-meta',       name: 'Meta',       mockup: 'meta',     role: 'Даты, вторичная инфо, подписи booking (JetBrains Mono 500)' },
  { id: 9,  cls: 't-micro',      name: 'Micro',      mockup: 'label',    role: 'Бейджи, капс-метки, капс-эйбрау (JetBrains Mono 600, UPPER)' },
  { id: 10, cls: 't-mono',       name: 'Mono',       mockup: 'meta-md',  role: 'Рейтинги, счётчики, коды/идентификаторы (JetBrains Mono 700)' },
  // TRIP-183: мета-ярус (t-meta/t-micro/t-mono) — на JetBrains Mono (каноны «Экзо»).
  // Прозаичный код/email при желании переносится .t-mono → .t-meta канон-аудитором.
];

// Поканонные МОДИФИКАТОРЫ из присланного файла типографики «Экзо» (TRIP-183).
// В файле у каждого канона свой набор вариантов применения (цвет .c-*, компаньоны
// .t-mono/.u-ell, капс/трекинг). Здесь они переключаются в инспекторе как эфемерное
// превью на выбранном элементе (в worklist НЕ сохраняются; цвет сохраняется отдельной
// осью «Цвет текста»). Ключ = id канона. css = дельта поверх базового канона; цвета
// .c-* смаплены на наши токены (c-text→--ink, c-dim→--ink-2, c-mute→--muted, c-acc→--brand).
export const CANON_MODS = {
  1: [ // t-display ← hero
    { label: '.c-text · заголовок страницы',      css: { color: 'var(--ink)' } },
    { label: '.c-acc · акцент-спан в hero',        css: { color: 'var(--brand)' } },
  ],
  2: [ // t-title ← h1
    { label: '.c-text · экран/drawer/модалка',     css: { color: 'var(--ink)' } },
    { label: '#fff · на градиентной обложке',      css: { color: '#fff' } },
  ],
  3: [ // t-heading ← h2
    { label: '.c-text · карточки/списки',          css: { color: 'var(--ink)' } },
    { label: '.tph__total · цена в поиске',         css: { color: 'var(--ink)' } },
    { label: '+ .t-mono · время рейса/метрики',     css: { color: 'var(--ink)', fontFamily: 'var(--font-mono)' } },
  ],
  4: [ // t-subheading ← h3
    { label: '.c-text · строки/подзаголовки',      css: { color: 'var(--ink)' } },
    { label: '+ .u-ell · обрезка в тесных карточках', css: { color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', maxWidth: '170px', verticalAlign: 'bottom' } },
  ],
  5: [ // t-label ← title (Golos)
    { label: '.c-text · строки/поповеры',          css: { color: 'var(--ink)' } },
    { label: '.tp-btn--primary · кнопки/вкладки',   css: { color: 'var(--brand)' } },
    { label: '.c-acc · ссылки',                    css: { color: 'var(--brand)' } },
    { label: '.c-dim · secondary-кнопки',          css: { color: 'var(--ink-2)' } },
  ],
  6: [ // t-body ← body
    { label: '.c-mute · базовый',                  css: { color: 'var(--muted)' } },
    { label: '.c-dim · заметки',                   css: { color: 'var(--ink-2)' } },
    { label: '.c-text · важный абзац',             css: { color: 'var(--ink)' } },
  ],
  7: [ // t-ui ← body-med
    { label: '.c-text · значения/инпуты',          css: { color: 'var(--ink)' } },
    { label: '.c-dim · вторичное',                 css: { color: 'var(--ink-2)' } },
    { label: '.tp-chip--active · чипы',             css: { color: 'var(--brand)' } },
    { label: '.tp-chip--idle',                     css: { color: 'var(--muted)' } },
  ],
  8: [ // t-meta ← meta
    { label: '.c-mute · базовый',                  css: { color: 'var(--muted)' } },
    { label: '.c-dim · значения дат/времени',       css: { color: 'var(--ink-2)' } },
  ],
  9: [ // t-micro ← label
    { label: 'базовый · track-2',                  css: {} },
    { label: '--tight · track-1',                  css: { letterSpacing: '0.08em' } },
    { label: '.tp-pill · статусы',                 css: { color: 'var(--brand)' } },
    { label: 'микро-подписи на медиа',             css: { color: 'var(--muted)', letterSpacing: '0.08em' } },
  ],
  10: [ // t-mono ← meta-md
    { label: '.c-mute · координаты/код',           css: { color: 'var(--muted)' } },
    { label: '.tp-caption · капс track-3',          css: { textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--brand)' } },
    { label: '.tp-caption--mute',                  css: { textTransform: 'uppercase', letterSpacing: '0.2em', color: 'var(--muted)' } },
    { label: '.c-acc · счётчики',                  css: { color: 'var(--brand)' } },
  ],
};

// The sanctioned orthogonal modifiers (app.css Фаза 3). They layer on top of a
// canon; the only legal place (besides canons) where font-weight / line-height
// is set. Used for live detection (probe canon × modifier subsets).
// TRIP-183: strong/flush больше НЕ показываются в UI (их заменили поканонные
// CANON_MODS из файла) — остаются только для ДЕТЕКЦИИ уже-применённых стилей.
export const MODIFIERS = [
  { key: 'strong', cls: 't-strong', label: 'strong' },
  { key: 'flush',  cls: 't-flush',  label: 'flush'  },
];

// TRIP-183: старый генерик-набор состояний (strong/caps/track/mono/flush/mute)
// УДАЛЁН — вместо него поканонные модификаторы из файла типографики (CANON_MODS
// выше). strong/flush остаются как MODIFIERS выше — только для ДЕТЕКЦИИ (probe
// canon × modifier), в UI не показываются.

// Every subset of the modifier list, smallest-first: [], [strong], [flush], …
function modifierSubsets() {
  return MODIFIERS.reduce(
    (acc, m) => acc.concat(acc.map((s) => [...s, m])),
    [[]],
  );
}

const round = (v, p = 1) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n.toFixed(p) : v;
};

// letter-spacing:0 computes to '0px' or 'normal' depending on the engine;
// treat both as the same zero-tracking signature.
const normTracking = (v) => (v === 'normal' ? '0' : round(v, 2));

const familyKey = (v) => (/jetbrains|mono/i.test(v) ? 'mono' : 'sans');

// A comparable fingerprint of the type-affecting computed properties.
export function signature(cs) {
  return [
    round(cs.fontSize, 1),
    parseInt(cs.fontWeight, 10) || cs.fontWeight,
    round(cs.lineHeight, 1),
    normTracking(cs.letterSpacing),
    cs.textTransform || 'none',
    familyKey(cs.fontFamily),
  ].join('|');
}

// Human-readable spec, e.g. "54px · w700 · lh 1.05 · track -0.02em".
function humanSpec(cs) {
  const px = round(cs.fontSize, 1) + 'px';
  const w = 'w' + (parseInt(cs.fontWeight, 10) || cs.fontWeight);
  const fs = parseFloat(cs.fontSize) || 1;
  const lh = 'lh ' + round(parseFloat(cs.lineHeight) / fs, 2);
  const trackPx = normTracking(cs.letterSpacing);
  const track = trackPx === '0' ? 'track 0' : 'track ' + (parseFloat(trackPx) / fs).toFixed(3) + 'em';
  const upper = cs.textTransform === 'uppercase' ? ' · UPPER' : '';
  const mono = familyKey(cs.fontFamily) === 'mono' ? ' · mono' : '';
  return `${px} · ${w} · ${lh} · ${track}${upper}${mono}`;
}

// Exact props to copy onto a target element for the live preview.
function applyProps(cs) {
  return {
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing === 'normal' ? '0' : cs.letterSpacing,
    textTransform: cs.textTransform,
  };
}

const modKey = (mods) => [...mods].sort().join(',');

// Probe the live stylesheet. Returns:
//   canons: Map<id, { human, apply }>          — base canon (no modifier)
//   combos: [{ id, mods:[key], sig, apply }]   — every canon × modifier subset
export function probeCanons() {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
  document.body.appendChild(host);

  const subsets = modifierSubsets();
  const canons = new Map();
  const combos = [];
  for (const canon of CANONS) {
    for (const subset of subsets) {
      const el = document.createElement('span');
      el.className = [canon.cls, ...subset.map((m) => m.cls)].join(' ');
      el.textContent = 'Ag';
      host.appendChild(el);
      const cs = getComputedStyle(el);
      combos.push({ id: canon.id, mods: subset.map((m) => m.key), sig: signature(cs), apply: applyProps(cs) });
      if (!subset.length) canons.set(canon.id, { human: humanSpec(cs), apply: applyProps(cs) });
    }
  }
  document.body.removeChild(host);
  return { canons, combos };
}

// Which canon + modifiers (if any) an element currently renders as. Returns
// { id, mods }, or null when it matches none of the combinations (off-canon).
export function detectCanon(el, probed) {
  const sig = signature(getComputedStyle(el));
  for (const c of probed.combos) if (c.sig === sig) return { id: c.id, mods: c.mods };
  return null;
}

// The applyable props for a given canon id + modifier set (from the probes).
export function comboApply(probed, id, mods) {
  const want = modKey(mods);
  for (const c of probed.combos) if (c.id === id && modKey(c.mods) === want) return c.apply;
  return probed.canons.get(id)?.apply || null;
}

// ── colour axis (TRIP-175) ─────────────────────────────────────────────────
// Sanctioned TEXT colours of the design system (colour is a SEPARATE axis from
// the canon — canons deliberately carry no colour). `css` is the token to apply;
// `util` is the utility class a dev applies in code (empty = set colour via the
// element's own rule / `color: <token>`). This axis IS saved to the worklist.
export const COLORS = [
  { key: 'ink',     label: 'Основной',       css: 'var(--ink)',         util: '' },
  { key: 'ink2',    label: 'Вторичный',      css: 'var(--ink-2)',       util: '' },
  { key: 'muted',   label: 'Приглушённый',   css: 'var(--muted)',       util: '.muted' },
  { key: 'muted2',  label: 'Ещё тише',       css: 'var(--muted-2)',     util: '.muted-2' },
  { key: 'brand',   label: 'Акцент',         css: 'var(--brand)',       util: '' },
  { key: 'danger',  label: 'Ошибка',         css: 'var(--danger-ink)',  util: '.err' },
  { key: 'warn',    label: 'Предупреждение', css: 'var(--warning-ink)', util: '.wrn' },
  { key: 'success', label: 'Успех',          css: 'var(--success-ink)', util: '' },
  // Палитра типов событий/сервисов — для ТЕКСТА берём -ink варианты (так и красит
  // приложение: color: var(--ev-*-ink)), они легибельны в обеих темах.
  { key: 'ev-hotel',     label: 'Эвент · Отель',      css: 'var(--ev-hotel-ink)',     util: '' },
  { key: 'ev-transfer',  label: 'Эвент · Переезд',    css: 'var(--ev-transfer-ink)',  util: '' },
  { key: 'ev-activity',  label: 'Эвент · Активность', css: 'var(--ev-activity-ink)',  util: '' },
  { key: 'ev-car',       label: 'Эвент · Авто',       css: 'var(--ev-car-ink)',       util: '' },
  { key: 'ev-esim',      label: 'Эвент · eSIM',       css: 'var(--ev-esim-ink)',      util: '' },
  { key: 'ev-insurance', label: 'Эвент · Страховка',  css: 'var(--ev-insurance-ink)', util: '' },
  { key: 'ev-deadline',  label: 'Эвент · Дедлайн',    css: 'var(--ev-deadline-ink)',  util: '' },
  { key: 'ev-service',   label: 'Эвент · Сервис',     css: 'var(--ev-service-ink)',   util: '' },
];
export const colorByKey = (key) => COLORS.find((c) => c.key === key) || null;

// Probe each colour token to its computed rgb (like probeCanons), so we can
// detect an element's current colour and preview swatches truthfully per theme.
export function probeColors() {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
  document.body.appendChild(host);
  const map = new Map();
  for (const c of COLORS) {
    const el = document.createElement('span');
    el.style.color = c.css; host.appendChild(el);
    map.set(c.key, getComputedStyle(el).color);
  }
  document.body.removeChild(host);
  return map;
}
// The design colour an element currently renders in, or null (custom / off-palette).
export function detectColor(el, colorMap) {
  const rgb = getComputedStyle(el).color;
  for (const [k, v] of colorMap) if (v === rgb) return k;
  return null;
}
