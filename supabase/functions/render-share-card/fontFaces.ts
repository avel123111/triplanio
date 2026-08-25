/**
 * @font-face CSS для share-карточки, которую растеризует БРАУЗЕР (TRIP-193→443).
 * Карточка рисуется клиентом (превью-overlay и финальный растр), поэтому её текст
 * не должен зависеть от шрифтов устройства — «разъезжается на разных девайсах».
 * Встраиваем ТЕ ЖЕ байты в @font-face, что и в приложении, чтобы превью == финал
 * и раскладка была device-invariant.
 *
 * Набор (TRIP-443, дизайн v34 — единственный шрифт):
 *   - Geologica 400..800 — заголовок/маршрут/цифры/подписи/бренд. Вариативный woff2
 *     (одна ось веса на сабсет), 4 сабсета из public/fonts/geologica — те же файлы
 *     и unicode-range, что грузит src/design/fonts.css.
 * Caveat (рукописное «My trip!»/«Scan to explore»), Montserrat/Rubik выпилены —
 * рукописного текста и QR в v34 нет.
 *
 * Server-side resvg больше НЕ используется (растр только в браузере), так что этот
 * <style> — единственный путь шрифтов; woff2 подходит (браузер).
 */
import { FONT_B64 } from './assets_b64.ts';

// unicode-range Geologica — verbatim из src/design/fonts.css (сабсеты fontsource).
const GEO_CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const GEO_CYRILLIC_EXT = 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F';
const GEO_LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
  + 'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const GEO_LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,'
  + 'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

type Face = {
  family: string;
  weight: string; // "700" или диапазон "400 800" для вариативного
  format: 'woff2';
  range: string;
  idx: number;
};

// idx → элемент FONT_B64 (порядок задан scripts/gen-share-card-assets.mjs).
const FONT_FACES: Face[] = [
  { family: 'Geologica', weight: '400 800', format: 'woff2', range: GEO_CYRILLIC, idx: 0 },
  { family: 'Geologica', weight: '400 800', format: 'woff2', range: GEO_CYRILLIC_EXT, idx: 1 },
  { family: 'Geologica', weight: '400 800', format: 'woff2', range: GEO_LATIN, idx: 2 },
  { family: 'Geologica', weight: '400 800', format: 'woff2', range: GEO_LATIN_EXT, idx: 3 },
];

const MIME: Record<Face['format'], string> = { woff2: 'font/woff2' };

/** <style> со всеми @font-face, шрифты — data-URI. */
export function fontFaceStyle(): string {
  const rules = FONT_FACES.map((f) =>
    `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};`
    + `font-display:block;src:url(data:${MIME[f.format]};base64,${FONT_B64[f.idx]}) format('${f.format}');`
    + `unicode-range:${f.range};}`).join('');
  return `<style type="text/css">${rules}</style>`;
}
