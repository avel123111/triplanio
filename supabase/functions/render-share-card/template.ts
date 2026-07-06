/**
 * Share-card SVG template (TRIP-193). PLACEHOLDER design — the final layout
 * (build_journey.js) will be ported in later; this is a clean, working
 * approximation so the flow is testable end to end. Two formats share the same
 * layers; only the canvas + map-sticker geometry differ. Bump TEMPLATE_VERSION
 * on any visual change so the cache invalidates.
 */

import { qrSvg } from './qr.ts';

export const TEMPLATE_VERSION = 'v1-placeholder';

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

type Layout = { w: number; h: number; map: { x: number; y: number; w: number; h: number } };

const LAYOUTS: Record<Format, Layout> = {
  story: { w: 1080, h: 1920, map: { x: 150, y: 470, w: 780, h: 700 } },
  post: { w: 1080, h: 1350, map: { x: 150, y: 430, w: 780, h: 560 } },
};

export function mapSize(format: Format): { w: number; h: number } {
  return { w: LAYOUTS[format].map.w, h: LAYOUTS[format].map.h };
}

/** The card canvas size (single source of truth; index.ts renders to this). */
export function cardSize(format: Format): { w: number; h: number } {
  return { w: LAYOUTS[format].w, h: LAYOUTS[format].h };
}

/** The map "window" rect within the card (where the live map shows through). */
export function mapSlot(format: Format): { x: number; y: number; w: number; h: number; rx: number } {
  return { ...LAYOUTS[format].map, rx: 26 };
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

const PIN =
  '<path d="M0 -13 C7 -13 12 -8 12 -2 C12 6 0 15 0 15 C0 15 -12 6 -12 -2 C-12 -8 -7 -13 0 -13 Z" fill="#e2483d" stroke="#fff" stroke-width="2"/>';

export function buildCardSvg(
  format: Format,
  data: CardData,
  bgDataUri: string,
  mapDataUri: string | null,
  qrUrl: string,
  overlay = false,
): string {
  const L = LAYOUTS[format];
  const { w: W, h: H, map: M } = L;
  const tSize = titleSize(data.title);
  const footY = H - (format === 'story' ? 150 : 130);
  const qrMarkup = qrSvg(qrUrl, W - 260, footY - 80, 150);

  // `overlay` mode renders the frame ONLY: the background is punched through at
  // the map slot (transparent hole) and the sticker is drawn as a border with no
  // fill, so the client can lay this PNG over the live interactive map (which
  // shows through the hole). Normal mode bakes the captured map into the slot.
  const bgFill = `<image href="${bgDataUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` +
    `<rect x="0" y="0" width="${W}" height="${Math.round(H * 0.38)}" fill="url(#top)"/>` +
    `<rect x="0" y="${Math.round(H * 0.62)}" width="${W}" height="${Math.round(H * 0.38)}" fill="url(#bot)"/>`;
  const bg = overlay ? `<g mask="url(#slothole)">${bgFill}</g>` : bgFill;

  const sticker = `<rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" rx="26" fill="${overlay ? 'none' : '#e8edf2'}" stroke="#fff" stroke-width="14"/>`;
  const mapLayer = overlay
    ? ''
    : (mapDataUri
      ? `<image href="${mapDataUri}" x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#mapclip)"/>`
      : `<rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" fill="#dbe6ef" clip-path="url(#mapclip)"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
 <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1e3a" stop-opacity="0.55"/><stop offset="0.42" stop-color="#0b1e3a" stop-opacity="0"/></linearGradient>
 <linearGradient id="bot" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#06122a" stop-opacity="0.64"/><stop offset="0.45" stop-color="#06122a" stop-opacity="0"/></linearGradient>
 <clipPath id="mapclip"><rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" rx="26"/></clipPath>
 <mask id="slothole"><rect x="0" y="0" width="${W}" height="${H}" fill="white"/><rect x="${M.x}" y="${M.y}" width="${M.w}" height="${M.h}" rx="26" fill="black"/></mask>
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
<rect x="${M.x}" y="${M.y + M.h + 22}" width="${Math.max(340, data.distanceStr.length * 26 + 220)}" height="76" rx="38" fill="#fff"/>
<text x="${M.x + 32}" y="${M.y + M.h + 70}" font-family="Montserrat" font-weight="700" font-size="36" fill="#12203a">${escapeXml(data.distanceStr)} ${escapeXml(data.distanceLabel)}</text>
<text x="${W - 60}" y="${M.y + M.h + 82}" text-anchor="end" font-family="Caveat" font-weight="700" font-size="58" fill="#fff">${escapeXml(data.cta)}</text>
<text x="70" y="${footY}" font-family="Rubik" font-weight="800" font-size="52" fill="#fff">${escapeXml(data.brand)}</text>
<text x="70" y="${footY + 46}" font-family="Montserrat" font-weight="400" font-size="28" fill="#dbe6ff">${escapeXml(data.tagline)} · ${escapeXml(data.site)}</text>
${qrMarkup}
</svg>`;
}
