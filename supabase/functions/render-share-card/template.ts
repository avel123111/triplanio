/**
 * Share-card SVG template (TRIP-443) — новый дизайн: прозрачный стикер поверх
 * подложки. Порт раскладки прототипа share-card-prototype-v13 в data-driven SVG.
 *
 * Композиция (сверху вниз): заголовок Geologica + маршрут «город → город» ·
 * полароид (кремовая рамка -2.5°, окно карты, «My trip!» + сердечко) · ряд
 * статистики (km/Days/Cities/Countries) · ряд флагов «Visited Countries» + «+N» ·
 * футер «Plan your own adventure» + лого + вордмарк + «Scan to explore» + QR.
 *
 * Контракт с клиентом (src/lib/map/captureMap.js, ShareCardDialog):
 *  - Карта — axis-aligned `<image>` в bbox окна, обрезанная повёрнутым окном
 *    (clip). Плейсхолдер `__SHARE_CARD_MAP__` в card_svg; в overlay окно —
 *    прозрачная дыра (маска), сквозь неё видно живую карту. `mapSlot()` = bbox
 *    окна (axis-aligned), клиент кладёт карту туда. Так превью == финал.
 *  - Фон — full-bleed `<image href="__SHARE_CARD_BG__">` в самом низу; клиент
 *    подменяет токен на выбранную подложку ЛИБО удаляет элемент (прозрачно) —
 *    см. src/lib/shareCardBg.js. В overlay фон маскируется дырой окна.
 *  - Флаги — `<image href="__SC_FLAG_<cc>__">` в круге; клиент инлайнит
 *    /flags/<cc>.svg в data-URI (нет доступа к public/ в рантайме edge).
 *
 * Палитра/шрифты/скругления фиксированы (часть дизайна). Правило проекта: дефис
 * "-", не длинное тире.
 */

import { qrSvg } from './qr.ts';
import { LOGO_SVG_B64 } from './assets_b64.ts';
import { FLAGS_B64 } from './flags_b64.ts';

const LOGO_URI = `data:image/svg+xml;base64,${LOGO_SVG_B64}`;
const flagUri = (cc: string) => (FLAGS_B64[cc] ? `data:image/svg+xml;base64,${FLAGS_B64[cc]}` : '');

export type Format = 'story' | 'post';

// Данные карточки собирает index.ts и передаёт литералом; тип живёт для сигнатуры
// buildCardSvg, наружу не экспортируется (никто не импортирует).
type CardData = {
  title: string;
  from: string; // первый город маршрута
  to: string; // последний город (пусто/равен from ⇒ маршрут без стрелки)
  distanceStr: string; // "10 741"
  days: string; // "51"
  cities: string; // "7"
  countries: string; // "15"
  flags: string[]; // ISO2-коды стран по порядку маршрута (нижний регистр)
  // Локализованные подписи (пекутся сервером, см. _shared/shareCardText.ts).
  kmLabel: string;
  daysLabel: string;
  citiesLabel: string;
  countriesLabel: string;
  visitedLabel: string; // "Visited Countries" (может быть в 2 строки по \n)
  planLine1: string; // "Plan your"
  planLine2: string; // "own adventure"
  scanLine1: string; // "Scan to"
  scanLine2: string; // "explore"
  myTrip: string; // "My trip!"
  brand: string; // "TRIPLANIO"
};

// Токены, которые подменяет клиент. Только MAP_TOKEN нужен снаружи (index.ts →
// card_svg); BG_TOKEN клиент знает по своей копии строки (Deno-модуль во фронт не
// импортируется). Флаги встроены на edge (FLAGS_B64), клиентского токена нет.
export const MAP_TOKEN = '__SHARE_CARD_MAP__';
const BG_TOKEN = '__SHARE_CARD_BG__';

// Палитра (из прототипа).
const C = {
  navy: '#11304E',
  navyDeep: '#0E2740',
  gold: '#B08D50',
  cream: '#F3ECDD',
  script: '#3E6FB6',
  white: '#FFFFFF',
  footBg: 'rgba(255,255,255,0.72)',
  flagBg: 'rgba(14,30,50,0.62)',
  divider: 'rgba(70,80,95,0.35)',
  numShadow: 'rgba(10,18,30,0.45)',
};

const FONT = "'Geologica'";
const SCRIPT_FONT = "'Caveat'";
const POLA_ROT = -2.5;

// ---- per-format geometry (числа транскрибированы из прототипа v13) -----------
type Layout = {
  w: number;
  h: number;
  padX: number;
  titleAlign: 'center' | 'left';
  titleLeft: number; // используется при titleAlign==='left'
  titleTop: number; // baseline первой строки
  titleSize: number;
  routeGap: number; // от низа заголовка до baseline маршрута
  routeSize: number;
  pola: { top: number; width: number; padT: number; padX: number; padB: number; winH: number };
  capSize: number;
  stats: { y: number; numSize: number; labSize: number; cellPad: number };
  flags: { y: number; h: number; labSize: number; circle: number; ring: number; gap: number; moreSize: number };
  footer: {
    y: number; h: number; padX: number;
    ctaSize: number; ctaLead: number; brandSize: number; brandGap: number; logo: number;
    scanSize: number; qr: number; qrInset: number;
  };
};

const LAYOUTS: Record<Format, Layout> = {
  story: {
    w: 1080, h: 1920, padX: 66,
    titleAlign: 'center', titleLeft: 0, titleTop: 250, titleSize: 132,
    routeGap: 74, routeSize: 56,
    pola: { top: 588, width: 860, padT: 32, padX: 32, padB: 24, winH: 600 },
    capSize: 52,
    stats: { y: 1416, numSize: 58, labSize: 26, cellPad: 30 },
    flags: { y: 1524, h: 112, labSize: 26, circle: 58, ring: 3, gap: 12, moreSize: 24 },
    footer: {
      y: 1672, h: 176, padX: 40,
      ctaSize: 46, ctaLead: 52, brandSize: 32, brandGap: 12, logo: 50,
      scanSize: 40, qr: 146, qrInset: 12,
    },
  },
  post: {
    w: 1080, h: 1350, padX: 60,
    titleAlign: 'left', titleLeft: 84, titleTop: 196, titleSize: 96,
    routeGap: 66, routeSize: 50,
    pola: { top: 356, width: 912, padT: 22, padX: 22, padB: 22, winH: 432 },
    capSize: 50,
    stats: { y: 968, numSize: 56, labSize: 26, cellPad: 26 },
    flags: { y: 1044, h: 104, labSize: 26, circle: 56, ring: 3, gap: 10, moreSize: 24 },
    footer: {
      y: 1156, h: 168, padX: 34,
      ctaSize: 38, ctaLead: 44, brandSize: 28, brandGap: 10, logo: 44,
      scanSize: 40, qr: 120, qrInset: 10,
    },
  },
};

export function cardSize(format: Format): { w: number; h: number } {
  return { w: LAYOUTS[format].w, h: LAYOUTS[format].h };
}

// ---- helpers ----------------------------------------------------------------
function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
}

/** Грубый advance (px). Geologica ~0.54·size на средних весах; Caveat ~0.42. */
function advance(text: string, size: number, factor = 0.54): number {
  return text.length * size * factor;
}

type TextOpts = { anchor?: 'start' | 'middle' | 'end'; weight?: number; ls?: number; font?: string; fill?: string };
function text(x: number, y: number, size: number, t: string, o: TextOpts = {}): string {
  const a = o.anchor ? ` text-anchor="${o.anchor}"` : '';
  const ls = o.ls ? ` letter-spacing="${o.ls}"` : '';
  return `<text x="${x}" y="${y}" font-family="${o.font || FONT}" font-weight="${o.weight ?? 700}" `
    + `font-size="${size}" fill="${o.fill || C.navy}"${a}${ls}>${escapeXml(t)}</text>`;
}

/** Белая цифра с мягкой тенью (читается на тёмной подложке/карте) — плоский
 *  offset, без blur. */
function numText(x: number, y: number, size: number, t: string, anchor: 'start' | 'middle' | 'end'): string {
  return `<text x="${x + 1}" y="${y + 2}" font-family="${FONT}" font-weight="700" font-size="${size}" `
    + `fill="${C.numShadow}" text-anchor="${anchor}" font-variant-numeric="tabular-nums" letter-spacing="-1">${escapeXml(t)}</text>`
    + `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="700" font-size="${size}" `
    + `fill="${C.white}" text-anchor="${anchor}" font-variant-numeric="tabular-nums" letter-spacing="-1">${escapeXml(t)}</text>`;
}

/** Заголовок в ≤2 строки с усадкой кегля. Жадный перенос по словам; кегль
 *  уменьшается, пока не влезет по ширине и в 2 строки. */
function wrapTitle(title: string, maxW: number, base: number): { lines: string[]; size: number } {
  const words = title.trim().split(/\s+/).filter(Boolean);
  for (let size = base; size >= base * 0.55; size -= 4) {
    const lines: string[] = [];
    let cur = '';
    for (const wd of words) {
      const cand = cur ? `${cur} ${wd}` : wd;
      if (advance(cand, size, 0.56) <= maxW || !cur) cur = cand;
      else { lines.push(cur); cur = wd; }
    }
    if (cur) lines.push(cur);
    if (lines.length <= 2 && lines.every((l) => advance(l, size, 0.56) <= maxW)) {
      return { lines: lines.slice(0, 2), size };
    }
  }
  // Крайний случай (одно очень длинное слово): в 2 строки на минимальном кегле.
  const size = Math.round(base * 0.55);
  return { lines: [title], size };
}

// Повернуть точку вокруг центра.
function rot(px: number, py: number, cx: number, cy: number, deg: number): [number, number] {
  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const dx = px - cx;
  const dy = py - cy;
  return [dx * c - dy * s + cx, dx * s + dy * c + cy];
}

// Геометрия окна карты (до поворота) + центр полароида + bbox повёрнутого окна.
function windowGeom(format: Format) {
  const L = LAYOUTS[format];
  const p = L.pola;
  const polaX = (L.w - p.width) / 2;
  const winX = polaX + p.padX;
  const winY = p.top + p.padT;
  const winW = p.width - p.padX * 2;
  const winH = p.winH;
  // Высота всей рамки: окно + подпись + нижний паддинг.
  const capBlock = Math.round(L.capSize * 1.1) + 18;
  const polaH = p.padT + winH + capBlock + p.padB;
  const cx = polaX + p.width / 2;
  const cy = p.top + polaH / 2;
  return { L, polaX, polaY: p.top, polaW: p.width, polaH, winX, winY, winW, winH, cx, cy };
}

export function mapSlot(format: Format): { x: number; y: number; w: number; h: number } {
  const g = windowGeom(format);
  const corners: Array<[number, number]> = [
    [g.winX, g.winY], [g.winX + g.winW, g.winY],
    [g.winX + g.winW, g.winY + g.winH], [g.winX, g.winY + g.winH],
  ].map(([x, y]) => rot(x, y, g.cx, g.cy, POLA_ROT));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(...xs) - x), h: Math.round(Math.max(...ys) - y) };
}

// ---- render -----------------------------------------------------------------
export function buildCardSvg(
  format: Format,
  data: CardData,
  mapDataUri: string | null,
  qrUrl: string,
  overlay = false,
  fontCss = '',
): string {
  const g = windowGeom(format);
  const L = g.L;
  const { w: W, h: H } = L;
  const slot = mapSlot(format);
  const polaXf = `rotate(${POLA_ROT} ${g.cx} ${g.cy})`;

  // --- фон: базовый градиент (ВСЕГДА, «Стандарт» = он, не прозрачно) + фото-
  // подложка поверх. Клиент подменяет токен фото на выбранный пресет ЛИБО удаляет
  // <image> (тогда виден градиент). В overlay окно вырезано маской (живая карта).
  const bgBase = `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgGrad)"/>`
    + `<image href="${BG_TOKEN}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`;
  const bg = overlay ? `<g mask="url(#winhole)">${bgBase}</g>` : bgBase;

  // --- заголовок (навы, ≤2 строки с усадкой) ---
  const maxTitleW = L.titleAlign === 'left' ? W - L.titleLeft - L.padX : W - L.padX * 2;
  const { lines, size: tSize } = wrapTitle(data.title, maxTitleW, L.titleSize);
  const lineH = Math.round(tSize * 0.94);
  const titleW = Math.max(...lines.map((l) => advance(l, tSize, 0.56)));
  const titleX = L.titleAlign === 'left' ? L.titleLeft : Math.round((W - titleW) / 2);
  const titleSvg = lines
    .map((l, i) => text(titleX, L.titleTop + i * lineH, tSize, l, { weight: 700, ls: -0.5 }))
    .join('');
  const lastTitleY = L.titleTop + (lines.length - 1) * lineH;

  // --- маршрут «from → to» (стрелка рисуется, глиф → не в сабсете Geologica) ---
  const routeY = lastTitleY + L.routeGap;
  const hasTo = data.to && data.to !== data.from;
  const fromW = advance(data.from, L.routeSize, 0.56);
  const arrowGap = 26;
  const arrowW = 70;
  let routeSvg = text(titleX, routeY, L.routeSize, data.from, { weight: 600, fill: C.navy });
  if (hasTo) {
    const ax = titleX + fromW + arrowGap;
    const ay = routeY - L.routeSize * 0.28;
    routeSvg += `<g stroke="${C.navy}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">`
      + `<line x1="${ax}" y1="${ay}" x2="${ax + arrowW - 12}" y2="${ay}"/>`
      + `<path d="M${ax + arrowW - 20},${ay - 9} L${ax + arrowW},${ay} L${ax + arrowW - 20},${ay + 9}"/></g>`;
    routeSvg += text(ax + arrowW + arrowGap, routeY, L.routeSize, data.to, { weight: 600, fill: C.navy });
  }

  // --- полароид: кремовая рамка с ВЫРЕЗАННЫМ окном (evenodd), карта, подпись ---
  const winPath = roundedRectPath(g.winX, g.winY, g.winW, g.winH, 22);
  const cream = `<path d="${roundedRectPath(g.polaX, g.polaY, g.polaW, g.polaH, 30)} ${winPath}" `
    + `fill="${C.cream}" fill-rule="evenodd" transform="${polaXf}"/>`;
  const creamShadow = `<path d="${roundedRectPath(g.polaX, g.polaY, g.polaW, g.polaH, 30)}" `
    + `fill="#000" opacity="0.22" transform="${polaXf} translate(6,14)"/>`;
  // Карта: axis-aligned image в bbox, обрезка повёрнутым окном. overlay ⇒ дыра.
  const mapImg = overlay
    ? ''
    : (mapDataUri
      ? `<image href="${mapDataUri}" x="${slot.x}" y="${slot.y}" width="${slot.w}" height="${slot.h}" `
        + `preserveAspectRatio="xMidYMid slice" clip-path="url(#winclip)"/>`
      : `<rect x="${slot.x}" y="${slot.y}" width="${slot.w}" height="${slot.h}" fill="#dbe6ef" clip-path="url(#winclip)"/>`);
  // Подпись «My trip!» + сердечко (в кремовой зоне под окном, повёрнуты с рамкой).
  const capY = g.winY + g.winH + Math.round(L.capSize * 0.9);
  const heartX = g.polaX + g.polaW - 58;
  const heartY = g.winY + g.winH + 20;
  const caption = `<g transform="${polaXf}">`
    + text(g.winX + 6, capY, L.capSize, data.myTrip, { font: SCRIPT_FONT, weight: 700, fill: C.script })
    + `<path d="M${heartX},${heartY + 6} c-4,-6 -13,-3 -13,4 c0,6 13,14 13,14 c0,0 13,-8 13,-14 c0,-7 -9,-10 -13,-4 Z" `
    + `fill="none" stroke="${C.script}" stroke-width="2.4"/></g>`;

  // --- ряд статистики (4 ячейки, золотые разделители, белые цифры) ---
  const stats = buildStats(L, data);

  // --- ряд флагов «Visited Countries» + «+N» ---
  const flags = buildFlags(L, data);

  // --- футер ---
  const footer = buildFooter(L, data, qrUrl);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
 ${fontCss}
 <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9c7e6"/><stop offset="0.32" stop-color="#cfe0ec"/><stop offset="0.62" stop-color="#7fa7b3"/><stop offset="1" stop-color="#274b63"/></linearGradient>
 <clipPath id="winclip"><path d="${winPath}" transform="${polaXf}"/></clipPath>
 <mask id="winhole"><rect x="0" y="0" width="${W}" height="${H}" fill="white"/><path d="${winPath}" transform="${polaXf}" fill="black"/></mask>
</defs>
${bg}
${creamShadow}
${cream}
${mapImg}
${caption}
${titleSvg}
${routeSvg}
${stats}
${flags}
${footer}
</svg>`;
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x + rr},${y} h${w - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} `
    + `a${rr},${rr} 0 0 1 ${-rr},${rr} h${-(w - 2 * rr)} a${rr},${rr} 0 0 1 ${-rr},${-rr} `
    + `v${-(h - 2 * rr)} a${rr},${rr} 0 0 1 ${rr},${-rr} Z`;
}

// Ряд статистики: 4 ячейки, центрированы; между ячейками золотой разделитель.
function buildStats(L: Layout, d: CardData): string {
  const cells = [
    { num: d.distanceStr, lab: d.kmLabel },
    { num: d.days, lab: d.daysLabel },
    { num: d.cities, lab: d.citiesLabel },
    { num: d.countries, lab: d.countriesLabel },
  ];
  const s = L.stats;
  const widths = cells.map((c) =>
    Math.max(advance(c.num, s.numSize, 0.6), advance(c.lab, s.labSize, 0.6)) + s.cellPad * 2);
  const total = widths.reduce((a, b) => a + b, 0);
  let x = (L.w - total) / 2;
  const parts: string[] = [];
  cells.forEach((c, i) => {
    const cw = widths[i];
    const cxc = x + cw / 2;
    if (i > 0) {
      parts.push(`<rect x="${Math.round(x)}" y="${s.y - s.numSize + 6}" width="2" height="${s.numSize + 4}" fill="${C.gold}" opacity="0.7"/>`);
    }
    parts.push(numText(cxc, s.y, s.numSize, c.num, 'middle'));
    parts.push(text(cxc, s.y + s.labSize + 6, s.labSize, c.lab, { weight: 500, anchor: 'middle', fill: C.gold }));
    x += cw;
  });
  return parts.join('');
}

// Ряд флагов: плашка + «Visited Countries» + круглые флаги (сколько влезло) + «+N».
function buildFlags(L: Layout, d: CardData): string {
  const f = L.flags;
  const left = L.padX;
  const right = L.w - L.padX;
  const boxW = right - left;
  const cy = f.y + f.h / 2;
  const parts: string[] = [
    `<rect x="${left}" y="${f.y}" width="${boxW}" height="${f.h}" rx="${f.h / 2}" fill="${C.flagBg}"/>`,
  ];
  // Подпись слева (до 2 строк по \n).
  const labX = left + 34;
  const labLines = d.visitedLabel.split('\n');
  const labLead = f.labSize + 4;
  const labY0 = cy - ((labLines.length - 1) * labLead) / 2 + f.labSize * 0.34;
  labLines.forEach((l, i) => parts.push(text(labX, labY0 + i * labLead, f.labSize, l, { weight: 400, fill: C.white })));
  const labW = Math.max(...labLines.map((l) => advance(l, f.labSize, 0.56)));
  // Зона под флаги: от конца подписи до правого края (место под «+N» резервируем).
  const listLeft = labX + labW + 28;
  const chipD = f.circle;
  const rightPad = 26;
  // Сколько кругов влезает, если N > 0 — резервируем место под чип «+N».
  const total = d.flags.length;
  const step = f.circle + f.gap;
  const avail = right - rightPad - listLeft;
  let shown = Math.max(0, Math.min(total, Math.floor((avail + f.gap) / step)));
  const needChip = shown < total;
  if (needChip) {
    const availWithChip = avail - (chipD + f.gap);
    shown = Math.max(0, Math.min(total, Math.floor((availWithChip + f.gap) / step)));
  }
  let fx = listLeft + f.circle / 2;
  for (let i = 0; i < shown; i++) {
    const cc = d.flags[i];
    parts.push(flagCircle(fx, cy, f.circle, f.ring, cc));
    fx += step;
  }
  if (needChip) {
    const more = total - shown;
    const chipX = right - rightPad - chipD / 2;
    parts.push(`<circle cx="${chipX}" cy="${cy}" r="${chipD / 2}" fill="${C.gold}"/>`);
    parts.push(text(chipX, cy + f.moreSize * 0.34, f.moreSize, `+${more}`, { weight: 700, anchor: 'middle', fill: C.navyDeep }));
  }
  return parts.join('');
}

// Круглый флаг: белое кольцо + флаг (встроен на edge), обрезанный кругом. Нет
// флага для кода ⇒ только белый круг (не битая картинка).
function flagCircle(cx: number, cy: number, d: number, ring: number, cc: string): string {
  const r = d / 2;
  const uri = flagUri(cc);
  const ring0 = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.white}"/>`;
  if (!uri) return ring0;
  const id = `fl-${cc}-${Math.round(cx)}`;
  return ring0
    + `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r - ring}"/></clipPath>`
    + `<image href="${uri}" x="${cx - r}" y="${cy - r}" width="${d}" height="${d}" `
    + `preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
}

// Футер: бело-полупрозрачная плашка, серый разделитель по центру; слева CTA+лого,
// справа «Scan to explore» + стрелка + QR.
function buildFooter(L: Layout, d: CardData, qrUrl: string): string {
  const f = L.footer;
  const left = L.padX;
  const right = L.w - L.padX;
  const boxW = right - left;
  const midX = L.w / 2;
  const parts: string[] = [
    `<rect x="${left}" y="${f.y}" width="${boxW}" height="${f.h}" rx="34" fill="${C.footBg}"/>`,
    `<rect x="${midX - 1}" y="${f.y + 24}" width="2" height="${f.h - 48}" fill="${C.divider}"/>`,
  ];
  // Левая колонка: «Plan your / own adventure» + лого + вордмарк.
  const cx0 = left + f.padX;
  const ctaY = f.y + f.padX + f.ctaSize;
  parts.push(text(cx0, ctaY, f.ctaSize, d.planLine1, { weight: 800 }));
  parts.push(text(cx0, ctaY + f.ctaLead, f.ctaSize, d.planLine2, { weight: 800 }));
  const brandY = ctaY + f.ctaLead + f.brandGap + f.logo * 0.5;
  parts.push(`<image href="${LOGO_URI}" x="${cx0}" y="${brandY - f.logo / 2}" width="${f.logo}" height="${f.logo}"/>`);
  parts.push(text(cx0 + f.logo + 12, brandY + f.brandSize * 0.34, f.brandSize, d.brand, { weight: 700, ls: 3 }));

  // Правая колонка: «Scan to / explore» (Caveat) + стрелка + QR у правого края.
  const q = f.qr;
  const qrX = right - f.padX - q;
  const qrY = f.y + (f.h - q) / 2;
  const scanX = midX + 30;
  const scanY0 = f.y + f.h / 2 - f.scanSize * 0.1;
  parts.push(text(scanX, scanY0, f.scanSize, d.scanLine1, { font: SCRIPT_FONT, weight: 700 }));
  parts.push(text(scanX, scanY0 + f.scanSize * 0.9, f.scanSize, d.scanLine2, { font: SCRIPT_FONT, weight: 700 }));
  // Стрелка между текстом и QR (синяя, вверх-вправо).
  const arX = qrX - 76;
  const arY = f.y + f.h / 2;
  parts.push(`<g stroke="${C.navy}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="M${arX},${arY + 14} C${arX + 26},${arY + 20} ${arX + 44},${arY} ${arX + 52},${arY - 24}"/>`
    + `<path d="M${arX + 44},${arY - 22} L${arX + 52},${arY - 26} L${arX + 54},${arY - 12}"/></g>`);
  // QR: белый бокс + модули.
  parts.push(`<rect x="${qrX}" y="${qrY}" width="${q}" height="${q}" rx="16" fill="${C.white}"/>`);
  parts.push(qrSvg(qrUrl, qrX + f.qrInset, qrY + f.qrInset, q - f.qrInset * 2));
  return parts.join('');
}
