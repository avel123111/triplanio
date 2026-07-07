/**
 * Share-card SVG template (TRIP-193) - the Journey design, ported pixel-for-pixel
 * from the design source (journey-preview) into a data-driven template.
 *
 * The map "window" is a CUSTOM CUTOUT (organic blob, rotated -5°), not a plain
 * rectangle: the map lives BEHIND the frame, independent of it. `overlay` mode
 * punches that exact shape as a transparent hole so the client lays this PNG over
 * the live interactive map (which shows through the hole); `card` mode bakes the
 * captured map into the shape. The cutout's bounding box is exported as the map
 * slot so the client positions the live map to fill the hole.
 *
 * The decorative red pin + Google-style map chips from the mockup are NOT baked
 * here: our map is the live Mapbox map, which draws its own route + city points.
 *
 * Fonts: the design uses Montserrat 600/800 which are not embedded yet - resvg
 * maps them to the nearest bundled weight (700). Weights are kept as-designed so
 * the port is faithful once the extra weights land. Bump TEMPLATE_VERSION on any
 * visual change so the cache invalidates.
 *
 * Per project content rule: hyphen "-", never the em dash "—".
 */

import { qrSvg } from './qr.ts';
import { PLANE_DATA_URI } from './journeyAssets.ts';

export const TEMPLATE_VERSION = 'v3-journey';

export type Format = 'story' | 'post';

export type CardData = {
  title: string;
  route: string; // "Париж - Мадрид"
  dateMonth: string; // "СЕН."
  dateDay: string; // "11" (shown in the yellow chip)
  dateRest: string; // "- 3 ОКТ 2026"
  facts: string;
  distanceStr: string; // "10 584"
  distanceLabel: string; // "км в пути"
  cta: string;
  tagline: string; // "спланируй свой трип"
  promo: string; // "бесплатно за пару минут"
  site: string; // "triplanio.com"
  brand: string;
};

// ---- map cutout (blob) -----------------------------------------------------
// The blob is authored in a 591×820 box and placed on the card by `transform`
// (centre + rotate + scale). Server mask/clip, the white border and the exported
// slot all derive from this single source, so they always agree.
const BLOB_W = 591;
const BLOB_H = 820;
const BLOB_D =
  'M55.9,7.9 Q103.8,11.7 151.8,7.0 Q199.7,2.3 247.6,0.2 Q295.5,-1.9 343.4,-0.8 Q391.3,0.3 439.3,-1.9 Q487.2,-4.0 537.7,2.0 Q588.2,8.0 589.2,75.0 Q590.2,142.0 586.7,209.0 Q583.1,276.0 582.8,343.0 Q582.6,410.0 582.7,477.0 Q582.8,544.0 587.8,611.0 Q592.9,678.0 587.9,749.0 Q583.0,820.0 535.1,815.0 Q487.2,810.1 439.3,811.6 Q391.3,813.2 343.4,815.6 Q295.5,817.9 247.6,809.8 Q199.7,801.7 151.8,809.0 Q103.8,816.3 57.2,814.1 Q10.6,812.0 15.1,745.0 Q19.6,678.0 18.9,611.0 Q18.3,544.0 14.0,477.0 Q9.6,410.0 5.2,343.0 Q0.8,276.0 6.9,209.0 Q13.0,142.0 10.5,73.1 Q8.0,4.2 55.9,7.9 Z';

const ROT_DEG = -5;
const CUTOUT: Record<Format, { cx: number; cy: number; scale: number }> = {
  story: { cx: 540, cy: 1055, scale: 1.18 },
  post: { cx: 540, cy: 795, scale: 0.88 },
};

function cutoutTransform(format: Format): string {
  const { cx, cy, scale } = CUTOUT[format];
  return `translate(${cx} ${cy}) rotate(${ROT_DEG}) scale(${scale}) translate(${-BLOB_W / 2} ${-BLOB_H / 2})`;
}

function cutoutBBox(format: Format): { x: number; y: number; w: number; h: number } {
  const { cx, cy, scale } = CUTOUT[format];
  const th = (ROT_DEG * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [[0, 0], [BLOB_W, 0], [BLOB_W, BLOB_H], [0, BLOB_H]]) {
    const tx = (px - BLOB_W / 2) * scale;
    const ty = (py - BLOB_H / 2) * scale;
    xs.push(tx * cos - ty * sin + cx);
    ys.push(tx * sin + ty * cos + cy);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ---- decorative corner ribbons ---------------------------------------------
// Top-left ribbon is identical in both formats; bottom-right differs.
const RIBBON_TL = {
  shadow: 'M0,190 L9.0,189.0 L32.7,160.5 L49.7,162.8 L72.4,141.6 L103.9,125.0 L116.0,88.8 L145.3,82.1 L173.8,71.9 L202.4,47.5 L225.1,28.2 L239.0,9.0 L0,0 Z',
  cream: 'M0,189 L9.0,189.0 L32.7,160.5 L49.7,162.8 L72.4,141.6 L103.9,125.0 L116.0,88.8 L145.3,82.1 L173.8,71.9 L202.4,47.5 L225.1,28.2 L239.0,9.0 L0,0 Z',
  blue: 'M0,180 L0.0,180.0 L23.7,151.5 L40.7,153.8 L63.4,132.6 L94.9,116.0 L107.0,79.8 L136.3,73.1 L164.8,62.9 L193.4,38.5 L216.1,19.2 L230.0,0.0 L0,0 Z',
};
const RIBBON_BR: Record<Format, { shadow: string; cream: string; blue: string }> = {
  story: {
    shadow: 'M730,1920 L731.0,1911.0 L759.4,1904.8 L784.0,1879.9 L812.6,1849.0 L839.8,1835.6 L878.3,1806.3 L896.7,1770.2 L927.8,1773.7 L958.8,1733.9 L997.2,1727.2 L1003.7,1686.8 L1032.0,1672.0 L1071.0,1651.0 L1080,1920 Z',
    cream: 'M731,1920 L731.0,1911.0 L759.4,1904.8 L784.0,1879.9 L812.6,1849.0 L839.8,1835.6 L878.3,1806.3 L896.7,1770.2 L927.8,1773.7 L958.8,1733.9 L997.2,1727.2 L1003.7,1686.8 L1032.0,1672.0 L1071.0,1651.0 L1080,1920 Z',
    blue: 'M740,1920 L740.0,1920.0 L768.4,1913.8 L793.0,1888.9 L821.6,1858.0 L848.8,1844.6 L887.3,1815.3 L905.7,1779.2 L936.8,1782.7 L967.8,1742.9 L1006.2,1736.2 L1012.7,1695.8 L1041.0,1681.0 L1080.0,1660.0 L1080,1920 Z',
  },
  post: {
    shadow: 'M770,1350 L771.0,1341.0 L796.0,1339.4 L817.5,1318.6 L842.8,1291.6 L866.7,1282.6 L901.3,1257.2 L917.0,1224.8 L944.6,1233.4 L972.1,1197.1 L1006.5,1195.0 L1010.9,1158.2 L1035.9,1147.8 L1071.0,1131.0 L1080,1350 Z',
    cream: 'M771,1350 L771.0,1341.0 L796.0,1339.4 L817.5,1318.6 L842.8,1291.6 L866.7,1282.6 L901.3,1257.2 L917.0,1224.8 L944.6,1233.4 L972.1,1197.1 L1006.5,1195.0 L1010.9,1158.2 L1035.9,1147.8 L1071.0,1131.0 L1080,1350 Z',
    blue: 'M780,1350 L780.0,1350.0 L805.0,1348.4 L826.5,1327.6 L851.8,1300.6 L875.7,1291.6 L910.3,1266.2 L926.0,1233.8 L953.6,1242.4 L981.1,1206.1 L1015.5,1204.0 L1019.9,1167.2 L1044.9,1156.8 L1080.0,1140.0 L1080,1350 Z',
  },
};

// ---- per-format layout (all numbers transcribed from the design source) -----
type Layout = {
  w: number;
  h: number;
  topFadeH: number;
  botFadeY: number;
  botFadeH: number;
  titleSizeBase: number;
  titleY: number;
  arrow: string;
  arrowHead: string;
  pin: { x: number; y: number; s: number };
  route: { x: number; y: number; size: number };
  plane: { x: number; y: number; size: number };
  cal: { x: number; y: number; s: number };
  date: { monthX: number; y: number; monthSize: number; chipY: number; chipH: number; chipSize: number; restSize: number };
  facts: { x: number; y: number; size: number };
  dist: { x: number; y: number; w: number; h: number; rx: number; size: number };
  cta: { x: number; y: number; w: number; h: number; rx: number; size: number };
  footer: {
    planeX: number; planeY: number; planeSize: number;
    x: number; brandY: number; brandSize: number; brandLetter: number;
    oneLine: boolean; taglineY: number; taglineSize: number;
    siteX: number; siteY: number; siteSize: number;
  };
  qr: { box: number; x: number; y: number; rx: number; inset: number };
};

const LAYOUTS: Record<Format, Layout> = {
  story: {
    w: 1080, h: 1920, topFadeH: 440, botFadeY: 1500, botFadeH: 420,
    titleSizeBase: 128, titleY: 205,
    arrow: 'M120,120 C80,150 78,215 128,252 C160,276 200,282 232,278',
    arrowHead: 'M232,278 L200,258 L212,288 Z',
    pin: { x: 300, y: 318, s: 1.1 },
    route: { x: 330, y: 312, size: 36 },
    plane: { x: 936, y: 86, size: 70 },
    cal: { x: 84, y: 404, s: 1 },
    date: { monthX: 150, y: 438, monthSize: 36, chipY: 404, chipH: 46, chipSize: 34, restSize: 34 },
    facts: { x: 84, y: 502, size: 28 },
    dist: { x: 150, y: 1408, w: 360, h: 66, rx: 30, size: 32 },
    cta: { x: 330, y: 1520, w: 420, h: 64, rx: 30, size: 44 },
    footer: {
      planeX: 80, planeY: 1680, planeSize: 64,
      x: 162, brandY: 1706, brandSize: 34, brandLetter: 2,
      oneLine: false, taglineY: 1742, taglineSize: 24,
      siteX: 80, siteY: 1806, siteSize: 24,
    },
    qr: { box: 120, x: 884, y: 1676, rx: 16, inset: 14 },
  },
  post: {
    w: 1080, h: 1350, topFadeH: 360, botFadeY: 990, botFadeH: 360,
    titleSizeBase: 106, titleY: 180,
    arrow: 'M118,100 C86,124 84,176 124,206 C150,226 182,231 208,228',
    arrowHead: 'M208,228 L180,211 L190,237 Z',
    pin: { x: 306, y: 268, s: 1 },
    route: { x: 336, y: 262, size: 33 },
    plane: { x: 940, y: 64, size: 64 },
    cal: { x: 84, y: 330, s: 0.95 },
    date: { monthX: 148, y: 362, monthSize: 33, chipY: 330, chipH: 44, chipSize: 32, restSize: 32 },
    facts: { x: 84, y: 422, size: 26 },
    dist: { x: 150, y: 1102, w: 340, h: 62, rx: 28, size: 30 },
    cta: { x: 340, y: 1186, w: 400, h: 60, rx: 28, size: 42 },
    footer: {
      planeX: 80, planeY: 1252, planeSize: 56,
      x: 152, brandY: 1278, brandSize: 28, brandLetter: 1,
      oneLine: true, taglineY: 0, taglineSize: 0,
      siteX: 152, siteY: 1312, siteSize: 22,
    },
    qr: { box: 102, x: 904, y: 1228, rx: 14, inset: 12 },
  },
};

export function mapSize(format: Format): { w: number; h: number } {
  const b = cutoutBBox(format);
  return { w: Math.round(b.w), h: Math.round(b.h) };
}

export function cardSize(format: Format): { w: number; h: number } {
  return { w: LAYOUTS[format].w, h: LAYOUTS[format].h };
}

export function mapSlot(format: Format): { x: number; y: number; w: number; h: number } {
  const b = cutoutBBox(format);
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
}

// ---- helpers ----------------------------------------------------------------
function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
}

/** Rough text advance (px). Montserrat caps ≈ 0.6·size; Caveat ≈ 0.42·size. */
function advance(text: string, size: number, factor = 0.6): number {
  return text.length * size * factor;
}

type TextOpts = { anchor?: 'start' | 'middle' | 'end'; ls?: number; weight?: number; opacity?: number };

/** A text element (no shadow). */
function textEl(x: number, y: number, font: string, size: number, fill: string, text: string, o: TextOpts = {}): string {
  const a = o.anchor ? ` text-anchor="${o.anchor}"` : '';
  const ls = o.ls ? ` letter-spacing="${o.ls}"` : '';
  const op = o.opacity != null ? ` opacity="${o.opacity}"` : '';
  return `<text x="${x}" y="${y}" font-family="${font}" font-weight="${o.weight ?? 700}" font-size="${size}" fill="${fill}"${a}${ls}${op}>${escapeXml(text)}</text>`;
}

/** Shadowed white text: a dark copy offset down/right, then the white text. The
 *  shadow is a plain offset (NOT a gaussian blur) - blur filters are what pushed
 *  the edge resvg render over its CPU limit (HTTP 546); a hard offset reads the
 *  same for legibility over the photo and is essentially free. */
function label(x: number, y: number, font: string, size: number, text: string, o: TextOpts = {}): string {
  const shadow = textEl(x + 1, y + 3, font, size, '#14161A', text, { ...o, opacity: 0.55 });
  return shadow + textEl(x, y, font, size, '#fff', text, o);
}

// ---- render -----------------------------------------------------------------
export function buildCardSvg(
  format: Format,
  data: CardData,
  bgDataUri: string,
  mapDataUri: string | null,
  qrUrl: string,
  overlay = false,
): string {
  const L = LAYOUTS[format];
  const { w: W, h: H } = L;
  const B = cutoutBBox(format);
  const xf = cutoutTransform(format);

  // Background photo + top/bottom fades. In overlay mode the whole thing is
  // masked so the blob hole is transparent (live map shows through).
  const bgFill = `<image href="${bgDataUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` +
    `<rect x="0" y="0" width="${W}" height="${L.topFadeH}" fill="url(#topfade)"/>` +
    `<rect x="0" y="${L.botFadeY}" width="${W}" height="${L.botFadeH}" fill="url(#botfade)"/>`;
  const bg = overlay ? `<g mask="url(#slothole)">${bgFill}</g>` : bgFill;

  // Corner ribbons (shadow + cream + blue), then the map frame. Shadows are the
  // ribbon's own offset dark path (no blur - see label()).
  const br = RIBBON_BR[format];
  const ribbons =
    `<path d="${RIBBON_TL.shadow}" fill="#000" opacity="0.3"/>` +
    `<path d="${RIBBON_TL.cream}" fill="#F5EFE2"/><path d="${RIBBON_TL.blue}" fill="#2267E2"/>` +
    `<path d="${br.shadow}" fill="#000" opacity="0.3"/>` +
    `<path d="${br.cream}" fill="#F5EFE2"/><path d="${br.blue}" fill="#2267E2"/>`;

  // Map: drop-shadow blob (offset, no blur), then the map (baked, blob-clipped)
  // or nothing (overlay - live map shows through the hole), then white border.
  const blobShadow = `<g transform="${xf}"><path d="${BLOB_D}" fill="#000" opacity="0.28" transform="translate(10,16)"/></g>`;
  const mapImg = overlay
    ? ''
    : (mapDataUri
      ? `<image href="${mapDataUri}" x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#mapclip)"/>`
      : `<rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" fill="#dbe6ef" clip-path="url(#mapclip)"/>`);
  const blobBorder = `<path d="${BLOB_D}" transform="${xf}" fill="none" stroke="#FFFFFF" stroke-width="15" stroke-linejoin="round"/>`;

  // Title (shadow + white, tilted). Shrinks when long so it never overflows.
  const tSize = Math.min(L.titleSizeBase, Math.round((W - 140) / (advance(data.title, 1, 0.5) || 1)));
  const rot = (y: number) => `transform="rotate(-2 ${W / 2} ${y})"`;
  const title =
    `<text x="${W / 2 + 1}" y="${L.titleY + 3}" font-family="Caveat" font-weight="700" font-size="${tSize}" fill="#14161A" text-anchor="middle" opacity="0.5" ${rot(L.titleY + 3)}>${escapeXml(data.title)}</text>` +
    `<text x="${W / 2}" y="${L.titleY}" font-family="Caveat" font-weight="700" font-size="${tSize}" fill="#fff" text-anchor="middle" ${rot(L.titleY)}>${escapeXml(data.title)}</text>`;

  // Hand-drawn arrow (offset shadow + white) + arrowhead.
  const arrow =
    `<path d="${L.arrow}" stroke="#14161A" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.5" transform="translate(2,4)"/>` +
    `<path d="${L.arrow}" stroke="#FFFFFF" stroke-width="9" fill="none" stroke-linecap="round"/>` +
    `<path d="${L.arrowHead}" fill="#FFFFFF"/>`;

  // Location pin icon + route text.
  const pin =
    `<g transform="translate(${L.pin.x},${L.pin.y}) scale(${L.pin.s})" stroke="#FFFFFF" stroke-width="3.4" fill="none">` +
    `<path d="M0,0 C-8,-10 -13,-17 -13,-25 a13,13 0 1 1 26,0 C13,-17 8,-10 0,0 Z"/><circle cx="0" cy="-24" r="5"/></g>`;
  const route = label(L.route.x, L.route.y, 'Montserrat', L.route.size, data.route, { weight: 600 });
  const plane = `<image x="${L.plane.x}" y="${L.plane.y}" width="${L.plane.size}" height="${L.plane.size}" href="${PLANE_DATA_URI}"/>`;

  // Calendar icon.
  const cal =
    `<g transform="translate(${L.cal.x},${L.cal.y}) scale(${L.cal.s})" stroke="#FFFFFF" stroke-width="3.4" fill="none" stroke-linecap="round">` +
    '<rect x="0" y="4" width="40" height="36" rx="6"/><line x1="0" y1="16" x2="40" y2="16"/>' +
    '<line x1="10" y1="0" x2="10" y2="8"/><line x1="30" y1="0" x2="30" y2="8"/>' +
    '<line x1="8" y1="24" x2="14" y2="24"/><line x1="18" y1="24" x2="24" y2="24"/><line x1="28" y1="24" x2="34" y2="24"/>' +
    '<line x1="8" y1="32" x2="14" y2="32"/><line x1="18" y1="32" x2="24" y2="32"/></g>';

  // Date row: month + yellow day-chip + rest. Chip x/width and rest x flow from
  // the month/day advances so other dates don't overlap.
  const d = L.date;
  const chipX = Math.round(d.monthX + advance(data.dateMonth, d.monthSize, 0.62) + 12);
  const chipW = Math.round(advance(data.dateDay, d.chipSize, 0.62) + d.chipSize * 0.6);
  const restX = chipX + chipW + 20;
  const dateRow =
    label(d.monthX, d.y, 'Montserrat', d.monthSize, data.dateMonth, { weight: 800, ls: 1 }) +
    `<rect x="${chipX}" y="${d.chipY}" width="${chipW}" height="${d.chipH}" rx="10" fill="#F2C233"/>` +
    textEl(chipX + chipW / 2, d.y, 'Montserrat', d.chipSize, '#22252A', data.dateDay, { weight: 800, anchor: 'middle' }) +
    label(restX, d.y, 'Montserrat', d.restSize, data.dateRest, { weight: 700 });

  const facts = label(L.facts.x, L.facts.y, 'Montserrat', L.facts.size, data.facts, { weight: 600 });

  // Distance pill (pointer + shadow + white + text). Widen for long distances.
  const distText = `${data.distanceStr} ${data.distanceLabel}`;
  const distW = Math.max(L.dist.w, Math.round(advance(distText, L.dist.size, 0.58) + 64));
  const dp = L.dist;
  const distPill =
    `<rect x="${dp.x + 3}" y="${dp.y + 5}" width="${distW}" height="${dp.h}" rx="${dp.rx}" fill="#14161A" opacity="0.28"/>` +
    `<path d="M${dp.x + 60},${dp.y} L${dp.x + 88},${dp.y - 26} L${dp.x + 108},${dp.y} Z" fill="#FFFFFF"/>` +
    `<rect x="${dp.x}" y="${dp.y}" width="${distW}" height="${dp.h}" rx="${dp.rx}" fill="#FFFFFF"/>` +
    textEl(dp.x + distW / 2, dp.y + dp.h / 2 + dp.size * 0.36, 'Montserrat', dp.size, '#22252A', distText, { weight: 700, anchor: 'middle' });

  // CTA pill (shadow + white + handwritten text). Widen for long copy.
  const cp = L.cta;
  const ctaW = Math.max(cp.w, Math.round(advance(data.cta, cp.size, 0.42) + 60));
  const ctaX = Math.min(cp.x, W - 40 - ctaW); // keep it on-canvas if widened
  const ctaPill =
    `<rect x="${ctaX + 3}" y="${cp.y + 5}" width="${ctaW}" height="${cp.h}" rx="${cp.rx}" fill="#14161A" opacity="0.28"/>` +
    `<rect x="${ctaX}" y="${cp.y}" width="${ctaW}" height="${cp.h}" rx="${cp.rx}" fill="#FFFFFF"/>` +
    textEl(ctaX + ctaW / 2, cp.y + cp.h / 2 + cp.size * 0.34, 'Caveat', cp.size, '#22252A', data.cta, { weight: 700, anchor: 'middle' });

  // Footer: plane + brand (+ tagline) + site line. Post packs brand+tagline on
  // one line; story stacks them.
  const f = L.footer;
  const footerPlane = `<image x="${f.planeX}" y="${f.planeY}" width="${f.planeSize}" height="${f.planeSize}" href="${PLANE_DATA_URI}"/>`;
  const brandText = f.oneLine ? `${data.brand} - ${data.tagline}` : data.brand;
  const footer =
    footerPlane +
    label(f.x, f.brandY, 'Rubik', f.brandSize, brandText, { weight: 800, ls: f.brandLetter }) +
    (f.oneLine ? '' : label(f.x, f.taglineY, 'Montserrat', f.taglineSize, data.tagline, { weight: 600 })) +
    label(f.siteX, f.siteY, 'Montserrat', f.siteSize, `${data.site} · ${data.promo}`, { weight: 600 });

  // QR: white rounded box + QR modules inset.
  const q = L.qr;
  const qr =
    `<rect x="${q.x}" y="${q.y}" width="${q.box}" height="${q.box}" rx="${q.rx}" fill="#FFFFFF"/>` +
    qrSvg(qrUrl, q.x + q.inset, q.y + q.inset, q.box - q.inset * 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
 <linearGradient id="topfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101820" stop-opacity="0.45"/><stop offset="1" stop-color="#101820" stop-opacity="0"/></linearGradient>
 <linearGradient id="botfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101820" stop-opacity="0"/><stop offset="1" stop-color="#101820" stop-opacity="0.5"/></linearGradient>
 <clipPath id="mapclip"><path d="${BLOB_D}" transform="${xf}"/></clipPath>
 <mask id="slothole"><rect x="0" y="0" width="${W}" height="${H}" fill="white"/><path d="${BLOB_D}" transform="${xf}" fill="black"/></mask>
</defs>
${bg}
${ribbons}
${title}
${arrow}
${pin}
${route}
${plane}
${cal}
${dateRow}
${facts}
${blobShadow}
${mapImg}
${blobBorder}
${distPill}
${ctaPill}
${footer}
${qr}
</svg>`;
}
