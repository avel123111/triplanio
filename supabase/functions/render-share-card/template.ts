/**
 * Share-card SVG template (TRIP-193).
 *
 * The map "window" is a CUSTOM CUTOUT (not a plain rectangle): the frame owns an
 * arbitrary shape — here the organic, slightly rotated "blob" from the Journey
 * design — and the map lives behind it, independent of the frame. `overlay` mode
 * punches that exact shape as a transparent hole so the client lays this PNG over
 * the live interactive map (which shows through the hole); `card` mode bakes the
 * captured map into the shape. The cutout's axis-aligned bounding box is exported
 * as the map slot so the client positions the live map to fill the hole.
 *
 * NOTE: decorations (title/date/facts/pills/footer/QR) are still the working
 * placeholder layout — the pixel-perfect Journey port lands next. Bump
 * TEMPLATE_VERSION on any visual change so the cache invalidates.
 */

import { qrSvg } from './qr.ts';

export const TEMPLATE_VERSION = 'v2-blob-cutout';

export type Format = 'story' | 'post';

export type CardData = {
  title: string;
  route: string; // "Париж - Мадрид"
  dateLabel: string;
  facts: string;
  distanceStr: string; // "10 584"
  distanceLabel: string; // "км в пути"
  cta: string;
  tagline: string;
  site: string;
  brand: string;
};

// The map cutout shape (Journey design): an organic blob authored in a 591×820
// box, placed on the card by `transform` (centre + rotate + scale). Both the
// server mask/clip and the exported slot derive from this single source, so the
// hole, the baked map and the client's live-map window always agree.
const BLOB_W = 591;
const BLOB_H = 820;
const BLOB_D =
  'M55.9,7.9 Q103.8,11.7 151.8,7.0 Q199.7,2.3 247.6,0.2 Q295.5,-1.9 343.4,-0.8 Q391.3,0.3 439.3,-1.9 Q487.2,-4.0 537.7,2.0 Q588.2,8.0 589.2,75.0 Q590.2,142.0 586.7,209.0 Q583.1,276.0 582.8,343.0 Q582.6,410.0 582.7,477.0 Q582.8,544.0 587.8,611.0 Q592.9,678.0 587.9,749.0 Q583.0,820.0 535.1,815.0 Q487.2,810.1 439.3,811.6 Q391.3,813.2 343.4,815.6 Q295.5,817.9 247.6,809.8 Q199.7,801.7 151.8,809.0 Q103.8,816.3 57.2,814.1 Q10.6,812.0 15.1,745.0 Q19.6,678.0 18.9,611.0 Q18.3,544.0 14.0,477.0 Q9.6,410.0 5.2,343.0 Q0.8,276.0 6.9,209.0 Q13.0,142.0 10.5,73.1 Q8.0,4.2 55.9,7.9 Z';

// Per-format placement of the blob (centre cx,cy + uniform scale, rotated -5°).
const CUTOUT: Record<Format, { cx: number; cy: number; scale: number }> = {
  story: { cx: 540, cy: 1055, scale: 1.18 },
  post: { cx: 540, cy: 795, scale: 0.88 },
};
const ROT_DEG = -5;

/** SVG transform placing the blob on the card (matches the mask/clip + border). */
function cutoutTransform(format: Format): string {
  const { cx, cy, scale } = CUTOUT[format];
  return `translate(${cx} ${cy}) rotate(${ROT_DEG}) scale(${scale}) translate(${-BLOB_W / 2} ${-BLOB_H / 2})`;
}

/** Axis-aligned bounding box of the placed (rotated+scaled) blob, in card coords.
 *  The rotation expands the AABB past the blob, so a rectangle filling this box
 *  always covers the whole hole (any overflow is hidden by the opaque frame). */
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

type Layout = { w: number; h: number };

const LAYOUTS: Record<Format, Layout> = {
  story: { w: 1080, h: 1920 },
  post: { w: 1080, h: 1350 },
};

export function mapSize(format: Format): { w: number; h: number } {
  const b = cutoutBBox(format);
  return { w: Math.round(b.w), h: Math.round(b.h) };
}

/** The card canvas size (single source of truth; index.ts renders to this). */
export function cardSize(format: Format): { w: number; h: number } {
  return { w: LAYOUTS[format].w, h: LAYOUTS[format].h };
}

/** The map "window" rect within the card (bbox of the cutout shape) — where the
 *  live map shows through. The shape itself is the blob; the client fills this
 *  box and the frame's transparent hole reveals only the blob. */
export function mapSlot(format: Format): { x: number; y: number; w: number; h: number } {
  const b = cutoutBBox(format);
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
}

/** Shrink the title font when it is long, so it never overflows the canvas. */
function titleSize(title: string): number {
  const len = title.length;
  if (len <= 14) return 150;
  if (len <= 20) return 120;
  if (len <= 28) return 96;
  return 76;
}

export function buildCardSvg(
  format: Format,
  data: CardData,
  bgDataUri: string,
  mapDataUri: string | null,
  qrUrl: string,
  overlay = false,
): string {
  const { w: W, h: H } = LAYOUTS[format];
  const B = cutoutBBox(format);
  const xf = cutoutTransform(format);
  const tSize = titleSize(data.title);
  const footY = H - (format === 'story' ? 150 : 130);
  const qrMarkup = qrSvg(qrUrl, W - 260, footY - 80, 150);
  // Anchor the map-relative pills just below the cutout bbox.
  const pillY = Math.round(B.y + B.h + 22);

  // `overlay` mode renders the frame ONLY: the background is punched through at
  // the cutout shape (transparent hole) and the blob is drawn as a border with no
  // fill, so the client can lay this PNG over the live interactive map (which
  // shows through the hole). Normal mode bakes the captured map into the shape.
  const bgFill = `<image href="${bgDataUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` +
    `<rect x="0" y="0" width="${W}" height="${Math.round(H * 0.38)}" fill="url(#top)"/>` +
    `<rect x="0" y="${Math.round(H * 0.62)}" width="${W}" height="${Math.round(H * 0.38)}" fill="url(#bot)"/>`;
  const bg = overlay ? `<g mask="url(#slothole)">${bgFill}</g>` : bgFill;

  const sticker = `<path d="${BLOB_D}" transform="${xf}" fill="${overlay ? 'none' : '#e8edf2'}" stroke="#fff" stroke-width="15" stroke-linejoin="round"/>`;
  const mapLayer = overlay
    ? ''
    : (mapDataUri
      ? `<image href="${mapDataUri}" x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#mapclip)"/>`
      : `<rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" fill="#dbe6ef" clip-path="url(#mapclip)"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
 <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1e3a" stop-opacity="0.55"/><stop offset="0.42" stop-color="#0b1e3a" stop-opacity="0"/></linearGradient>
 <linearGradient id="bot" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#06122a" stop-opacity="0.64"/><stop offset="0.45" stop-color="#06122a" stop-opacity="0"/></linearGradient>
 <clipPath id="mapclip"><path d="${BLOB_D}" transform="${xf}"/></clipPath>
 <mask id="slothole"><rect x="0" y="0" width="${W}" height="${H}" fill="white"/><path d="${BLOB_D}" transform="${xf}" fill="black"/></mask>
</defs>
${bg}
<path d="M0 0 L360 0 L300 46 L150 30 L60 70 L0 54 Z" fill="#2267E2"/>
<path d="M${W} ${H} L${W - 360} ${H} L${W - 300} ${H - 46} L${W - 150} ${H - 30} L${W - 60} ${H - 70} L${W} ${H - 54} Z" fill="#2267E2"/>
<text x="70" y="230" font-family="Caveat" font-weight="700" font-size="${tSize}" fill="#fff">${escapeXml(data.title)}</text>
<text x="74" y="300" font-family="Montserrat" font-weight="700" font-size="40" fill="#fff">${escapeXml(data.route)}</text>
<rect x="70" y="332" width="${Math.max(150, data.dateLabel.length * 20)}" height="54" rx="12" fill="#ffffff" opacity="0.16"/>
<text x="86" y="370" font-family="Montserrat" font-weight="700" font-size="32" fill="#fff">${escapeXml(data.dateLabel)}</text>
<text x="74" y="418" font-family="Montserrat" font-weight="400" font-size="30" fill="#e9eefc">${escapeXml(data.facts)}</text>
${sticker}
${mapLayer}
<rect x="${B.x}" y="${pillY}" width="${Math.max(340, data.distanceStr.length * 26 + 220)}" height="76" rx="38" fill="#fff"/>
<text x="${B.x + 32}" y="${pillY + 48}" font-family="Montserrat" font-weight="700" font-size="36" fill="#12203a">${escapeXml(data.distanceStr)} ${escapeXml(data.distanceLabel)}</text>
<text x="${W - 60}" y="${pillY + 60}" text-anchor="end" font-family="Caveat" font-weight="700" font-size="58" fill="#fff">${escapeXml(data.cta)}</text>
<text x="70" y="${footY}" font-family="Rubik" font-weight="800" font-size="52" fill="#fff">${escapeXml(data.brand)}</text>
<text x="70" y="${footY + 46}" font-family="Montserrat" font-weight="400" font-size="28" fill="#dbe6ff">${escapeXml(data.tagline)} · ${escapeXml(data.site)}</text>
${qrMarkup}
</svg>`;
}
