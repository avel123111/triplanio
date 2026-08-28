// ═══════════════════════════════════════════════════════════════════════════
// Ф0 — воспроизводимый стенд замера производительности (TRIP-475).
//
// ЗАЧЕМ. Три отчёта по этой задаче дали три разных набора цифр, и расхождения
// были не в интерпретации, а в СТЕНДЕ. Поэтому у оптимизации должен быть один
// измеритель, лежащий в репозитории, — и каждый PR несёт в теле три строки
// «до / после / дельта», снятые ИМ. Правка, не сдвинувшая число, не мёржится.
// (Это тот же принцип, что «CI-гард — это код, у него есть тест», на шаг раньше.)
//
// ЧТО ДЕЛАЕТ. Поднимает свежий `dist/` локальным сервером, ПОВТОРЯЯ прод-заголовки
// Vercel, гоняет Lighthouse mobile N раз (по умолчанию 3) и печатает МЕДИАНУ по
// пяти метрикам (score · FCP · LCP · TBT · CLS).
//
// ★ ГЛАВНАЯ ЛОВУШКА, ради которой этот стенд вообще нужен: ETag + ответ 304.
// Хешированный главный чанк отдаётся с `max-age=0, must-revalidate`, поэтому
// браузер обязан ПЕРЕПРОВЕРИТЬ его на втором обращении (modulepreload → импорт).
// Сервер без обработки `If-None-Match` отдаёт весь чанк ДВАЖДЫ и рисует FCP на
// секунды хуже, чем есть. Мы отвечаем 304 — как Vercel.
//
// ★ ТРЕТЬИ СТОРОНЫ (PostHog / Sentry / Google) из контейнера недостижимы и в
// любом случае искажают замер — блокируем их `blockedUrlPatterns`. Значит
// АБСОЛЮТНЫЙ балл здесь — нижняя граница по НАШЕМУ коду; для сравнения вариантов
// между собой (а это и есть задача PR) стенд корректен.
//
// ★ BROTLI. Прод отдаёт свои br-байты; локально мы жмём СВОЙ `dist` на
// фиксированном качестве. Абсолютные байты разойдутся с Vercel — это ожидаемо;
// важно, что ВСЕ варианты жмутся одинаково, поэтому дельта между ними честная.
//
// ЗАПУСК:  npx vite build && node scripts/perf/lh.mjs
//   аргументы: --runs=3  --path=/  --port=0  (0 = свободный порт)
//   env: CHROME_PATH=/путь/к/chrome  (иначе берётся Chromium из кэша Playwright)
//
// НЕ CI-гард: запускается руками, ничего не собирает и не деплоит.
// ═══════════════════════════════════════════════════════════════════════════
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlibC } from 'node:zlib';
import { createHash } from 'node:crypto';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'dist');

// ── аргументы ────────────────────────────────────────────────────────────────
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const RUNS = Number(arg('runs', '3'));
const PATHNAME = arg('path', '/');
const PORT = Number(arg('port', '0'));

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html не найден — сначала `npx vite build`.');
  process.exit(1);
}

// ── зеркало Cache-Control из vercel.json ──────────────────────────────────────
// Держим синхронно с `vercel.json` РУКАМИ: файл там — источник истины, здесь его
// парсить незачем (одно правило-регэксп на класс), но при правке vercel.json
// поправить и тут. Иначе стенд перестанет повторять прод.
const IMMUTABLE_DIR = /^\/(auth|covers|flags|fonts|hero|partners|site)\//;
const ICON_FILE = /^\/(og-cover\.jpg|og-join\.jpg|icon-192\.png|icon-512\.png|apple-touch-icon\.png|favicon\.ico|triplanio-logo\.svg)$/;
function cacheControlFor(urlPath) {
  if (IMMUTABLE_DIR.test(urlPath)) return 'public, max-age=31536000, immutable';
  if (ICON_FILE.test(urlPath)) return 'public, max-age=86400, stale-while-revalidate=604800';
  // Всё остальное, включая хешированные /assets/* и index.html — как Vercel:
  // обязательная перепроверка. Ровно она и обнажает ловушку 304.
  return 'public, max-age=0, must-revalidate';
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest', '.map']);

// ── предкомпрессия dist один раз ──────────────────────────────────────────────
// Ключ = URL-путь ('/assets/x.js'); значение = { raw, br, etag, type, cc }.
const files = new Map();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) { walk(abs); continue; }
    const urlPath = '/' + relative(DIST, abs).split('\\').join('/');
    const raw = readFileSync(abs);
    const ext = extname(abs).toLowerCase();
    const br = COMPRESSIBLE.has(ext)
      ? brotliCompressSync(raw, { params: { [zlibC.BROTLI_PARAM_QUALITY]: 11, [zlibC.BROTLI_PARAM_SIZE_HINT]: raw.length } })
      : null;
    const etag = '"' + createHash('sha1').update(raw).digest('hex').slice(0, 16) + '"';
    files.set(urlPath, { raw, br, etag, type: MIME[ext] || 'application/octet-stream', cc: cacheControlFor(urlPath) });
  }
}
walk(DIST);

function send(res, entry, req) {
  // 304 на совпавший If-None-Match — как Vercel; без этого чанк качается дважды.
  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, { ETag: entry.etag, 'Cache-Control': entry.cc });
    res.end();
    return;
  }
  const acceptsBr = (req.headers['accept-encoding'] || '').includes('br') && entry.br;
  const body = acceptsBr ? entry.br : entry.raw;
  const headers = {
    'Content-Type': entry.type,
    'Content-Length': body.length,
    ETag: entry.etag,
    'Cache-Control': entry.cc,
  };
  if (acceptsBr) headers['Content-Encoding'] = 'br';
  res.writeHead(200, headers);
  res.end(body);
}

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const entry = files.get(urlPath);
  if (entry) return send(res, entry, req);
  // SPA-фолбэк: любой не-файловый путь → index.html (rewrite Vercel в /index.html).
  return send(res, files.get('/index.html'), req);
});

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}${PATHNAME}`;
  console.log(`Стенд: ${url}  ·  прогонов: ${RUNS}  ·  br=q11 · 304 on\n`);

  const chromePath = process.env.CHROME_PATH || findChromium();
  const chrome = await launch({
    chromePath,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  const runs = [];
  try {
    for (let i = 0; i < RUNS; i++) {
      const { lhr } = await lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance'],
        // formFactor + mobile screen-emulation + simulated-throttling берутся из
        // дефолтного mobile-пресета Lighthouse — того же, что у PageSpeed mobile.
        blockedUrlPatterns: [
          '*posthog*', '*i.posthog.com*', '*sentry*', '*sentry.io*',
          '*google*', '*gstatic*', '*doubleclick*', '*vercel-insights*', '*vercel-scripts*',
        ],
      });
      const m = {
        score: Math.round(lhr.categories.performance.score * 100),
        fcp: lhr.audits['first-contentful-paint'].numericValue,
        lcp: lhr.audits['largest-contentful-paint'].numericValue,
        tbt: lhr.audits['total-blocking-time'].numericValue,
        cls: lhr.audits['cumulative-layout-shift'].numericValue,
      };
      runs.push(m);
      console.log(`  прогон ${i + 1}: score ${m.score} · FCP ${(m.fcp / 1000).toFixed(2)} · LCP ${(m.lcp / 1000).toFixed(2)} · TBT ${Math.round(m.tbt)} · CLS ${m.cls.toFixed(3)}`);
    }
  } finally {
    await chrome.kill();
    server.close();
  }

  const med = {
    score: median(runs.map((r) => r.score)),
    fcp: median(runs.map((r) => r.fcp)),
    lcp: median(runs.map((r) => r.lcp)),
    tbt: median(runs.map((r) => r.tbt)),
    cls: median(runs.map((r) => r.cls)),
  };
  console.log('\n── МЕДИАНА ─────────────────────────────');
  console.log(`  score : ${med.score}`);
  console.log(`  FCP   : ${(med.fcp / 1000).toFixed(2)} с`);
  console.log(`  LCP   : ${(med.lcp / 1000).toFixed(2)} с`);
  console.log(`  TBT   : ${Math.round(med.tbt)} мс`);
  console.log(`  CLS   : ${med.cls.toFixed(3)}`);
}

// Chromium из кэша Playwright (он уже стоит в проекте) — чтобы не тянуть свой.
function findChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(process.env.HOME || '', '.cache/ms-playwright'),
    '/data/.cache/ms-playwright',
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium-')) continue;
      const bin = join(root, dir, 'chrome-linux64/chrome');
      if (existsSync(bin)) return bin;
    }
  }
  return undefined; // пусть chrome-launcher поищет системный
}

main().catch((e) => { console.error(e); process.exit(1); });
