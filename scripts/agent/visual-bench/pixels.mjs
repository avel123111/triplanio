// Замер ПО КАРТИНКЕ, а не по внутренним числам карты.
//
// Зачем отдельным модулем. Правило «свободное окно закрыто картой» нельзя
// проверить ни гардом, ни `map.getZoom()`: карта честно отвечает, что всё в
// порядке, а на экране вокруг планеты дымка. Единственный источник правды здесь
// — отрендеренные пиксели, поэтому здесь минимальный декодер PNG и один
// предикат «это не карта».
//
// ⚠️ Метрика «доля тёмных пикселей» НЕ ГОДИТСЯ и однажды уже стоила полудня:
// на дневном пресете космос вокруг шара СВЕТЛЫЙ (#DCEAF5). Смотреть надо обе
// семьи сразу — и тёмную, и светлую.
import zlib from 'node:zlib';
import fs from 'node:fs';

/** Минимальный декодер PNG (truecolor 8 бит, с альфой и без) — ровно то, что
 *  отдаёт `Page.captureScreenshot`. Зависимостей ради этого не заводим. */
export function readPng(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6)) throw new Error(`png: не поддержан формат ${depth}/${color}`);
  const bpp = color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, px: (x, y) => { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2]]; } };
}

/** «Не карта»: тёмный космос (ночной пресет) ИЛИ светлая дымка (дневной). */
export const offGlobePixel = ([r, g, b]) => (
  Math.max(r, g, b) < 70
  || (Math.abs(r - 220) < 14 && Math.abs(g - 234) < 14 && Math.abs(b - 245) < 14)
);

/**
 * Сколько точек РАМКИ свободного окна оказались вне планеты. Именно рамка, а не
 * доля площади: шар может закрывать середину и не доставать до углов — глазом
 * это читается как «глобус в круге», а средняя доля такого не показывает.
 * @returns {{ off: number, of: number, points: Array<[number, number]> }}
 */
export function borderOffGlobe(file, { x = 0, y = 0, w, h, steps = 10 } = {}) {
  const p = readPng(file);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const fx = x + 3 + Math.round((w - 7) * i / steps);
    const fy = y + 3 + Math.round((h - 7) * i / steps);
    pts.push([fx, y + 3], [fx, y + h - 4], [x + 3, fy], [x + w - 4, fy]);
  }
  const off = pts.filter(([px, py]) => offGlobePixel(p.px(px, py)));
  return { off: off.length, of: pts.length, points: off };
}

/**
 * Центр тяжести ВИДИМОЙ КАРТЫ в прямоугольнике и его сдвиг от центра самого
 * прямоугольника (в долях его размера).
 *
 * ★ ЗАЧЕМ ИМЕННО ЭТО. «Свободное окно закрыто картой» — предикат размытый: на
 * широком слоте шар законно виден целиком, и углы пустые, как на десктопе.
 * А вот СДВИГ центра размытым не бывает: ровно он и был дефектом — шар стоял по
 * центру экрана, тогда как свободным было только окно над шитом, и в нём оказывался
 * кусок планеты с краю. Центр карты обязан совпадать с центром свободного окна.
 *
 * @returns {{ dx: number, dy: number, coverage: number }} dx/dy — доли ширины и
 *   высоты (0 = ровно в центре); coverage — доля площади, занятая картой.
 */
export function mapCentroid(file, { x = 0, y = 0, w, h, step = 3 } = {}) {
  const p = readPng(file);
  let sx = 0, sy = 0, n = 0, total = 0;
  for (let yy = y; yy < y + h; yy += step) {
    for (let xx = x; xx < x + w; xx += step) {
      total++;
      if (offGlobePixel(p.px(xx, yy))) continue;
      sx += xx; sy += yy; n++;
    }
  }
  if (!n) return { dx: 1, dy: 1, coverage: 0 };
  return {
    dx: +((sx / n - (x + w / 2)) / w).toFixed(4),
    dy: +((sy / n - (y + h / 2)) / h).toFixed(4),
    coverage: +(n / total).toFixed(4),
  };
}
