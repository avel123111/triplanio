// Растровый двойник городского Ring-пина `.tmk` — для карт, которые СНИМАЮТСЯ в
// картинку (сегодня одна такая: карта share-карточки, TRIP-443).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Живые карты рисуют пины DOM-узлами (`createMarkerEl` +
// `mapboxgl.Marker`), и это правильно: облик целиком живёт в CSS (`.tmk*`),
// день/ночь приезжает каскадом, ролевые цвета — тоже. Но DOM-маркер — оверлей
// НАД canvas, а не его часть: снимок WebGL-канваса его не содержит. Карточка
// снимает именно канвас, поэтому её пины обязаны быть слоем карты (GL-иконкой).
//
// ЧТОБЫ ДВОЙНИК НЕ РАЗЪЕХАЛСЯ С ОРИГИНАЛОМ, он не описывает пин заново — он его
// ИЗМЕРЯЕТ. Сюда приходит настоящий `.tmk`, собранный тем же `createMarkerEl`,
// монтируется невидимо в документ (где действует тот же `app.css`), и с него
// снимаются готовые числа и цвета: размер ядра, толщина и цвет кольца, заливка,
// шрифт номера, границы ячеек слепленного пилюля, размер глифа. Правка `.tmk*` в
// CSS доезжает сюда сама. В коде НЕТ ни одного размера и ни одного цвета пина.
//
// Единственное, что подменяется, — базовые токены темы: карта карточки живёт со
// своей схемой (день/ночь), независимой от темы приложения, поэтому пробнику
// раздаются значения ТОЙ схемы (`schemeTokens`), а роль→цвет CSS разрешает сам.
import { createMarkerEl } from './markers';
import { schemeTokens } from './mapTokens';

// Токены, от которых зависит облик пина: `--tmk` роли (brand/success/warm/
// ev-transfer) и заливка ядра. Раздаются пробнику инлайном, дальше CSS.
const PIN_TOKENS = ['--brand', '--surface', '--success', '--warm', '--ev-transfer'];

// Растровое разрешение иконки. Иконка отдаётся mapbox с этим же `pixelRatio`,
// поэтому на карте она занимает СВОИ логические пиксели (29px ядра), но остаётся
// резкой на ретине и при съёмке карточки в полном разрешении.
export const PIN_DPR = 2;

// Поле вокруг пина под тень (логические px). Тень `.tmk__core` — blur 10 со
// сдвигом 3 вниз; поле симметричное, чтобы ЦЕНТР картинки совпадал с центром
// кольца: mapbox ставит иконку по центру, и несимметричное поле увело бы пин с
// координаты города.
const PIN_PAD = 14;

/** Хост-пробник: в документе (иначе CSS не применится), но вне видимости.
 *  `visibility:hidden`, а не `display:none` — раскладку надо ПОСЧИТАТЬ. */
let hostEl = null;
function host() {
  if (hostEl && hostEl.isConnected) return hostEl;
  hostEl = document.createElement('div');
  hostEl.setAttribute('aria-hidden', 'true');
  hostEl.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;contain:layout style;';
  document.body.appendChild(hostEl);
  return hostEl;
}

// Глиф роли рисуем НЕ разбором путей, а тем же SVG через <img>: разметку строит
// `createMarkerEl`, у отдельных подпутей там свои fill/stroke, и собственный
// парсер был бы третьей реализацией облика. `currentColor` внутри резолвится
// презентационным атрибутом `color` на корне <svg>.
const glyphCache = new Map();
function glyphImage(svgMarkup, color, px) {
  const key = `${px}|${color}|${svgMarkup}`;
  let p = glyphCache.get(key);
  if (p) return p;
  const svg = svgMarkup.replace(
    '<svg ',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" color="${color}" `,
  );
  p = new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null); // без глифа лучше, чем без пина
    im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  glyphCache.set(key, p);
  return p;
}

/** Путь-пилюля (радиус = половина высоты — ровно `var(--r-pill)` у `.tmk__core`). */
function pillPath(ctx, x, y, w, h) {
  const r = Math.min(h, w) / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Снять с живого `.tmk` всё, что нужно для отрисовки: геометрию ядра, цвета и
 * содержимое ячеек. Ничего не додумывает — только читает вычисленные стили.
 */
function measure(el) {
  const core = el.querySelector('.tmk__core');
  const cs = getComputedStyle(core);
  const cr = core.getBoundingClientRect();
  const border = parseFloat(cs.borderTopWidth) || 0;
  const px = (v) => parseFloat(v) || 0;

  // Ячейка = «что и каким цветом нарисовать» + её полоса внутри ядра. У
  // одиночного пина ячеек нет — само ядро и есть единственная ячейка.
  const cellEls = [...core.querySelectorAll('.tmk__h')];
  const sources = cellEls.length ? cellEls : [core];
  const cells = sources.map((node) => {
    const r = node.getBoundingClientRect();
    const ncs = getComputedStyle(node);
    const svg = node.querySelector('svg');
    return {
      x: r.left - cr.left,
      w: r.width,
      color: ncs.color,
      // Номер города — текстовый узел ячейки; глиф роли — вложенный <svg>.
      text: svg ? '' : (node.textContent || '').trim(),
      glyph: svg ? svg.outerHTML : '',
      glyphPx: svg ? px(getComputedStyle(svg).width) : 0,
      font: `${ncs.fontWeight} ${ncs.fontSize}/${px(ncs.fontSize)}px ${ncs.fontFamily}`,
    };
  });

  // Швы слепленного пилюля — скошенные полоски `currentColor` под opacity.
  // ТОЛЩИНУ берём из `offsetWidth`, а НЕ из `getBoundingClientRect()`: шов
  // скошен (`skewX`), и прямоугольник охвата у него шире самой полоски на всю
  // величину скоса — по нему шов рисовался жирной полосой вместо волоска.
  // Центр скошенного охвата, наоборот, совпадает с центром полоски
  // (`transform-origin` по умолчанию в середине), поэтому позицию берём из него.
  const seps = [...core.querySelectorAll('.tmk__sep')].map((node) => {
    const r = node.getBoundingClientRect();
    const scs = getComputedStyle(node);
    return {
      x: r.left - cr.left + r.width / 2,
      w: node.offsetWidth || px(scs.width),
      color: scs.backgroundColor,
      opacity: Number(scs.opacity) || 1,
      skew: -18, // единственное число, снять которое неоткуда: matrix ядра ≠ скос шва
    };
  });

  return {
    w: cr.width,
    h: cr.height,
    border,
    borderColor: cs.borderTopColor,
    background: cs.backgroundColor,
    shadow: cs.boxShadow,
    cells,
    seps,
  };
}

// Разобрать первую тень из `box-shadow` (offsetX offsetY blur color в любом
// порядке цвета). Нужна только мягкая посадка пина на карту; вторая, контактная,
// тень на растре в 29px неотличима — рисуем одну.
function firstShadow(boxShadow) {
  const s = String(boxShadow || '');
  const color = (s.match(/rgba?\([^)]+\)/) || ['rgba(20,24,40,.22)'])[0];
  const nums = (s.replace(/rgba?\([^)]+\)/g, '').match(/-?[\d.]+px/g) || []).map(parseFloat);
  return { color, dx: nums[0] || 0, dy: nums[1] || 0, blur: nums[2] || 0 };
}

/**
 * Иконка пина как ImageData (+ логический размер). `cells` — тот же массив
 * `{ kind, label }`, что уходит в `createMarkerEl` на живых картах, поэтому
 * слепленный пилюль, роль-глифы и номера получаются сами собой.
 *
 * @param {Array<{kind?: string, label?: any}>} cells
 * @param {{ scheme?: string }} opts — scheme: 'LIGHT' | 'DARK' (тема КАРТЫ)
 * @returns {Promise<{ data: ImageData, w: number, h: number }>}
 */
export async function pinImageData(cells, { scheme } = {}) {
  if (document?.fonts?.ready) { try { await document.fonts.ready; } catch { /* без ожидания */ } }

  const el = createMarkerEl(cells); // без колбэков — пробник не кликают
  const h = host();
  const tokens = schemeTokens(PIN_TOKENS, scheme);
  Object.entries(tokens).forEach(([k, v]) => { if (v) h.style.setProperty(k, v); });
  h.appendChild(el);
  let m;
  try { m = measure(el); } finally { el.remove(); }

  const W = m.w + PIN_PAD * 2;
  const H = m.h + PIN_PAD * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * PIN_DPR);
  canvas.height = Math.round(H * PIN_DPR);
  const ctx = canvas.getContext('2d');
  ctx.scale(PIN_DPR, PIN_DPR);

  // Ядро: тень → заливка → кольцо. Обводка идёт ПО СЕРЕДИНЕ линии, поэтому путь
  // ужимаем на полтолщины — так внешний край кольца совпадает с краем блока,
  // как у CSS-бордюра.
  const sh = firstShadow(m.shadow);
  const inset = m.border / 2;
  ctx.save();
  ctx.shadowColor = sh.color;
  ctx.shadowBlur = sh.blur;
  ctx.shadowOffsetX = sh.dx;
  ctx.shadowOffsetY = sh.dy;
  pillPath(ctx, PIN_PAD, PIN_PAD, m.w, m.h);
  ctx.fillStyle = m.background;
  ctx.fill();
  ctx.restore();
  pillPath(ctx, PIN_PAD, PIN_PAD, m.w, m.h);
  ctx.fillStyle = m.background;
  ctx.fill();

  // Содержимое ячеек — внутри ядра (у пилюля `overflow:hidden`).
  ctx.save();
  pillPath(ctx, PIN_PAD + inset, PIN_PAD + inset, m.w - m.border, m.h - m.border);
  ctx.clip();
  const cy = PIN_PAD + m.h / 2;
  const glyphs = await Promise.all(m.cells.map((c) => (
    c.glyph ? glyphImage(c.glyph, c.color, Math.max(1, Math.round(c.glyphPx * PIN_DPR))) : null
  )));
  m.cells.forEach((c, i) => {
    const cx = PIN_PAD + c.x + c.w / 2;
    const img = glyphs[i];
    if (img) {
      ctx.drawImage(img, cx - c.glyphPx / 2, cy - c.glyphPx / 2, c.glyphPx, c.glyphPx);
    } else if (c.text) {
      ctx.font = c.font;
      ctx.fillStyle = c.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text, cx, cy);
    }
  });
  m.seps.forEach((s) => {
    ctx.save();
    ctx.globalAlpha = s.opacity;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.w;
    const dx = Math.tan((s.skew * Math.PI) / 180) * (m.h / 2);
    ctx.beginPath();
    ctx.moveTo(PIN_PAD + s.x + dx, PIN_PAD);
    ctx.lineTo(PIN_PAD + s.x - dx, PIN_PAD + m.h);
    ctx.stroke();
    ctx.restore();
  });
  ctx.restore();

  pillPath(ctx, PIN_PAD + inset, PIN_PAD + inset, m.w - m.border, m.h - m.border);
  ctx.lineWidth = m.border;
  ctx.strokeStyle = m.borderColor;
  ctx.stroke();

  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height), w: W, h: H };
}

export default pinImageData;
