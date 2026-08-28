/**
 * Share-card SVG template (TRIP-443) — новый дизайн: прозрачный стикер поверх
 * подложки. Порт раскладки прототипа share-card-prototype-v34 в data-driven SVG.
 *
 * Композиция (сверху вниз): заголовок Geologica (белый, по левому краю) + маршрут
 * «город -> город» (белый) · полароид (кремовая рамка -1.6°, окно карты с
 * внутренней тенью, а под окном — ряд «Countries» + круглые флаги по левому краю
 * и «+N») · ряд статистики (белые цифры + подписи, золотые разделители) ·
 * логотип «Triplanio» в левом нижнем углу.
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
 * подложке); тёмный текст только в кремовой рамке полароида.
 * Правило проекта: дефис "-", не длинное тире.
 */

import { GLYPH_W, GLYPH_FALLBACK, FONT_ASCENT, FONT_DESCENT } from './glyphWidths.ts';
/** Запас на кернинг пар: сумма одиночных глифов его не знает, и на отдельных
 *  строках он даёт до −0.3% (то есть в ОПАСНУЮ сторону). 1% покрывает это с
 *  перекрытием и стоит доли пикселя воздуха; генератор таблицы проверяет, что с
 *  этим запасом занижения не остаётся ни на одной контрольной строке. */
const KERN_SAFETY = 1.01;
import { LOGO_SVG_B64 } from './assets_b64.ts';
import { FLAGS_B64 } from './flags_b64.ts';

const LOGO_URI = `data:image/svg+xml;base64,${LOGO_SVG_B64}`;
const flagUri = (cc: string) => (FLAGS_B64[cc] ? `data:image/svg+xml;base64,${FLAGS_B64[cc]}` : '');

export type Format = 'story' | 'post';

// Данные карточки собирает index.ts и передаёт литералом.
export type CardData = {
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
  visitedLabel: string; // подпись секции флагов ("Countries")
  brand: string; // "Triplanio" (вордмарк рядом с логотипом)
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
  white: '#FFFFFF',
  flagRing: 'rgba(20,30,45,0.14)', // тонкое кольцо круглого флага в кремовой рамке
  shadow: 'rgba(10,18,30,0.45)',
  innerShadow: 'rgba(18,28,42,0.42)',
};

const FONT = "'Geologica'";
const POLA_ROT = -1.6;
const POLA_R = 26; // радиус рамки
const WIN_R = 12; // радиус окна карты (углы почти прямые)

// ---- per-format geometry (числа транскрибированы из прототипа v34) -----------
export type Layout = {
  w: number;
  h: number;
  padX: number;
  titleLeft: number; // левый край заголовка/маршрута (совпадает с левым краем рамки)
  titleTop: number; // baseline первой строки
  titleSize: number;
  routeGap: number; // от baseline последней строки заголовка до baseline маршрута
  routeSize: number;
  pola: { top: number; width: number; padT: number; padX: number; padB: number; winH: number };
  // Ряд «Countries» + флаги ВНУТРИ кремовой рамки под окном карты.
  cap: { labSize: number; flag: number; ring: number; gap: number; labGap: number; moreSize: number; blockH: number };
  stats: { y: number; numSize: number; labSize: number; cellPad: number };
  brand: { cy: number; logo: number; logoR: number; size: number; gap: number };
};

export const LAYOUTS: Record<Format, Layout> = {
  story: {
    w: 1080, h: 1920, padX: 66,
    titleLeft: 110, titleTop: 265, titleSize: 132,
    routeGap: 104, routeSize: 56,
    pola: { top: 563, width: 860, padT: 34, padX: 34, padB: 34, winH: 640 },
    cap: { labSize: 36, flag: 44, ring: 2, gap: 8, labGap: 44, moreSize: 22, blockH: 84 },
    stats: { y: 1495, numSize: 74, labSize: 32, cellPad: 36 },
    brand: { cy: 1806, logo: 76, logoR: 18, size: 48, gap: 16 },
  },
  post: {
    w: 1080, h: 1350, padX: 60,
    titleLeft: 84, titleTop: 150, titleSize: 96,
    // TRIP-443: зазор заголовок→города увеличен (73→92), чтобы на посте строка
    // городов «дышала» так же, как на стори (была прижата к заголовку).
    routeGap: 92, routeSize: 50,
    pola: { top: 371, width: 912, padT: 30, padX: 30, padB: 30, winH: 520 },
    cap: { labSize: 32, flag: 40, ring: 2, gap: 8, labGap: 40, moreSize: 20, blockH: 76 },
    stats: { y: 1107, numSize: 66, labSize: 30, cellPad: 36 },
    brand: { cy: 1276, logo: 66, logoR: 16, size: 42, gap: 14 },
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

/** Грубый advance (px). Geologica ~0.54·size на средних весах. */
/**
 * Ширина строки по РЕАЛЬНЫМ ширинам глифов Geologica (таблица `glyphWidths.ts`,
 * снята с тех же woff2, что грузит приложение и что вшиты в финальный растр).
 *
 * Было: `длина_в_символах × кегль × 0.54` — догадка, не знающая, какие это буквы.
 * В кириллице «ш» вдвое шире «г», и догадка занижала: «Белград» 220 против 237
 * реальных (+8%), «Балканам» 591 против 664 (+12%), «км» 36 против 42 (+17%).
 * Зазор до стрелки маршрута заложен 22 единицы — «Белград» съедал 17, и стрелка
 * садилась на последнюю букву.
 *
 * Ширина зависит от ВЕСА, поэтому вес — обязательный аргумент: тот же текст в
 * 500 и 700 занимает разное место, и «примерно один» коэффициент здесь и был
 * источником ошибки.
 *
 * ★ ОТРИЦАТЕЛЬНЫЙ ТРЕКИНГ (`letter-spacing` −0.5/−1 у заголовка и чисел) в
 * расчёт НЕ входит СОЗНАТЕЛЬНО. Он делает реальный текст УЖЕ расчётного, то
 * есть ошибка уходит в запас. Учитывать его значило бы подойти к границе
 * вплотную и снова получить наезд при первой же неточности; кернинг пар не
 * учитывается по той же причине (генератор проверяет, что сумма глифов реальную
 * длину только ЗАВЫШАЕТ, максимум на 4-5%).
 */
function advance(text: string, size: number, weight: number): number {
  const row = GLYPH_W[weight] || GLYPH_W[700];
  let per1000 = 0;
  for (const ch of text) per1000 += row[ch] ?? GLYPH_FALLBACK;
  return (per1000 * size * KERN_SAFETY) / 1000;
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
 *  Тень = тёмная копия со сдвигом; читается на любой подложке/карте.
 *
 *  ★ МОНОШИРИННЫХ ЦИФР ЗДЕСЬ НЕТ И НЕ БЫЛО. Ряд статистики нёс атрибут
 *  `font-variant-numeric="tabular-nums"` — в SVG это МЁРТВЫЙ атрибут: замер в
 *  Chromium и WebKit даёт одну и ту же ширину «4 382» с ним и без него (2630
 *  тысячных), а работает он только как СТИЛЬ (2822). То есть цифры карточки
 *  всегда были пропорциональными, и таблица ширин, снятая через SVG, это же и
 *  измерила. Атрибут снят, чтобы код не обещал того, чего не делает; включать
 *  моноширинные — отдельное решение: они шире на 7%, и колонки ряда придётся
 *  переснять. */
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

/** Заголовок в ≤2 строки со СБАЛАНСИРОВАННЫМ переносом и усадкой кегля: одна
 *  строка если влезает, иначе делим слова на 2 строки так, чтобы длинная была
 *  минимальной (визуально ровные строки — как «The best trip / of my life», а не
 *  жадное «The best trip of / my life»). Кегль уменьшается, пока не влезет. */
function wrapTitle(title: string, maxW: number, base: number): { lines: string[]; size: number } {
  const words = title.trim().split(/\s+/).filter(Boolean);
  for (let size = base; size >= base * 0.5; size -= 4) {
    if (advance(title, size, 700) <= maxW) return { lines: [title], size };
    let best: { a: string; b: string; m: number } | null = null;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' ');
      const b = words.slice(k).join(' ');
      const wa = advance(a, size, 700);
      const wb = advance(b, size, 700);
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
  // Высота всей рамки: верхний паддинг + окно + блок «Countries + флаги» + низ.
  const polaH = p.padT + winH + L.cap.blockH + p.padB;
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

// ---- раскладка текста -------------------------------------------------------
/**
 * Один элемент текста карточки: строка, её базовая точка и облик — в единицах
 * КАРТОЧКИ (1080 × высота формата), а не экрана. Потребителей двое и они равны:
 * SVG-рендер здесь же (`renderTextItems`) и клиент, который кладёт этот текст
 * DOM-ом поверх кадра. Клиент НИЧЕГО не пересчитывает: два независимых расчёта
 * одного макета — это и есть механизм, которым превью расходится с карточкой.
 *
 * `y` — БАЗОВАЯ ЛИНИЯ (как у SVG `<text>`); `top` — верх бокса того же текста в
 * DOM при `line-height: 1`. Оба числа считает раскладка, потому что перевод
 * одного в другое требует метрик ШРИФТА, а они есть только здесь (замерены
 * генератором с тех же woff2 — см. glyphWidths.ts). Если бы это делил клиент,
 * он держал бы у себя копию метрик, и при ре-вендоринге шрифта текст превью
 * молча уехал бы относительно карточки.
 */
export type CardTextItem = {
  kind: 'title' | 'route' | 'stat-num' | 'stat-label' | 'brand';
  x: number;
  y: number;
  top: number;
  size: number;
  weight: number;
  value: string;
  anchor?: 'middle';
  tracking?: number;
};

/** Текст ОТКРЫТОЙ ЗОНЫ карточки: заголовок, маршрут, ряд статистики, вордмарк.
 *
 *  Подпись «Страны» сюда НЕ входит намеренно: она лежит внутри кремовой рамки и
 *  повёрнута вместе с ней — это часть картинки, а не текст карточки.
 */
export function buildCardText(format: Format, d: CardData): CardTextItem[] {
  const L = LAYOUTS[format];
  const items: CardTextItem[] = [];
  // Базовая линия → верх бокса при `line-height: 1`: половина «свободного» места
  // строки (кегль минус содержимое шрифта) плюс подъём. Числа — тысячные доли
  // кегля, замерены с самих файлов шрифта.
  const topOf = (y: number, size: number) =>
    y - size * ((1000 - (FONT_ASCENT + FONT_DESCENT)) / 2 + FONT_ASCENT) / 1000;
  const add = (i: Omit<CardTextItem, 'top'>) => items.push({ ...i, top: topOf(i.y, i.size) });

  // Заголовок: ≤2 строки с усадкой кегля (перенос считает wrapTitle — здесь и
  // сейчас, чтобы клиенту не пришлось повторять разбивку).
  const { lines, size: tSize } = wrapTitle(d.title, L.w - L.titleLeft - L.padX, L.titleSize);
  const lineH = Math.round(tSize * 0.94);
  lines.forEach((line, i) => add({
    kind: 'title', x: L.titleLeft, y: L.titleTop + i * lineH, size: tSize, weight: 700, tracking: -0.5, value: line,
  }));

  // Маршрут — ОДНА строка «город → город». Раньше это были два текста с
  // нарисованной стрелкой между ними: глифа U+2192 не было ни в одном сабсете
  // Geologica, который отдаёт Google. Цена была не косметическая — координата
  // второго города складывалась вручную (`x + advance(from) + зазор + стрелка +
  // зазор`), и этот расчёт однажды посадил стрелку на последнюю букву. Теперь
  // стрелка обычный символ (пятый сабсет, один глиф — см. src/design/fonts.css),
  // строку раскладывает движок, а править её можно одним полем.
  add({
    kind: 'route', x: L.titleLeft, y: L.titleTop + (lines.length - 1) * lineH + L.routeGap,
    size: L.routeSize, weight: 600, value: d.to && d.to !== d.from ? `${d.from} → ${d.to}` : d.from,
  });

  // Ряд статистики: цифра и подпись по центру своей колонки.
  const s = L.stats;
  statsColumns(L, d).forEach((col) => {
    add({ kind: 'stat-num', x: col.cx, y: s.y, size: s.numSize, weight: 700, anchor: 'middle', tracking: -1, value: col.num });
    add({ kind: 'stat-label', x: col.cx, y: s.y + s.labSize + 8, size: s.labSize, weight: 500, anchor: 'middle', value: col.lab });
  });

  // Вордмарк рядом с логомарком (сам логомарк — картинка, остаётся в SVG).
  const b = L.brand;
  add({ kind: 'brand', x: L.padX + b.logo + b.gap, y: b.cy + b.size * 0.34, size: b.size, weight: 800, value: d.brand });

  return items;
}

/** Тот же текст, нарисованный в SVG (белый с тенью — облик открытой зоны). */
function renderTextItems(items: CardTextItem[]): string {
  return items.map((i) => wtext(i.x, i.y, i.size, i.value, {
    weight: i.weight, anchor: i.anchor, ls: i.tracking,
  })).join('');
}

// ---- render -----------------------------------------------------------------
export function buildCardSvg(
  format: Format,
  data: CardData,
  mapDataUri: string | null,
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

  // --- текст открытой зоны: ОДНА раскладка на всех потребителей ------------
  // Позиции считает `buildCardText`, и он же отдаётся клиенту в ответе overlay.
  // Здесь мы его только РИСУЕМ. Так у макета один источник: если бы превью
  // считало те же координаты у себя, мы бы завели два расчёта одного макета —
  // ровно ту болезнь, из-за которой превью и карточка расходятся.
  const items = buildCardText(format, data);
  const titleLines = items.filter((i) => i.kind === 'title').length;
  // В OVERLAY кадр текста НЕ несёт: превью кладёт его DOM-ом поверх (тот же
  // список приезжает в ответе). Причина не в удобстве — SVG-текст, вставленный
  // в документ строкой, на iOS 26 терял раскладку: строка приходила с верными
  // ширинами и через полторы секунды обнулялась, а названия городов пропадали
  // (замер: t0 237/171 → t1 0/0, Sentry TRIPLANIO-2Z). Обычный текст страницы
  // этой болезни не подвержен, и он же нужен, чтобы текст можно было править.
  // Финальная карточка растеризуется картинкой — там SVG-текст остаётся.
  const textSvg = overlay ? '' : renderTextItems(items);

  // --- скрим под текстом (TRIP-443) --------------------------------------
  // Белый текст карточки лежит на ПРОИЗВОЛЬНОМ фоне: пресет, фото юзера или
  // базовый градиент. Без подложки читаемость — лотерея, и проигрывает она не
  // в экзотике: `bgGrad` СВЕТЛЫЙ в верхней трети (#cfe0ec, контраст с белым
  // 1.36:1), а закатный/снежный пресет даёт ту же яркую полосу ровно на высоте
  // строки городов. Именно так «названия городов пропадали»: они не исчезали,
  // они СЛИВАЛИСЬ, а на смене обложки читались лишь те доли секунды, пока
  // новое фото не отрисовалось. Тем же объясняется «тень у цифр»: тёмная копия
  // из withShadow не видна на тёмном фоне и проявляется, когда под ней встаёт
  // светлое фото.
  // Канон ДС — `.tc__scrim` (вертикальный градиент rgba(8,10,20,α)); цвет берём
  // его, форму задаёт РАСКЛАДКА: текст стоит двумя блоками (заголовок+маршрут
  // сверху, цифры+бренд снизу), середину занимает полароид — там подложка не
  // нужна и только мешала бы фотографии.
  const scrimStops = scrimGradient(L, titleLines);
  const scrimBase = `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#scrimGrad)"/>`;
  // В overlay окно вырезано под живую карту — скрим тоже обязан обойти дырку,
  // иначе он затенит карту, которая лежит НЕ в SVG.
  const scrim = overlay ? `<g mask="url(#winhole)">${scrimBase}</g>` : scrimBase;

  // --- полароид: кремовая рамка с ВЫРЕЗАННЫМ окном (evenodd), карта, ряд стран ---
  const winPath = roundedRectPath(g.winX, g.winY, g.winW, g.winH, WIN_R);
  const cream = `<path d="${roundedRectPath(g.polaX, g.polaY, g.polaW, g.polaH, POLA_R)} ${winPath}" `
    + `fill="${C.cream}" fill-rule="evenodd" transform="${polaXf}"/>`;
  // Тень полароида — СПЛОШНОЙ чёрный прямоугольник рамки под ней. В финале его
  // накрывает картинка карты, а в overlay окно — ДЫРА, и та же тень просвечивала
  // сквозь неё, кладя ровные 20% черноты на живую карту: превью было темнее
  // готовой карточки, хотя ни одного «скрима над картой» в шаблоне нет. Поэтому
  // окно вырезаем из тени ВСЕГДА (`winhole`), а не только в overlay: в финале
  // это ничего не меняет (там поверх лежит карта) — расхождению просто негде
  // взяться по построению.
  const creamShadow = `<g mask="url(#winhole)"><path d="${roundedRectPath(g.polaX, g.polaY, g.polaW, g.polaH, POLA_R)}" `
    + `fill="#000" opacity="0.20" transform="${polaXf} translate(6,14)"/></g>`;
  // Карта: axis-aligned image в bbox, обрезка повёрнутым окном. overlay ⇒ дыра.
  const mapImg = overlay
    ? ''
    : (mapDataUri
      ? `<image href="${mapDataUri}" x="${slot.x}" y="${slot.y}" width="${slot.w}" height="${slot.h}" `
        + `preserveAspectRatio="xMidYMid slice" clip-path="url(#winclip)"/>`
      : `<rect x="${slot.x}" y="${slot.y}" width="${slot.w}" height="${slot.h}" fill="#dbe6ef" clip-path="url(#winclip)"/>`);
  // Внутренняя тень карты по краю (карта «утоплена» под рамкой) — как в макете
  // РАЗМЫТАЯ (inset box-shadow): stroke по краю окна + feGaussianBlur, обрезано
  // окном (winclip), поэтому размытие уходит ТОЛЬКО внутрь. Blur снова можно —
  // растеризация идёт в браузере (не серверный resvg с CPU-лимитом). Рисуется и
  // в overlay (поверх дыры с живой картой), чтобы превью == финал.
  const innerShadow = `<g clip-path="url(#winclip)">`
    + `<g filter="url(#winInnerA)"><path d="${winPath}" transform="${polaXf}" fill="none" stroke="${C.innerShadow}" stroke-width="10" opacity="0.42"/></g>`
    + `<g filter="url(#winInnerB)"><path d="${winPath}" transform="${polaXf}" fill="none" stroke="${C.innerShadow}" stroke-width="6" opacity="0.32"/></g></g>`;

  // --- ряд «Countries» + флаги ВНУТРИ кремовой рамки (под окном, повёрнут с рамкой) ---
  const countries = buildInFrameCountries(L, g, data, polaXf);

  // --- фигуры ряда статистики и логомарк (текст этих блоков — в items) ---
  const separators = statsSeparators(L, data);
  const brandMark = buildBrandMark(L);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
 ${fontCss}
 <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9c7e6"/><stop offset="0.32" stop-color="#cfe0ec"/><stop offset="0.62" stop-color="#7fa7b3"/><stop offset="1" stop-color="#274b63"/></linearGradient>
 <linearGradient id="scrimGrad" x1="0" y1="0" x2="0" y2="1">${scrimStops}</linearGradient>
 <clipPath id="winclip"><path d="${winPath}" transform="${polaXf}"/></clipPath>
 <!-- maskUnits/x/y/w/h заданы ЯВНО в координатах кадра: по умолчанию область маски
      считается от bbox ТОГО, кто её применил (-10%…110%), а применяют её теперь и
      к тени полароида, чей bbox — не весь кадр. Явные единицы делают маску
      одинаковой для всех потребителей. -->
 <mask id="winhole" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" fill="white"/><path d="${winPath}" transform="${polaXf}" fill="black"/></mask>
 <filter id="winInnerA" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="12"/></filter>
 <filter id="winInnerB" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
 <clipPath id="logoClip"><rect x="${L.padX}" y="${L.brand.cy - L.brand.logo / 2}" width="${L.brand.logo}" height="${L.brand.logo}" rx="${L.brand.logoR}" ry="${L.brand.logoR}"/></clipPath>
</defs>
${bg}
${scrim}
${creamShadow}
${cream}
${mapImg}
${innerShadow}
${countries}
${separators}
${brandMark}
${textSvg}
</svg>`;
}

/**
 * Стопы скрима под текстом карточки (TRIP-443).
 *
 * ПОЧЕМУ СЧИТАЕМ, А НЕ ПОДБИРАЕМ ПРОЦЕНТЫ. Скрим обязан накрывать ровно те
 * полосы, где стоит текст. Полосы заданы раскладкой (`LAYOUTS`) и разные у
 * story и post, а верхняя ещё и плавает: заголовок бывает в одну строку и в
 * две. Проценты, подобранные под один кадр, на другом сползают с текста —
 * и дефект возвращается молча, потому что скрим при этом ЕСТЬ.
 *
 * ALPHA выведена из требования к контрасту, а не из вкуса: худший фон — белый
 * (снег, засвеченное небо, светлая часть базового градиента). Белый под
 * подложкой rgba(8,10,20,a) даёт канал 255*(1-a)+8*a; при a=0.55 это ~119,
 * относительная яркость ~0.183, контраст с белым текстом ~4.5:1 — порог
 * WCAG AA для обычного текста. Меньше 0.55 порог не берётся.
 */
export function scrimGradient(L: Layout, titleLines: number): string {
  const H = L.h;
  const ALPHA = 0.55;
  const c = (a: number) => `rgba(8,10,20,${a})`;
  const st = (off: number, a: number) =>
    `<stop offset="${Math.max(0, Math.min(1, off)).toFixed(4)}" stop-color="${c(a)}"/>`;

  // Верхний блок: заголовок (может быть 2 строки) + строка маршрута.
  const lineH = Math.round(L.titleSize * 0.94);
  const routeBase = L.titleTop + (titleLines - 1) * lineH + L.routeGap;
  const topEnd = (routeBase + L.routeSize * 0.34) / H; // низ выносных маршрута
  // Нижний блок: цифры статистики (верх кегля) и всё, что ниже, включая бренд.
  // Кегль ≠ высота кадра глифа: рамка цифры уходит ВЫШЕ линии (stats.y -
  // numSize) на выносные, и без запаса её верх попадал в растушёвку —
  // замер давал цифрам 3.68:1 против 4.40:1 у подписей рядом.
  const botStart = (L.stats.y - L.stats.numSize * 1.3) / H;

  // Растушёвка — доля высоты кадра. ЛИНЕЙНОГО схода мало: у прямой два излома
  // (там, где она отходит от полки ALPHA, и там, где упирается в 0), а глаз
  // усиливает именно излом (полосы Маха) — короткий линейный сход и читался как
  // ПОЛОСА поперёк обложки, а не как затухание. Поэтому сход, во-первых, длиннее
  // (0.09 → 0.18 высоты кадра), во-вторых, идёт по smoothstep: на обоих концах
  // производная равна нулю, ломать нечего.
  //
  // Потолок длины задаёт сама раскладка: окно карты обязано остаться ЧИСТЫМ
  // (это пинит scrim_test), то есть сход не имеет права дотянуться до середины
  // окна. Самый тесный кадр — story с двухстрочным заголовком: там от низа
  // текста до середины окна ~0.21 высоты, поэтому 0.18 — с запасом, но у
  // предела; увеличивать дальше нельзя, не подвинув раскладку.
  const FADE = 0.18;
  const STEPS = 6; // промежуточных стопов на сход (кривая рисуется отрезками)
  const smooth = (t: number) => t * t * (3 - 2 * t); // smoothstep: гладко на обоих концах
  // Сход от полной непрозрачности в `from` к нулю в `from + dir*FADE`. Сам
  // `from` не повторяем — его несёт стоп-граница блока.
  const ramp = (from: number, dir: 1 | -1) =>
    Array.from({ length: STEPS }, (_, i) => {
      const t = (i + 1) / STEPS;
      return { o: from + dir * FADE * t, a: Number((ALPHA * (1 - smooth(t))).toFixed(4)) };
    });
  const stops = [
    { o: 0, a: ALPHA },
    { o: topEnd, a: ALPHA },
    ...ramp(topEnd, 1),
    ...ramp(botStart, -1).reverse(),
    { o: botStart, a: ALPHA },
    { o: 1, a: ALPHA },
  ];
  return stops.map((s) => st(s.o, s.a)).join('');
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x + rr},${y} h${w - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} `
    + `a${rr},${rr} 0 0 1 ${-rr},${rr} h${-(w - 2 * rr)} a${rr},${rr} 0 0 1 ${-rr},${-rr} `
    + `v${-(h - 2 * rr)} a${rr},${rr} 0 0 1 ${rr},${-rr} Z`;
}

// Ряд «Countries» под окном карты, ВНУТРИ кремовой рамки (повёрнут с ней): подпись
// слева (navy, bold) + круглые флаги ПО ЛЕВОМУ КРАЮ (сколько влезло) + «+N» сразу
// за последним флагом. Флаги не растягиваются по ширине.
function buildInFrameCountries(L: Layout, g: ReturnType<typeof windowGeom>, d: CardData, xf: string): string {
  const c = L.cap;
  const left = g.winX + 12; // padding-left рамки под окном (из прототипа)
  const rightPad = g.winX + g.winW; // правый край окна = правая граница ряда
  const cy = g.winY + g.winH + c.blockH / 2;
  const parts: string[] = [];
  // Подпись слева (одна строка), baseline по центру ряда.
  parts.push(text(left, cy + c.labSize * 0.34, c.labSize, d.visitedLabel, { weight: 700, fill: C.navy }));
  const labW = advance(d.visitedLabel, c.labSize, 700);
  // Флаги — от конца подписи + отступ, ПО ЛЕВОМУ КРАЮ с фиксированным шагом.
  const listLeft = left + labW + c.labGap;
  const total = d.flags.length;
  const step = c.flag + c.gap;
  const avail = rightPad - listLeft;
  let shown = Math.max(0, Math.min(total, Math.floor((avail + c.gap) / step)));
  const needChip = shown < total;
  if (needChip) {
    const availWithChip = avail - (c.flag + c.gap); // резервируем место под «+N»
    shown = Math.max(0, Math.min(total, Math.floor((availWithChip + c.gap) / step)));
  }
  let fx = listLeft + c.flag / 2;
  for (let i = 0; i < shown; i++) {
    parts.push(flagCircle(fx, cy, c.flag, c.ring, d.flags[i]));
    fx += step;
  }
  if (needChip) {
    const more = total - shown;
    const chipX = fx; // сразу за последним флагом (лево-выравнивание)
    parts.push(`<circle cx="${chipX}" cy="${cy}" r="${c.flag / 2}" fill="${C.gold}"/>`);
    parts.push(text(chipX, cy + c.moreSize * 0.34, c.moreSize, `+${more}`, { weight: 700, anchor: 'middle', fill: C.navyDeep }));
  }
  return `<g transform="${xf}">${parts.join('')}</g>`;
}

// Круглый флаг: флаг (встроен на edge), обрезанный кругом, + тонкое кольцо. Нет
// флага для кода ⇒ только кремовый круг с кольцом (не битая картинка).
function flagCircle(cx: number, cy: number, d: number, ring: number, cc: string): string {
  const r = d / 2;
  const uri = flagUri(cc);
  const ringEl = `<circle cx="${cx}" cy="${cy}" r="${r - ring / 2}" fill="none" stroke="${C.flagRing}" stroke-width="${ring}"/>`;
  if (!uri) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.cream}"/>${ringEl}`;
  const id = `fl-${cc}-${Math.round(cx)}`;
  return `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`
    + `<image href="${uri}" x="${cx - r}" y="${cy - r}" width="${d}" height="${d}" `
    + `preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>${ringEl}`;
}

// Колонки ряда статистики: 4 ячейки по содержимому, центрированы. Геометрия
// вынесена отдельно, потому что её читают ДВОЕ — золотые разделители (фигуры,
// остаются в SVG) и текст ячеек (уезжает в раскладку). Один расчёт на обоих.
function statsColumns(L: Layout, d: CardData): { x: number; cx: number; num: string; lab: string }[] {
  const cells = [
    { num: d.distanceStr, lab: d.kmLabel },
    { num: d.days, lab: d.daysLabel },
    { num: d.cities, lab: d.citiesLabel },
    { num: d.countries, lab: d.countriesLabel },
  ];
  const s = L.stats;
  const widths = cells.map((c) =>
    Math.max(advance(c.num, s.numSize, 700), advance(c.lab, s.labSize, 500)) + s.cellPad * 2);
  let x = (L.w - widths.reduce((a, b) => a + b, 0)) / 2;
  return cells.map((c, i) => {
    const col = { x, cx: x + widths[i] / 2, num: c.num, lab: c.lab };
    x += widths[i];
    return col;
  });
}

// Золотые разделители между ячейками статистики (текст ячеек — в buildCardText).
function statsSeparators(L: Layout, d: CardData): string {
  const s = L.stats;
  return statsColumns(L, d).slice(1)
    .map((col) => `<rect x="${Math.round(col.x)}" y="${s.y - s.numSize + 8}" width="2" height="${s.numSize + 10}" fill="${C.gold}" opacity="0.7"/>`)
    .join('');
}

// Логомарк «Triplanio» в левом нижнем углу — картинка (вордмарк рядом с ним
// уехал в buildCardText: он текст).
function buildBrandMark(L: Layout): string {
  const b = L.brand;
  // Лого со скруглёнными углами (как в макете): обрезаем <image> rounded-rect'ом
  // (clipPath logoClip объявлен в <defs> по геометрии этого формата).
  return `<image href="${LOGO_URI}" x="${L.padX}" y="${b.cy - b.logo / 2}" width="${b.logo}" height="${b.logo}" clip-path="url(#logoClip)"/>`;
}
