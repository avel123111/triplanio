/**
 * gen-landing-maps.mjs — офлайн-генератор трёх карт маршрута для лендинга
 * (TRIP-445 / Ф6). Рендерит реальную карту OpenFreeMap (векторные тайлы OSM,
 * стиль `liberty`) через MapLibre в headless-Chromium, впекает обязательную
 * атрибуцию «© OpenStreetMap» в угол и кладёт webp в public/site/. В той же
 * проекции снимает пиксельные координаты городов — их (в масштабе viewBox)
 * прописываем пинами/маршрутом в src/pages/Landing/LandingPage.jsx.
 *
 * Почему так, а не рантайм-Mapbox (см. §5 TRIP-460 + разбор лицензий):
 *   — Mapbox/MapTiler ЗАПРЕЩАЮТ хранить и раздавать статик-картинки со своего
 *     сервера; OpenFreeMap (данные OSM, ODbL) — можно, нужна лишь атрибуция.
 *   — рендер наш → ноль рантайм-зависимостей, токенов и внешних запросов у
 *     посетителя лендинга; на выходе кэшируемый webp ~30–55 КБ.
 *
 * Запуск (ad-hoc, инструмент разработчика — НЕ часть build/CI):
 *   npm i -D maplibre-gl playwright-core sharp undici
 *   node scripts/gen-landing-maps.mjs
 * Требуется установленный Chromium (Playwright). Путь — env CHROME_BIN или
 * дефолт ниже. За прокси (напр. CI-песочница) задаётся HTTPS_PROXY + CA в
 * PROXY_CA; на обычной машине оба не нужны.
 *
 * После генерации: сверить напечатанные пины с координатами в LandingPage.jsx
 * (масштаб = viewBoxW / imageW). Города/рамки меняются в CONFIG ниже.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_SITE = path.join(DIR, '..', 'public', 'site');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const UPSTREAM = 'https://tiles.openfreemap.org';
const STYLE = process.env.OFM_STYLE || 'liberty';

// Города в реальных координатах [lng, lat]; порядок = порядок маршрута/пинов.
const C = {
  BCN: [2.1734, 41.3851], VLC: [-0.3763, 39.4699], MAD: [-3.7038, 40.4168],
  GIR: [2.8214, 41.9794], ZGZ: [-0.8891, 41.6488],
};
const CONFIG = [
  { name: 'map-pain',  w: 1280, h: 400, cities: [C.BCN, C.VLC, C.MAD], pad: 70 },
  { name: 'map-bento', w: 1280, h: 460, cities: [C.GIR, C.BCN, C.VLC, C.MAD], pad: 70 },
  { name: 'map-share', w: 1200, h: 260, cities: [C.BCN, C.ZGZ, C.MAD], pad: 55 },
];

// Node fetch через agent-proxy (только если задан HTTPS_PROXY, напр. в CI).
if (process.env.HTTPS_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import('undici');
  const ca = process.env.PROXY_CA && fs.existsSync(process.env.PROXY_CA)
    ? fs.readFileSync(process.env.PROXY_CA) : undefined;
  setGlobalDispatcher(new ProxyAgent({ uri: process.env.HTTPS_PROXY, requestTls: ca ? { ca } : undefined }));
}

const RENDER_HTML = (styleUrl, w, h, cities, pad) => `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#fff}#map{position:absolute;top:0;left:0}.maplibregl-ctrl{display:none!important}</style>
</head><body><div id="map"></div><script type="module">
import * as maplibregl from '/node_modules/maplibre-gl/dist/maplibre-gl.mjs';
const cities=${JSON.stringify(cities)};
const el=document.getElementById('map'); el.style.width=${w}+'px'; el.style.height=${h}+'px';
const map=new maplibregl.Map({container:'map',style:${JSON.stringify(styleUrl)},interactive:false,attributionControl:false,fadeDuration:0,pixelRatio:2});
const b=cities.reduce((a,c)=>a.extend(c),new maplibregl.LngLatBounds(cities[0],cities[0]));
map.fitBounds(b,{padding:${pad},duration:0});
window.__ready=false;
map.on('load',()=>map.once('idle',()=>{window.__pins=cities.map(c=>{const p=map.project(c);return [Math.round(p.x),Math.round(p.y)];});window.__ready=true;}));
</script></body></html>`;

let PORT;
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/ofm/')) { // reverse-proxy к OpenFreeMap (Chromium ходит только на localhost)
    const target = UPSTREAM + url.slice(4) + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
    try {
      const up = await fetch(target);
      const ct = up.headers.get('content-type') || 'application/octet-stream';
      if (ct.includes('json')) {
        const txt = (await up.text()).split(UPSTREAM).join(`http://127.0.0.1:${PORT}/ofm`);
        res.writeHead(up.status, { 'content-type': ct }); return res.end(txt);
      }
      res.writeHead(up.status, { 'content-type': ct }); return res.end(Buffer.from(await up.arrayBuffer()));
    } catch (e) { res.writeHead(502); return res.end(String(e)); }
  }
  if (url.startsWith('/node_modules/')) { // отдаём ESM-сборку maplibre из корня репо
    const fp = path.join(DIR, '..', url);
    if (fs.existsSync(fp)) { res.writeHead(200, { 'content-type': 'text/javascript' }); return fs.createReadStream(fp).pipe(res); }
  }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, r));
PORT = server.address().port;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
fs.mkdirSync(PUBLIC_SITE, { recursive: true });
const AW = 250, AH = 34; // плашка атрибуции
const attrSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${AW}" height="${AH}"><rect width="${AW}" height="${AH}" rx="7" fill="#fff" opacity=".66"/><text x="${AW - 10}" y="23" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="18" fill="#41515f">© OpenStreetMap</text></svg>`);

for (const m of CONFIG) {
  const styleUrl = `http://127.0.0.1:${PORT}/ofm/styles/${STYLE}`;
  const html = RENDER_HTML(styleUrl, m.w, m.h, m.cities, m.pad);
  const page = await browser.newPage({ viewport: { width: m.w, height: m.h } });
  await page.setContent(html, { waitUntil: 'load', baseURL: `http://127.0.0.1:${PORT}/` });
  await page.waitForFunction('window.__ready === true', { timeout: 45000 });
  const pins = await page.evaluate('window.__pins');
  const shot = await (await page.$('#map')).screenshot();
  const withAttr = await sharp(shot).composite([{ input: attrSvg, top: m.h - AH - 8, left: m.w - AW - 8 }]).png().toBuffer();
  await sharp(withAttr).webp({ quality: 82 }).toFile(path.join(PUBLIC_SITE, m.name + '.webp'));
  const k = m.name === 'map-bento' ? 640 / m.w : m.name === 'map-share' ? 598 / m.w : 608 / m.w; // viewBoxW/imageW
  const vb = pins.map(([x, y]) => [Math.round(x * k), Math.round(y * (m.name === 'map-pain' ? 190 / m.h : m.name === 'map-bento' ? 230 / m.h : 130 / m.h))]);
  console.log(`${m.name}: pins(viewBox) = ${JSON.stringify(vb)}`);
  await page.close();
}
await browser.close();
server.close();
console.log('done → public/site/map-*.webp');
