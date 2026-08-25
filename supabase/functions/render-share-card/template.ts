/**
 * Share-card SVG template (TRIP-443) — новый дизайн: прозрачный стикер поверх
 * подложки. Порт раскладки прототипа share-card-prototype-v24 в data-driven SVG.
 *
 * Композиция (сверху вниз): заголовок Geologica (белый) + маршрут «город → город»
 * (белый) · полароид (кремовая рамка -1.6°, окно карты с внутренней тенью,
 * «My trip!» + сердечко) · ряд статистики (белые цифры + белые подписи,
 * золотые разделители) · ряд флагов «Visited Countries» + «+N» · футер
 * «Plan your own adventure» + лого + вордмарк · «Scan to explore» + дуга + QR.
 *
 * Контракт с клиентом (src/lib/map/captureMap.js, ShareCardDialog):
 *  - Карта — axis-aligned `<image>` в bbox окна, обрезанная повёрнутым окном
 *    (clip). Плейсхолдер `__SHARE_CARD_MAP__` в card_svg; в overlay окно —
 *    прозрачная дыра (маска), сквозь неё видно живую карту. `mapSlot()` = bbox
 *    окна (axis-aligned), клиент кладёт карту туда. Так превью == финал.
 *  - Фон — full-bleed `<image href="__SHARE_CARD_BG__">` в самом низу; клиент
 *    подменяет токен на выбранную подложку ЛИБО удаляет элемент (прозрачно) —
 *    см. src/lib/shareCardBg.js. В overlay фон маскируется дырой окна.
 *  - Флаги — встроены на edge (FLAGS_B64): `/flags/<cc>.svg` в data-URI (нет
 *    доступа к public/ в рантайме edge).
 *
 * Палитра/шрифты/скругления фиксированы (часть дизайна). Весь текст открытой зоны
 * (заголовок/маршрут/цифры/подписи) — белый с мягкой тенью (читается на любой
 * подложке); тёмный текст только в кремовой рамке и на светлой плашке футера.
 * Правило проекта: дефис "-", не длинное тире.
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
  shadow: 'rgba(10,18,30,0.45)',
  innerShadow: 'rgba(18,28,42,0.42)',
};

const FONT = "'Geologica'";
const SCRIPT_FONT = "'Caveat'";
const POLA_ROT = -1.6;
const POLA_R = 26; // радиус рамки
const WIN_R = 12; // радиус окна карты (углы почти прямые)

// ---- per-format geometry (числа транскрибированы из прототипа v24) -----------
type Layout = {
  w: number;
  h: number;
  padX: number;
  titleAlign: 'center' | 'left';
  titleLeft: number; // используется при titleAlign==='left'
  titleTop: number; // baseline первой строки
  titleSize: number;
  routeGap: number; // от baseline последней строки заголовка до baseline маршрута
  routeSize: number;
  pola: { top: number; width: number; padT: number; padX: number; padB: number; winH: number };
  capSize: number;
  stats: { y: number; numSize: number; labSize: number; cellPad: number };
  flags: { y: number; h: number; labSize: number; circle: number; ring: number; gap: number; moreSize: number };
  footer: {
    y: number; h: number; padX: number; padT: number;
    ctaSize: number; ctaLead: number; brandSize: number; brandGap: number; logo: number;
    scanSize: number; qr: number;
  };
};

const LAYOUTS: Record<Format, Layout> = {
  story: {
    w: 1080, h: 1920, padX: 66,
    titleAlign: 'center', titleLeft: 0, titleTop: 270, titleSize: 132,
    routeGap: 104, routeSize: 56,
    pola: { top: 548, width: 860, padT: 34, padX: 34, padB: 34, winH: 640 },
    capSize: 52,
    stats: { y: 1452, numSize: 74, labSize: 32, cellPad: 36 },
    flags: { y: 1564, h: 98, labSize: 26, circle: 58, ring: 3, gap: 12, moreSize: 24 },
    footer: {
      y: 1687, h: 206, padX: 36, padT: 24,
      ctaSize: 46, ctaLead: 48, brandSize: 32, brandGap: 12, logo: 50,
      scanSize: 40, qr: 146,
    },
  },
  post: {
    w: 1080, h: 1350, padX: 60,
    titleAlign: 'left', titleLeft: 84, titleTop: 156, titleSize: 96,
    routeGap: 84, routeSize: 50,
    pola: { top: 356, width: 912, padT: 30, padX: 30, padB: 30, winH: 432 },
    capSize: 50,
    stats: { y: 1008, numSize: 66, labSize: 30, cellPad: 36 },
    flags: { y: 1084, h: 74, labSize: 24, circle: 48, ring: 3, gap: 10, moreSize: 22 },
    footer: {
      y: 1180, h: 159, padX: 28, padT: 14,
      ctaSize: 38, ctaLead: 40, brandSize: 28, brandGap: 8, logo: 44,
      scanSize: 40, qr: 120,
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

/** Плоская тень = тёмная копия со сдвигом (+1,+2), затем белый оригинал поверх.
 *  `el(fill, dx, dy)` рисует один слой; порядок фиксирован (тень под текстом). */
function withShadow(el: (fill: string, dx: number, dy: number) => string): string {
  return el(C.shadow, 1, 2) + el(C.white, 0, 0);
}

type TextOpts = { anchor?: 'start' | 'middle' | 'end'; weight?: number; ls?: number; font?: string; fill?: string };
function text(x: number, y: number, size: number, t: string, o: TextOpts = {}): string {
  const a = o.anchor ? ` text-anchor="${o.anchor}"` : '';
  const ls = o.ls ? ` letter-spacing="${o.ls}"` : '';
  return `<text x="${x}" y="${y}" font-family="${o.font || FONT}" font-weight="${o.weight ?? 700}" `
    + `font-size="${size}" fill="${o.fill || C.navy}"${a}${ls}>${escapeXml(t)}</text>`;
}

/** Белый текст с мягкой тенью (плоский offset, без blur — blur рвёт CPU-лимит).
 *  Тень = тёмная копия со сдвигом; читается на любой подложке/карте. */
function wtext(x: number, y: number, size: number, t: string, o: TextOpts = {}): string {
  const a = o.anchor ? ` text-anchor="${o.anchor}"` : '';
  const ls = o.ls ? ` letter-spacing="${o.ls}"` : '';
  const font = o.font || FONT;
  const w = o.weight ?? 700;
  const el = (fill: string, dx: number, dy: number) =>
    `<text x="${x + dx}" y="${y + dy}" font-family="${font}" font-weight="${w}" font-size="${size}" `
    + `fill="${fill}"${a}${ls}>${escapeXml(t)}</text>`;
  return withShadow(el);
}

/** Белая цифра с тенью (tabular-nums, отрицательный трекинг — как в прототипе). */
function numText(x: number, y: number, size: number, t: string, anchor: 'start' | 'middle' | 'end'): string {
  const el = (fill: string, dx: number, dy: number) =>
    `<text x="${x + dx}" y="${y + dy}" font-family="${FONT}" font-weight="700" font-size="${size}" `
    + `fill="${fill}" text-anchor="${anchor}" font-variant-numeric="tabular-nums" letter-spacing="-1">${escapeXml(t)}</text>`;
  return withShadow(el);
}

/** Заголовок в ≤2 строки со СБАЛАНСИРОВАННЫМ переносом и усадкой кегля: одна
 *  строка если влезает, иначе делим слова на 2 строки так, чтобы длинная была
 *  минимальной (визуально ровные строки — как «The best trip / of my life», а не
 *  жадное «The best trip of / my life»). Кегль уменьшается, пока не влезет. */
function wrapTitle(title: string, maxW: number, base: number): { lines: string[]; size: number } {
  const words = title.trim().split(/\s+/).filter(Boolean);
  for (let size = base; size >= base * 0.5; size -= 4) {
    if (advance(title, size, 0.56) <= maxW) return { lines: [title], size };
    let best: { a: string; b: string; m: number } | null = null;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' ');
      const b = words.slice(k).join(' ');
      const wa = advance(a, size, 0.56);
      const wb = advance(b, size, 0.56);
      if (wa <= maxW && wb <= maxW) {
        const m = Math.max(wa, wb);
        if (!best || m < best.m) best = { a, b, m };
      }
    }
    if (best) return { lines: [best.a, best.b], size };
  }
  // Крайний случай (одно очень длинное слово): одна строка на минимальном кегле.
  return { lines: [title], size: Math.round(base * 0.5) };
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
  const capBlock = Math.round(L.capSize * 1.1) + 16;
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

  // --- заголовок (белый, ≤2 строки с усадкой) ---
  const maxTitleW = L.titleAlign === 'left' ? W - L.titleLeft - L.padX : W - L.padX * 2;
  const { lines, size: tSize } = wrapTitle(data.title, maxTitleW, L.titleSize);
  const lineH = Math.round(tSize * 0.94);
  const titleW = Math.max(...lines.map((l) => advance(l, tSize, 0.56)));
  const titleX = L.titleAlign === 'left' ? L.titleLeft : Math.round((W - titleW) / 2);
  const titleSvg = lines
    .map((l, i) => wtext(titleX, L.titleTop + i * lineH, tSize, l, { weight: 700, ls: -0.5 }))
    .join('');
  const lastTitleY = L.titleTop + (lines.length - 1) * lineH;

  // --- маршрут «from → to» (белый; стрелка рисуется — глиф → не в сабсете) ---
  const routeY = lastTitleY + L.routeGap;
  const hasTo = data.to && data.to !== data.from;
  const fromW = advance(data.from, L.routeSize, 0.56);
  const arrowGap = 22;
  const arrowW = 46;
  let routeSvg = wtext(titleX, routeY, L.routeSize, data.from, { weight: 600 });
  if (hasTo) {
    const ax = titleX + fromW + arrowGap;
    const ay = routeY - L.routeSize * 0.28;
    const arrow = (stroke: string, dx: number, dy: number) =>
      `<g transform="translate(${dx},${dy})" stroke="${stroke}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">`
      + `<line x1="${ax}" y1="${ay}" x2="${ax + arrowW - 12}" y2="${ay}"/>`
      + `<path d="M${ax + arrowW - 20},${ay - 9} L${ax + arrowW},${ay} L${ax + arrowW - 20},${ay + 9}"/></g>`;
    routeSvg += withShadow(arrow);
    routeSvg += wtext(ax + arrowW + arrowGap, routeY, L.routeSize, data.to, { weight: 600 });
  }

  // --- полароид: кремовая рамка с ВЫРЕЗАННЫМ окном (evenodd), карта, подпись ---
  const winPath = roundedRectPath(g.winX, g.winY, g.winW, g.winH, WIN_R);
  const cream = `<path d="${roundedRectPath(g.polaX, g.polaY, g.polaW, g.polaH, POLA_R)} ${winPath}" `
    + `fill="${C.cream}" fill-rule="evenodd" transform="${polaXf}"/>`;
  const creamShadow = `<path d="${roundedRectPath(g.polaX, g.polaY, g.polaW, g.polaH, POLA_R)}" `
    + `fill="#000" opacity="0.20" transform="${polaXf} translate(6,14)"/>`;
  // Карта: axis-aligned image в bbox, обрезка повёрнутым окном. overlay ⇒ дыра.
  const mapImg = overlay
    ? ''
    : (mapDataUri
      ? `<image href="${mapDataUri}" x="${slot.x}" y="${slot.y}" width="${slot.w}" height="${slot.h}" `
        + `preserveAspectRatio="xMidYMid slice" clip-path="url(#winclip)"/>`
      : `<rect x="${slot.x}" y="${slot.y}" width="${slot.w}" height="${slot.h}" fill="#dbe6ef" clip-path="url(#winclip)"/>`);
  // Внутренняя тень карты по краю (карта «утоплена» под рамкой) — плоские
  // stroke-полосы внутри окна (без blur): широкая слабая + узкая плотнее.
  // Рисуется и в overlay (поверх дыры с живой картой) — чтобы превью == финал.
  const innerShadow = `<g clip-path="url(#winclip)">`
    + `<path d="${winPath}" transform="${polaXf}" fill="none" stroke="${C.innerShadow}" stroke-width="30" opacity="0.20"/>`
    + `<path d="${winPath}" transform="${polaXf}" fill="none" stroke="${C.innerShadow}" stroke-width="10" opacity="0.30"/></g>`;
  // Подпись «My trip!» + сердечко (в кремовой зоне под окном, повёрнуты с рамкой).
  const capY = g.winY + g.winH + Math.round(L.capSize * 0.92);
  const heartX = g.polaX + g.polaW - L.pola.padX - 16;
  const heartY = g.winY + g.winH + 26;
  const caption = `<g transform="${polaXf}">`
    + text(g.winX + 8, capY, L.capSize, data.myTrip, { font: SCRIPT_FONT, weight: 700, fill: C.script })
    + `<path d="M${heartX},${heartY + 6} c-4,-6 -13,-3 -13,4 c0,6 13,14 13,14 c0,0 13,-8 13,-14 c0,-7 -9,-10 -13,-4 Z" `
    + `fill="none" stroke="${C.script}" stroke-width="2.4"/></g>`;

  // --- ряд статистики (4 ячейки, золотые разделители, белые цифры+подписи) ---
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
${innerShadow}
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
      parts.push(`<rect x="${Math.round(x)}" y="${s.y - s.numSize + 8}" width="2" height="${s.numSize + 10}" fill="${C.gold}" opacity="0.7"/>`);
    }
    parts.push(numText(cxc, s.y, s.numSize, c.num, 'middle'));
    parts.push(wtext(cxc, s.y + s.labSize + 8, s.labSize, c.lab, { weight: 500, anchor: 'middle' }));
    x += cw;
  });
  return parts.join('');
}

// Ряд флагов: плашка + «Visited Countries» + круглые флаги (сколько влезло) + «+N».
function buildFlags(L: Layout, d: CardData): string {
  const f = L.flags;
  const left = L.padX - 6;
  const right = L.w - (L.padX - 6);
  const boxW = right - left;
  const cy = f.y + f.h / 2;
  const parts: string[] = [
    `<rect x="${left}" y="${f.y}" width="${boxW}" height="${f.h}" rx="${f.h / 2}" fill="${C.flagBg}"/>`,
  ];
  // Подпись слева (до 2 строк по \n).
  const labX = left + 30;
  const labLines = d.visitedLabel.split('\n');
  const labLead = f.labSize + 4;
  const labY0 = cy - ((labLines.length - 1) * labLead) / 2 + f.labSize * 0.34;
  labLines.forEach((l, i) => parts.push(text(labX, labY0 + i * labLead, f.labSize, l, { weight: 400, fill: C.white })));
  const labW = Math.max(...labLines.map((l) => advance(l, f.labSize, 0.56)));
  // Зона под флаги: от конца подписи до правого края (место под «+N» резервируем).
  const listLeft = labX + labW + 24;
  const chipD = f.circle;
  const rightPad = 24;
  const total = d.flags.length;
  const step = f.circle + f.gap;
  const avail = right - rightPad - listLeft;
  let shown = Math.max(0, Math.min(total, Math.floor((avail + f.gap) / step)));
  const needChip = shown < total;
  if (needChip) {
    const availWithChip = avail - (chipD + f.gap);
    shown = Math.max(0, Math.min(total, Math.floor((availWithChip + f.gap) / step)));
  }
  // Флаги распределены по ширине зоны (space-between), «+N» — у правого края.
  const chipReserve = needChip ? chipD + f.gap : 0;
  const zoneW = avail - chipReserve;
  const spread = shown > 1 ? Math.max(step, (zoneW - f.circle) / (shown - 1)) : step;
  let fx = listLeft + f.circle / 2;
  for (let i = 0; i < shown; i++) {
    parts.push(flagCircle(fx, cy, f.circle, f.ring, d.flags[i]));
    fx += spread;
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
// справа «Scan to explore» (по центру половины) + дуга-стрелка к QR + QR у края.
function buildFooter(L: Layout, d: CardData, qrUrl: string): string {
  const f = L.footer;
  const left = L.padX - 10;
  const right = L.w - (L.padX - 10);
  const boxW = right - left;
  const midX = L.w / 2;
  const parts: string[] = [
    `<rect x="${left}" y="${f.y}" width="${boxW}" height="${f.h}" rx="34" fill="${C.footBg}"/>`,
    `<rect x="${midX - 1}" y="${f.y + 24}" width="2" height="${f.h - 48}" fill="${C.divider}"/>`,
  ];
  // Левая колонка: «Plan your / own adventure» + ряд бренда [лого] TRIPLANIO.
  const cx0 = left + f.padX;
  const l1 = f.y + f.padT + f.ctaSize * 0.82; // baseline первой строки
  const l2 = l1 + f.ctaLead;
  parts.push(text(cx0, l1, f.ctaSize, d.planLine1, { weight: 800 }));
  parts.push(text(cx0, l2, f.ctaSize, d.planLine2, { weight: 800 }));
  const brandCy = l2 + f.brandGap + f.logo / 2; // центр ряда бренда
  parts.push(`<image href="${LOGO_URI}" x="${cx0}" y="${brandCy - f.logo / 2}" width="${f.logo}" height="${f.logo}"/>`);
  parts.push(text(cx0 + f.logo + 14, brandCy + f.brandSize * 0.34, f.brandSize, d.brand, { weight: 700, ls: 3 }));

  // Правая колонка: QR у правого края; «Scan to / explore» по центру зоны между
  // разделителем и QR; дуга-стрелка из-под текста к левому центру QR.
  const q = f.qr;
  const qrX = right - f.padX - q;
  const qrY = f.y + (f.h - q) / 2;
  const zoneL = midX;
  const zoneR = qrX;
  const scanCx = (zoneL + zoneR) / 2;
  const scanY0 = f.y + f.h / 2 - f.scanSize * 0.28;
  parts.push(text(scanCx, scanY0, f.scanSize, d.scanLine1, { font: SCRIPT_FONT, weight: 700, anchor: 'middle' }));
  parts.push(text(scanCx, scanY0 + f.scanSize * 0.92, f.scanSize, d.scanLine2, { font: SCRIPT_FONT, weight: 700, anchor: 'middle' }));
  // Дуга из-под текста вправо-вверх к левому центру QR (стрелка навы).
  const aY = scanY0 + f.scanSize * 1.5;
  const aX0 = scanCx - 30;
  const aX1 = qrX - 8;
  const aYmid = aY + 18;
  const aYend = qrY + q / 2;
  parts.push(`<g stroke="${C.navy}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="M${aX0},${aY} C${aX0 + 40},${aYmid} ${aX1 - 40},${aYend + 10} ${aX1},${aYend}"/>`
    + `<path d="M${aX1 - 16},${aYend - 8} L${aX1},${aYend} L${aX1 - 6},${aYend + 14}"/></g>`);
  // QR: qrSvg сам рисует белую скруглённую подложку + тихую зону 8% вокруг модулей.
  parts.push(qrSvg(qrUrl, qrX, qrY, q));
  return parts.join('');
}
