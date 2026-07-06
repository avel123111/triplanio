/**
 * SVG -> PNG rasterization via resvg-wasm (TRIP-193).
 *
 * Asset delivery is deliberately NOT via bundled static files: Supabase edge
 * does not serve files read through Deno.readFile(import.meta.url) (eszip ships
 * the module graph, not arbitrary files). So:
 *   - fonts + default background are embedded as base64 (assets_b64.ts),
 *   - the larger resvg wasm is fetched from a CDN once per isolate.
 * Everything is cached in module scope, so warm invocations skip all setup.
 * Local spike measured ~530ms warm for a full 1080x1920 card - well under the
 * 2s edge CPU limit (the wasm fetch is I/O, not CPU).
 *
 * Fonts ship BOTH latin and cyrillic subsets per family - digits and latin
 * glyphs live in the latin subset, so cyrillic-only files render them as tofu
 * (found during the TRIP-193 spike).
 */
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';
import { b64ToBytes, BG_DEFAULT_B64, FONT_B64 } from './assets_b64.ts';

const WASM_URLS = [
  'https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm',
  'https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm',
];

let wasmReady: Promise<void> | null = null;
let fontBuffers: Uint8Array[] | null = null;

async function initResvgOnce(): Promise<void> {
  let lastErr: unknown;
  for (const url of WASM_URLS) {
    try {
      await initWasm(fetch(url));
      return;
    } catch (e) {
      lastErr = e;
      console.error('resvg initWasm failed for', url, (e as Error).message);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('resvg initWasm failed');
}

async function ensureReady(): Promise<Uint8Array[]> {
  if (!wasmReady) wasmReady = initResvgOnce();
  await wasmReady;
  if (!fontBuffers) fontBuffers = FONT_B64.map(b64ToBytes);
  return fontBuffers;
}

/** The default background as a base64 data URI (no decode needed - already b64). */
export function defaultBgDataUri(): string {
  return `data:image/jpeg;base64,${BG_DEFAULT_B64}`;
}

/** Base64-encode bytes (for embedding the fetched map PNG into the SVG). */
export function base64(bin: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin[i]);
  return btoa(s);
}

/** Rasterize an SVG string to a PNG at the given output width. */
export async function renderPng(svg: string, width: number): Promise<Uint8Array> {
  const fonts = await ensureReady();
  const resvg = new Resvg(svg, {
    font: { fontBuffers: fonts, defaultFontFamily: 'Montserrat', loadSystemFonts: false },
    fitTo: { mode: 'width', value: width },
  });
  return resvg.render().asPng();
}
