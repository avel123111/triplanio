// Мост «браузер → агент-прокси». НУЖЕН ТОЛЬКО ВНУТРИ ПЕСОЧНИЦЫ АГЕНТА, на
// машине разработчика запускать нечего — браузер там ходит в сеть сам.
//
// Зачем он есть. Исходящий HTTPS в песочнице идёт через политический прокси
// ($HTTPS_PROXY), который переподписывает TLS. Chromium через него не ходит: он
// шлёт свой ClientHello, и соединение рвётся ещё до CONNECT (проверено — на
// стороне прокси запрос даже не появляется). Поэтому TLS терминируем ЗДЕСЬ:
// браузеру отдаём локальный самоподписанный сертификат (он запускается с
// --ignore-certificate-errors), а наружу ходим сами через агент-прокси с его CA.
//
//   node scripts/agent/visual-bench/proxy-bridge.mjs      # слушает 127.0.0.1:8899
//
// Сертификат берётся из BENCH_CA_CERT/BENCH_CA_KEY, иначе генерируется рядом.
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.env.BENCH_PROXY_PORT || 8899);
const CA_BUNDLE = process.env.NODE_EXTRA_CA_CERTS || '/root/.ccr/ca-bundle.crt';
const upstream = new URL(process.env.HTTPS_PROXY || 'http://127.0.0.1:8080');

function selfSigned() {
  const dir = process.env.BENCH_CERT_DIR || path.join(os.tmpdir(), 'triplanio-bench');
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'bench.key'), cert = path.join(dir, 'bench.crt');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=triplanio-visual-bench'], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const CERT = process.env.BENCH_CA_CERT
  ? { key: fs.readFileSync(process.env.BENCH_CA_KEY), cert: fs.readFileSync(process.env.BENCH_CA_CERT) }
  : selfSigned();
const CA = fs.existsSync(CA_BUNDLE) ? fs.readFileSync(CA_BUNDLE) : undefined;

/** Один туннель на запрос: CONNECT к агент-прокси, поверх него настоящий TLS. */
function tunnel(opts, cb) {
  const raw = net.connect(Number(upstream.port), upstream.hostname, () => {
    raw.write(`CONNECT ${opts.host}:${opts.port} HTTP/1.1\r\nHost: ${opts.host}:${opts.port}\r\n\r\n`);
  });
  let done = false, buf = Buffer.alloc(0);
  raw.on('data', (d) => {
    if (done) return;
    buf = Buffer.concat([buf, d]);
    const i = buf.indexOf('\r\n\r\n');
    if (i < 0) return;
    done = true;
    const status = buf.slice(0, i).toString().split('\r\n')[0];
    if (!/ 200 /.test(status)) { raw.destroy(); cb(new Error(`upstream proxy: ${status}`)); return; }
    const sock = tls.connect({ socket: raw, servername: opts.host, ca: CA }, () => cb(null, sock));
    sock.on('error', cb);
  });
  raw.on('error', (e) => { if (!done) { done = true; cb(e); } });
}

class TunnelAgent extends https.Agent {
  createConnection(o, cb) { tunnel({ host: o.host, port: o.port || 443 }, cb); }
}
const agent = new TunnelAgent({ keepAlive: true, maxSockets: 32 });

// Внутренний HTTPS-сервер: сюда попадают уже расшифрованные запросы браузера.
const inner = https.createServer({ ...CERT, ALPNProtocols: ['http/1.1'] }, (req, res) => {
  const host = String(req.headers.host || '').split(':')[0];
  const headers = { ...req.headers };
  delete headers['accept-encoding'];
  const out = https.request({ host, port: 443, path: req.url, method: req.method, headers, agent }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  out.on('error', (e) => { console.error('bench-proxy', host, e.message); if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(out);
});
inner.listen(0, '127.0.0.1');

const proxy = http.createServer((_req, res) => { res.writeHead(400); res.end('CONNECT only'); });
proxy.on('connect', (_req, client, head) => {
  const start = () => {
    const s = net.connect(inner.address().port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) s.write(head);
      s.pipe(client); client.pipe(s);
    });
    s.on('error', () => client.destroy());
    client.on('error', () => s.destroy());
  };
  if (inner.listening) start(); else inner.once('listening', start);
});
proxy.listen(PORT, '127.0.0.1', () => console.log(`visual-bench proxy on 127.0.0.1:${PORT}`));
