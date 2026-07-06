/**
 * QR for the card (TRIP-193). Pure-JS matrix -> SVG rects (no canvas), so it
 * rasterizes crisply inside the resvg SVG and needs no external image. The URL
 * is the fixed landing + UTM, so the QR is identical for a given format and can
 * be cached in the isolate.
 */
import QRCode from 'npm:qrcode@1.5.4';

/**
 * Build QR modules as SVG `<rect>`s positioned at (x, y) filling `size` px.
 * Dark modules are merged into horizontal runs to keep the element count low.
 * `bg` draws a white quiet-zone plate behind the modules.
 */
export function qrSvg(url: string, x: number, y: number, size: number): string {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n: number = qr.modules.size;
  const data: Uint8Array = qr.modules.data;
  const pad = size * 0.08; // quiet zone
  const inner = size - pad * 2;
  const cell = inner / n;

  const rects: string[] = [];
  for (let row = 0; row < n; row++) {
    let runStart = -1;
    for (let col = 0; col <= n; col++) {
      const dark = col < n && data[row * n + col] === 1;
      if (dark && runStart < 0) runStart = col;
      if (!dark && runStart >= 0) {
        const rx = x + pad + runStart * cell;
        const ry = y + pad + row * cell;
        const rw = (col - runStart) * cell;
        rects.push(`<rect x="${rx.toFixed(2)}" y="${ry.toFixed(2)}" width="${rw.toFixed(2)}" height="${cell.toFixed(2)}"/>`);
        runStart = -1;
      }
    }
  }
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="14" fill="#ffffff"/>` +
    `<g fill="#0b1220">${rects.join('')}</g>`
  );
}
