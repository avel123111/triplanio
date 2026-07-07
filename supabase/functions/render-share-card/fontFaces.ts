/**
 * @font-face CSS for the share-card frame when it is rasterised IN THE BROWSER
 * (TRIP-193). The frame SVG is drawn by the client (overlay preview now; the final
 * raster later), so its text must not depend on whatever fonts the device happens
 * to have loaded - that is exactly what made the card "разъезжается на разных
 * устройствах". We embed the SAME font bytes the server render (resvg) uses, so
 * preview == final and the layout is device-invariant.
 *
 * The families/weights below are the REAL contents of the embedded FONT_B64 set
 * (verified from each file's `name`/`OS/2` tables), mapped to what the template
 * asks for:
 *   - Caveat 700          -> title + CTA (exact)
 *   - Montserrat 700      -> everything Montserrat; the template also asks 600/800,
 *                            which CSS nearest-matches to 700 (same as resvg), so a
 *                            single embedded 700 keeps preview == final.
 *   - Rubik ExtraBold 800 -> footer brand (the file's family name is literally
 *                            "Rubik ExtraBold"; the template references that name).
 * Each family ships as two subset files: digits + latin glyphs live ONLY in the
 * latin subset, cyrillic letters only in the cyrillic subset, so unicode-range
 * MUST route codepoints to the right file or numbers render as tofu.
 *
 * resvg ignores @font-face (it renders from the fontBuffers passed to it), so this
 * <style> is emitted only on the browser path and never reaches the edge renderer.
 */
import { FONT_B64 } from './assets_b64.ts';

// fontsource subset ranges (verbatim), so codepoints hit the file that has them.
const RANGE_LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const RANGE_CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';

type Face = { family: string; weight: number; subset: 'latin' | 'cyrillic'; idx: number };

// Index -> file mapping is fixed by how FONT_B64 was generated (even = cyrillic
// subset, odd = latin subset). Montserrat 400 (idx 4/5) is intentionally omitted:
// the template never asks for a weight below 600, and 600/800 nearest-match to 700.
export const FONT_FACES: Face[] = [
  { family: 'Caveat', weight: 700, subset: 'cyrillic', idx: 0 },
  { family: 'Caveat', weight: 700, subset: 'latin', idx: 1 },
  { family: 'Montserrat', weight: 700, subset: 'cyrillic', idx: 2 },
  { family: 'Montserrat', weight: 700, subset: 'latin', idx: 3 },
  { family: 'Rubik ExtraBold', weight: 800, subset: 'cyrillic', idx: 6 },
  { family: 'Rubik ExtraBold', weight: 800, subset: 'latin', idx: 7 },
];

/** The <style> block with every @font-face, embedding the font bytes as data URIs. */
export function fontFaceStyle(): string {
  const rules = FONT_FACES.map((f) => {
    const range = f.subset === 'latin' ? RANGE_LATIN : RANGE_CYRILLIC;
    return `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};`
      + `font-display:block;src:url(data:font/ttf;base64,${FONT_B64[f.idx]}) format('truetype');`
      + `unicode-range:${range};}`;
  }).join('');
  return `<style type="text/css">${rules}</style>`;
}
