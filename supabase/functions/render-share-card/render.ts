/**
 * SVG -> PNG rasterization via resvg-wasm (TRIP-193). The wasm binary and TTF
 * fonts are bundled as static files next to the function and read once per
 * isolate (cached in module scope), so warm invocations skip all setup. Local
 * spike measured ~530ms warm for a full 1080x1920 card — well under the 2s edge
 * CPU limit.
 *
 * Fonts: each family ships BOTH latin and cyrillic subsets — digits and latin
 * glyphs live in the latin subset, so cyrillic-only files render them as tofu
 * (found during the TRIP-193 spike).
 */
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';

const FONT_FILES = [
  'caveat700.ttf', 'caveat700_lat.ttf',
  'mont700.ttf', 'mont700_lat.ttf',
  'mont400.ttf', 'mont400_lat.ttf',
  'rubik800.ttf', 'rubik800_lat.ttf',
];

let wasmReady: Promise<void> | null = null;
let fontBuffers: Uint8Array[] | null = null;

function asset(rel: string): URL {
  return new URL(`./assets/${rel}`, import.meta.url);
}

async function ensureReady(): Promise<Uint8Array[]> {
  if (!wasmReady) {
    wasmReady = Deno.readFile(asset('resvg.wasm')).then((bin) => initWasm(bin));
  }
  await wasmReady;
  if (!fontBuffers) {
    fontBuffers = await Promise.all(FONT_FILES.map((f) => Deno.readFile(asset(`fonts/${f}`))));
  }
  return fontBuffers;
}

/** Read the default background as a base64 data URI (cached per isolate). */
let bgCache: string | null = null;
export async function defaultBgDataUri(): Promise<string> {
  if (!bgCache) {
    const bin = await Deno.readFile(asset('bg-default.jpg'));
    bgCache = `data:image/jpeg;base64,${base64(bin)}`;
  }
  return bgCache;
}

export function base64(bin: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin[i]);
  return btoa(s);
}

/** Rasterize an SVG string to a PNG (1080-wide fit). */
export async function renderPng(svg: string, width: number): Promise<Uint8Array> {
  const fonts = await ensureReady();
  const resvg = new Resvg(svg, {
    font: { fontBuffers: fonts, defaultFontFamily: 'Montserrat', loadSystemFonts: false },
    fitTo: { mode: 'width', value: width },
  });
  return resvg.render().asPng();
}
