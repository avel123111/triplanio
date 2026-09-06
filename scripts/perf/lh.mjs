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
// ★★ И СРАВНИВАЕТ ДВЕ СБОРКИ (`--vs`, TRIP-520). «Стало лучше» — утверждение о
// ДЕЛЬТЕ, а дельту нельзя снять с одной сборки: «до» живёт на проде, то есть на
// другой машине, в другой сети и под другой нагрузкой. Ровно на этом провалилась
// выпечка публичных страниц: три отчёта PageSpeed по ОДНОЙ И ТОЙ ЖЕ сборке дали
// 49, 54 и 69, и два дня ушло на спор о шуме, пока регресс (−19 пунктов,
// LCP +3.0 с — числа этого стенда) лежал на поверхности. `--vs=SKIP_PRERENDER=1` собирает контроль
// здесь же и мерит тем же браузером в том же прогоне.
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
// ★ СТЕНД СОБИРАЕТ dist САМ, с фейковым `VITE_SENTRY_DSN`. Без DSN `initSentry()`
// уходит в `if (!DSN) return`, SDK не грузится вовсе — и замер идёт по НЕ ТОМУ
// сценарию: на проде DSN есть, и любой условно-инициализируемый модуль (Sentry,
// аналитика) на стенде без него ведёт себя иначе, чем в проде. Фейковый DSN
// безопасен: `*sentry*` и так заблокирован `blockedUrlPatterns`, наружу ничего
// не уходит. (Дефект Ф0: раньше стенд мерил заранее собранный `dist`, и замер
// Ф1.4 без DSN показал нулевую дельту — «SDK мёртв, но скачан» vs «SDK нет».)
//
// ⚠ ПОБОЧКА: прогон ОСТАВЛЯЕТ `dist`, собранный с ФЕЙКОВЫМ Supabase (`.env.local`
// не виден `process.env`, поэтому `??=` берёт дефолт стенда) — следующий
// `npm run preview` молча пойдёт в `stand.supabase.co`. Пересобери перед preview.
//
// ★★ ЧЕГО ЭТОТ СТЕНД НЕ МЕРИТ — И ПОЧЕМУ ОБ ЭТОМ НАДО ЗНАТЬ (TRIP-520).
//
// Ни FCP, ни LCP не отвечают на вопрос «когда человек увидел СТРАНИЦУ».
// FCP говорит «что-то нарисовалось» — заставка тоже что-то. LCP говорит про
// ОДИН элемент и охотно переезжает на фотографию, как только страница её
// показывает. Speed Index под симуляцией Lantern (а это режим PageSpeed и наш)
// вырождается в FCP и тоже не помогает — поэтому его здесь нет.
//
// Замер TRIP-520, реальный троттлинг (4x CPU, 1.6 Мбит, DPR 2.625), одна
// машина, две сборки одного коммита:
//
//                              заголовок и текст   FCP    LCP    score
//   с выпечкой                        3.6 с        3.70   6.6    68
//   без выпечки (SKIP_PRERENDER=1)    8.0 с        3.08   3.6    86
//
// То есть выпечка отдаёт человеку весь текст на 4.4 секунды раньше и ПРИ ЭТОМ
// теряет 18 пунктов: у сборки без выпечки в момент замера на экране заставка и
// баннер согласия, и метрике нечего наказывать. Балл Lighthouse здесь мерит не
// то, ради чего задача делалась, — решение по нему одному принимать нельзя.
//
// ПОВТОРИТЬ (5 минут, playwright-core уже в проекте): собрать обе сборки
// (`npx vite build` и `SKIP_PRERENDER=1 npx vite build`), поднять обе
// `scripts/build/_serve.mjs` (фолбэки `app.html` и `index.html`), открыть каждую
// из playwright с `Network.emulateNetworkConditions` + `setCPUThrottlingRate: 4`
// и в `requestAnimationFrame` ждать, когда `document.body.innerText` перевалит
// за 1500 знаков.
//
// ЗАПУСК:  npm run perf:lh   (собирает dist сам — отдельный `vite build` не нужен)
//   ⚠ Аргументы идут ТОЛЬКО через `--`: `npm run perf:lh -- --vs=SKIP_PRERENDER=1`.
//   Без него npm флаг не передаёт и на `--vs` молча печатает СВОЮ версию, ничего
//   не измерив (код выхода 0 — отказ выглядит как успех).
//   аргументы: --runs=3  --path=/  --port=0  (0 = свободный порт)
//              --vs=KEY=VALUE[,KEY=VALUE]  — собрать ВТОРУЮ сборку с этим
//                окружением и напечатать дельту «контроль → HEAD».
//                Для страниц под выпечкой контроль — `--vs=SKIP_PRERENDER=1`.
//              --desktop  — десктопный пресет вместо мобильного.
//              --no-build  — повторить замер на УЖЕ собранном `dist` (разбор,
//                не приёмка). С `--vs` несовместим и отвергается: вариант — это
//                вторая СБОРКА, а не второй прогон.
//   env: CHROME_PATH=/путь/к/chrome  (иначе берётся Chromium из кэша Playwright)
//        VITE_SENTRY_DSN / VITE_SUPABASE_* — переопределяют дефолты стенда, если заданы
//
// НЕ CI-гард: запускается руками; СОБИРАЕТ dist (с фейковым DSN), не деплоит.
// ═══════════════════════════════════════════════════════════════════════════
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlibC } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

import desktopConfig from 'lighthouse/core/config/desktop-config.js';

import { SHELL_FILE } from '../build/prerenderPaths.mjs';

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
// Чем ВТОРАЯ сборка отличается от первой (`--vs=SKIP_PRERENDER=1`). Пусто — один
// вариант, как было. Разбор — у `main()`.
const VS = arg('vs', '');
// Повторить замер на УЖЕ собранном `dist` — для РАЗБОРА, не для приёмки: без
// сборки вариант `--vs` смысла не имеет, а «стенд собирает сам» остаётся
// умолчанием (см. шапку). Нужен, когда одну и ту же сборку смотрят несколько раз.
const NO_BUILD = process.argv.includes('--no-build');
// ★ ДЕСКТОП МЕРИТЬ ТОЖЕ (TRIP-520). Стенд знал только мобильный пресет, и это
// стоило слепого пятна: правки первого кадра трогают ОБА слоя раскладки, а
// проверялся один. Пресет — штатный `desktop-config` Lighthouse, тот же, что у
// вкладки «Ordenador» в PageSpeed.
const DESKTOP = process.argv.includes('--desktop');

// Собираем dist ЗДЕСЬ, с гарантированным окружением (см. докблок «★ СТЕНД
// СОБИРАЕТ dist САМ»). `??=` — явно заданный env (реальный DSN/Supabase) побеждает
// дефолт стенда. Supabase-дефолты нужны, чтобы приложение поднималось и без
// `.env.local` (CI): без них `#root` пуст и FCP/LCP врут.
//
// `extra` — окружение ВАРИАНТА (`--vs`): им и отличаются две сборки, которые
// стенд сравнивает между собой. Оно кладётся ПОВЕРХ process.env, потому что
// вариант — это и есть то, что мы задаём здесь и сейчас.
function buildDist(extra = {}) {
  const env = { ...process.env, ...extra };
  env.VITE_SENTRY_DSN ??= 'https://stand@o0.ingest.de.sentry.io/0';
  env.VITE_SUPABASE_URL ??= 'https://stand.supabase.co';
  env.VITE_SUPABASE_ANON_KEY ??= 'stand-anon-key';
  const marks = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`\nСборка dist${marks ? ` (${marks})` : ''} …`);
  execSync('npx vite build', { cwd: ROOT, env, stdio: 'inherit' });
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
  // /assets/* — ОТДЕЛЬНОЙ строкой намеренно: имя хешировано содержимым, поэтому
  // прод отдаёт build-output как `immutable` (правило `/assets/:path*` в
  // vercel.json). Держим синхронно: смена значения ТАМ — правка и ЗДЕСЬ, иначе
  // стенд перестанет повторять прод молча.
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  // Всё остальное, включая index.html — как Vercel: обязательная перепроверка.
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

// ── предкомпрессия dist ───────────────────────────────────────────────────────
// Ключ = URL-путь ('/assets/x.js'); значение = { raw, br, etag, type, cc }.
// Своя карта на КАЖДЫЙ вариант: сборки отличаются содержимым, и общая карта
// молча смешала бы их файлы.
function loadDist() {
  const files = new Map();
  const walk = (dir) => {
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
  };
  walk(DIST);
  return files;
}

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

// ★★ ФОЛБЭК — ОБОЛОЧКА, А НЕ `index.html` (TRIP-520). С приходом выпечки по
// `index.html` лежит ЛЕНДИНГ, а адреса без готового файла платформа отдаёт из
// `app.html` (`vercel.json`). Оставь стенд прежним — `/trips` и любой экран
// приложения мерились бы ЛЕНДИНГОМ, то есть замер шёл бы не по той странице.
// Имя берётся из того же модуля, что у `middleware.js` и `vite.config.js`.
// В сборке без выпечки (`--vs=SKIP_PRERENDER=1`) оболочки нет — там фолбэк
// снова `index.html`, и это верно: он там и есть оболочка.
//
// ★ КАТАЛОГ ОТДАЁТ СВОЙ index.html — тоже как платформа: `/es` и `/ru/d/…` это
// каталоги сборки. Без этого языковые адреса уходили бы в фолбэк, и мы мерили
// бы оболочку, думая, что меряем готовую страницу.
function makeServer(files) {
  const shell = files.has(`/${SHELL_FILE}`) ? `/${SHELL_FILE}` : '/index.html';
  return createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const entry = files.get(urlPath)
      || files.get(`${urlPath.replace(/\/$/, '')}/index.html`);
    if (entry) return send(res, entry, req);
    // /assets/* ИСКЛЮЧЕНЫ из фолбэка — как в vercel.json (TRIP-284): пропавший чанк
    // обязан отдавать 404, а не index.html под именем .js. Стенд повторяет прод, и
    // разъехаться им нельзя: именно на таком расхождении измерение начинает врать.
    if (urlPath.startsWith('/assets/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    return send(res, files.get(shell), req);
  });
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Померить ОДИН уже собранный `dist`: поднять стенд, прогнать Lighthouse RUNS
 * раз, вернуть прогоны. Chromium общий на все варианты — иначе сравнивались бы
 * не сборки, а два разных браузера.
 */
async function measureBuilt(chrome, label) {
  const files = loadDist();
  const server = makeServer(files);
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}${PATHNAME}`;
  console.log(`\nСтенд [${label}]: ${url}  ·  ${DESKTOP ? 'ДЕСКТОП' : 'мобайл'} ·  прогонов: ${RUNS}  ·  br=q11 · 304 on`);
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
      }, DESKTOP ? desktopConfig : undefined);
      const m = {
        score: Math.round(lhr.categories.performance.score * 100),
        fcp: lhr.audits['first-contentful-paint'].numericValue,
        lcp: lhr.audits['largest-contentful-paint'].numericValue,
        tbt: lhr.audits['total-blocking-time'].numericValue,
        cls: lhr.audits['cumulative-layout-shift'].numericValue,
      };
      runs.push(m);
      console.log(`  прогон ${i + 1}: score ${m.score} · FCP ${(m.fcp / 1000).toFixed(2)} · LCP ${(m.lcp / 1000).toFixed(2)} · TBT ${Math.round(m.tbt)} · CLS ${m.cls.toFixed(3)}`);
      // ★ КАКОЙ ЭЛЕМЕНТ Lighthouse счёл LCP (TRIP-475 шаг 5). Печатаем В КАЖДОМ
      // прогоне: правки меняют сам LCP-кандидат (ConsentBanner → lazy, затем
      // hero-фон, затем выпечка), поэтому приёмка «по LCP» без имени элемента
      // слепа — числа до и после несравнимы, если под ними разные элементы.
      const lcpAudit = lhr.audits['largest-contentful-paint-element'];
      const lcpNode = lcpAudit?.details?.items?.[0]?.items?.[0]?.node;
      console.log(`    LCP-элемент: ${lcpNode ? (lcpNode.nodeLabel || lcpNode.snippet || lcpNode.selector) : '—'}`);
      // ★ ИЗ ЧЕГО СЛОЖИЛСЯ LCP. Без разбивки «LCP вырос» не говорит, ЧТО чинить:
      // «ждали, пока о картинке узнают» (Load Delay) лечится объявлением ресурса,
      // «качали» (Load Time) — весом файла, «нарисовали позже» (Render Delay) —
      // занятым главным потоком. Это три разные правки, и путать их дорого.
      const phases = lcpAudit?.details?.items?.[1]?.items || [];
      if (phases.length) {
        console.log(`    фазы LCP: ${phases.map((x) => `${x.phase} ${Math.round(x.timing)}`).join(' · ')}`);
      }
    }
  } finally {
    server.close();
  }
  return runs;
}

const summarize = (runs) => ({
  score: median(runs.map((r) => r.score)),
  fcp: median(runs.map((r) => r.fcp)),
  lcp: median(runs.map((r) => r.lcp)),
  tbt: median(runs.map((r) => r.tbt)),
  cls: median(runs.map((r) => r.cls)),
});

async function main() {
  // ★★ ВАРИАНТ СРАВНЕНИЯ — ЭТО ВТОРАЯ СБОРКА, А НЕ ВТОРОЙ ПРОГОН (TRIP-520).
  //
  // Стенд умел мерить ОДИН `dist`, и этого не хватило ровно там, где было нужно
  // больше всего: выпечка публичных страниц уронила мобильный LCP, а сравнить
  // было не с чем — «до» существовало только на проде, то есть на другой машине,
  // в другой сети и под другой нагрузкой. Три отчёта PageSpeed по одной и той же
  // сборке дали 49, 54 и 69: по такому разбросу вопрос «стало лучше или хуже»
  // не решается в принципе.
  //
  // Контроль обязан собираться ЗДЕСЬ ЖЕ и мериться ТЕМ ЖЕ браузером в том же
  // прогоне. `--vs=KEY=VALUE` задаёт, чем вторая сборка отличается от первой;
  // для этой задачи контроль — `SKIP_PRERENDER=1`, то есть «то же приложение без
  // выпечки».
  const variants = [{ label: 'HEAD', env: {} }];
  if (VS) {
    // ★ Иначе оба варианта померились бы на ОДНОМ И ТОМ ЖЕ `dist`, дельта вышла
    // бы нулевой, и «правка ничего не изменила» стало бы выводом. Стенд заведён
    // ровно против таких зелёных отчётов, поэтому отказ громкий.
    if (NO_BUILD) throw new Error('--no-build несовместим с --vs: вариант — это ВТОРАЯ сборка, а не второй прогон');
    variants.push({
      label: VS,
      env: Object.fromEntries(VS.split(',').map((pair) => {
        const eq = pair.indexOf('=');
        if (eq < 1) throw new Error(`--vs: ожидается KEY=VALUE через запятую, получено «${pair}»`);
        return [pair.slice(0, eq).trim(), pair.slice(eq + 1)];
      })),
    });
  }

  const chromePath = process.env.CHROME_PATH || findChromium();
  const chrome = await launch({
    chromePath,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  const measured = [];
  try {
    for (const v of variants) {
      if (!NO_BUILD) buildDist(v.env);
      measured.push({ label: v.label, med: summarize(await measureBuilt(chrome, v.label)) });
    }
  } finally {
    await chrome.kill();
  }

  // ★ Медиана берётся по КАЖДОЙ метрике НЕЗАВИСИМО — напечатанная пятёрка может
  // не совпасть ни с одним отдельным прогоном. Это осознанно (устойчивый сводный
  // показатель на метрику), поэтому построчные прогоны выше остаются главным
  // артефактом отчёта, а сводку помечаем явно.
  console.log('\n── МЕДИАНА (по каждой метрике независимо) ──');
  const fmt = (m) => [
    `score ${String(m.score).padStart(3)}`,
    `FCP ${(m.fcp / 1000).toFixed(2)} с`,
    `LCP ${(m.lcp / 1000).toFixed(2)} с`,
    `TBT ${String(Math.round(m.tbt)).padStart(4)} мс`,
    `CLS ${m.cls.toFixed(3)}`,
  ].join(' · ');
  for (const m of measured) console.log(`  ${m.label.padEnd(22)} ${fmt(m.med)}`);

  if (measured.length === 2) {
    // Дельта считается ОТ КОНТРОЛЯ К HEAD — то есть «что сделал этот PR».
    const [head, base] = measured;
    const d = (k) => head.med[k] - base.med[k];
    const sign = (x, digits = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;
    console.log(`\n── ДЕЛЬТА  ${base.label} → HEAD  (минус у времени = быстрее) ──`);
    console.log(`  score : ${sign(d('score'))}`);
    console.log(`  FCP   : ${sign(d('fcp') / 1000, 2)} с`);
    console.log(`  LCP   : ${sign(d('lcp') / 1000, 2)} с`);
    console.log(`  TBT   : ${sign(d('tbt'))} мс`);
    console.log('\n  ⚠️ Обе медианы и эта дельта — обязательный артефакт в теле PR (см. шапку файла).');
  }
}

// Chromium из кэша Playwright (он уже стоит в проекте) — чтобы не тянуть свой.
// ★ Раскладка кэша разнится между машинами: путь бывает `chrome-linux64/chrome`
// И `chrome-linux/chrome`, плюс отдельная сборка `chromium_headless_shell-*`.
// Перебираем ВСЕ известные варианты — иначе стенд молча уедет на СИСТЕМНЫЙ Chrome
// другой версии, то есть на другой измеритель, ровно против чего он и заведён.
function findChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(process.env.HOME || '', '.cache/ms-playwright'),
    '/data/.cache/ms-playwright',
  ].filter(Boolean);
  const candidates = [
    ['chromium-', 'chrome-linux64/chrome'],
    ['chromium-', 'chrome-linux/chrome'],
    ['chromium_headless_shell-', 'chrome-headless-shell-linux64/chrome-headless-shell'],
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      for (const [prefix, tail] of candidates) {
        if (!dir.startsWith(prefix)) continue;
        const bin = join(root, dir, tail);
        if (existsSync(bin)) return bin;
      }
    }
  }
  return undefined; // пусть chrome-launcher поищет системный
}

main().catch((e) => { console.error(e); process.exit(1); });
