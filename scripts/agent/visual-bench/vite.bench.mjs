// Конфиг vite для визуального стенда: то же приложение, что и в проде, плюс два
// шва, которых в обычном `npm run dev` нет.
//
//   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… VITE_MAPBOX_TOKEN=… \
//     npx vite --config scripts/agent/visual-bench/vite.bench.mjs --host 127.0.0.1 --port 5173
//
// 1. `/api/*` → `<supabase>/functions/v1/*`. В проде это делает серверная
//    функция Vercel (`api/proxy.js`) по rewrite из `vercel.json`; локального
//    эквивалента нет, и без него не проходит даже загрузка профиля (getMe → 404),
//    то есть экран не открывается вообще.
// 2. `window.__map` — ручка на singleton карты, ТОЛЬКО для стенда. Инжектится
//    трансформом в `src/lib/mapbox.js` и в сборку приложения не попадает никогда:
//    этот конфиг живёт в scripts/, а не в корне.
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import base from '../../../vite.config.js';

const CA_BUNDLE = process.env.NODE_EXTRA_CA_CERTS || '';
const CA = CA_BUNDLE && fs.existsSync(CA_BUNDLE) ? fs.readFileSync(CA_BUNDLE) : undefined;
const PROXY = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;

/** Прямое соединение, а под агент-прокси — туннель через него. */
function connect(host, port, cb) {
  if (!PROXY) { const s = tls.connect({ host, port, servername: host, ca: CA }, () => cb(null, s)); s.on('error', cb); return; }
  const raw = net.connect(Number(PROXY.port), PROXY.hostname, () => {
    raw.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
  });
  let done = false, buf = Buffer.alloc(0);
  raw.on('data', (d) => {
    if (done) return;
    buf = Buffer.concat([buf, d]);
    if (buf.indexOf('\r\n\r\n') < 0) return;
    done = true;
    const s = tls.connect({ socket: raw, servername: host, ca: CA }, () => cb(null, s));
    s.on('error', cb);
  });
  raw.on('error', (e) => { if (!done) { done = true; cb(e); } });
}

class UpstreamAgent extends https.Agent {
  createConnection(o, cb) { connect(o.host, o.port || 443, cb); }
}
const agent = new UpstreamAgent({ keepAlive: true });

const apiProxy = {
  name: 'bench-api-proxy',
  configureServer(server) {
    const host = new URL(process.env.VITE_SUPABASE_URL).host;
    server.middlewares.use((req, res, next) => {
      if (!req.url.startsWith('/api/')) return next();
      const headers = { ...req.headers, host };
      delete headers['accept-encoding']; delete headers.connection; delete headers.cookie;
      const out = https.request({ host, port: 443, path: `/functions/v1${req.url.slice(4)}`, method: req.method, headers, agent }, (up) => {
        const h = { ...up.headers };
        delete h['content-encoding']; delete h['content-length']; delete h['transfer-encoding'];
        res.writeHead(up.statusCode || 502, h);
        up.pipe(res);
      });
      out.on('error', (e) => { console.error('bench-api', req.url, e.message); res.statusCode = 502; res.end(); });
      req.pipe(out);
    });
  },
};

const mapHandle = {
  name: 'bench-map-handle',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').endsWith('src/lib/mapbox.js')) return null;
    return `${code}
// [visual-bench] ручка на карту для замеров; в сборку приложения не попадает
if (typeof window !== 'undefined' && mapboxgl?.Map && !mapboxgl.__bench) {
  const Base = mapboxgl.Map;
  class BenchMap extends Base { constructor(...a) { super(...a); window.__map = this; } }
  mapboxgl.Map = BenchMap; mapboxgl.__bench = true;
}
`;
  },
};

const cfg = typeof base === 'function' ? await base({ command: 'serve', mode: 'development' }) : base;
cfg.plugins = [...(cfg.plugins || []), apiProxy, mapHandle];
export default cfg;
