// TRIP-165 · Canon inspector — canon registry + live detection.
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

// `mockup` — имя стиля из присланной Павлом матрицы типографики (макет
// «Triplanio Design System»). Каноны у себя мы НЕ переименовывали (наши имена
// = cls), но по именам макета ориентироваться удобнее — показываем их рядом.
// t-mono в 9-канонной матрице макета отсутствует (наш доп. моно-канон) → '—'.
export const CANONS = [
  { id: 1,  cls: 't-display',    name: 'Display',    mockup: 'display', role: 'Герой, 1 на экран' },
  { id: 2,  cls: 't-title',      name: 'Title',      mockup: 'h1',      role: 'Заголовок страницы' },
  { id: 3,  cls: 't-heading',    name: 'Heading',    mockup: 'h2',      role: 'Заголовок экрана / секции' },
  { id: 4,  cls: 't-subheading', name: 'Subheading', mockup: 'h3',      role: 'Заголовок панели / карточки' },
  { id: 5,  cls: 't-label',      name: 'Label',      mockup: 'label',   role: 'Кнопки, крупные лейблы' },
  { id: 6,  cls: 't-body',       name: 'Body',       mockup: 'body',    role: 'Основной текст, абзацы' },
  { id: 7,  cls: 't-ui',         name: 'UI',         mockup: 'ui',      role: 'Плотный интерфейсный текст' },
  { id: 8,  cls: 't-meta',       name: 'Meta',       mockup: 'meta',    role: 'Даты, вторичная инфо, НЕ-капс подписи booking (Golos)' },
  { id: 9,  cls: 't-micro',      name: 'Micro',      mockup: 'micro',   role: 'Бейджи, капс-метки, капс-эйбрау (JetBrains Mono)' },
  { id: 10, cls: 't-mono',       name: 'Mono',       mockup: '—',       role: 'Коды, идентификаторы, техно-метаданные' },
  // TRIP-175: .t-nano/.t-caption СХЛОПНУТЫ (макет их не содержит) — их члены
  // переехали в .t-meta (НЕ-капс подписи) и .t-micro (капс-эйбрау). Снова 10 канонов.
];

// The sanctioned orthogonal modifiers (app.css Фаза 3). They layer on top of a
// canon; the only legal place (besides canons) where font-weight / line-height
// is set. Order here is the order shown in the panel.
export const MODIFIERS = [
  { key: 'strong', cls: 't-strong', label: 'strong' },
  { key: 'flush',  cls: 't-flush',  label: 'flush'  },
];

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
