// TRIP-165 · Canon inspector — canon registry + live detection.
//
// The 10 typography canons are defined ONCE, in src/design/app.css (the .t-*
// co-selector rules). This module does NOT re-hardcode their numeric specs —
// it PROBES the live stylesheet: it renders a hidden element per canon class
// and reads getComputedStyle. So the reference values always come straight
// from app.css; if a canon changes there, detection follows automatically.
//
// Only the human-facing labels/roles live here (the tool's own copy).

export const CANONS = [
  { id: 1,  cls: 't-display',    name: 'Display',    role: 'Герой, 1 на экран' },
  { id: 2,  cls: 't-title',      name: 'Title',      role: 'Заголовок страницы' },
  { id: 3,  cls: 't-heading',    name: 'Heading',    role: 'Заголовок экрана / секции' },
  { id: 4,  cls: 't-subheading', name: 'Subheading', role: 'Заголовок панели / карточки' },
  { id: 5,  cls: 't-label',      name: 'Label',      role: 'Кнопки, крупные лейблы' },
  { id: 6,  cls: 't-body',       name: 'Body',       role: 'Основной текст, абзацы' },
  { id: 7,  cls: 't-ui',         name: 'UI',         role: 'Плотный интерфейсный текст' },
  { id: 8,  cls: 't-meta',       name: 'Meta',       role: 'Даты, вторичная инфо' },
  { id: 9,  cls: 't-micro',      name: 'Micro',      role: 'Бейджи, капс-метки' },
  { id: 10, cls: 't-mono',       name: 'Mono',       role: 'Коды, идентификаторы' },
];

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

// Probe the live stylesheet: render each canon class hidden, read its computed
// style. Returns a map id → { sig, spec (applyable props), human }.
export function probeCanons() {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
  document.body.appendChild(host);

  const byId = new Map();
  for (const canon of CANONS) {
    const el = document.createElement('span');
    el.className = canon.cls;
    el.textContent = 'Ag';
    host.appendChild(el);
    const cs = getComputedStyle(el);
    byId.set(canon.id, {
      canon,
      sig: signature(cs),
      human: humanSpec(cs),
      // exact props to copy onto a target element for the live preview
      apply: {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing === 'normal' ? '0' : cs.letterSpacing,
        textTransform: cs.textTransform,
      },
    });
  }
  document.body.removeChild(host);
  return byId;
}

// Which canon (if any) an element currently renders as. Returns the canon id,
// or null when the element matches none of the 10 (off-canon).
export function detectCanon(el, probes) {
  const sig = signature(getComputedStyle(el));
  for (const [id, p] of probes) if (p.sig === sig) return id;
  return null;
}
