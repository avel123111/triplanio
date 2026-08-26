#!/usr/bin/env node
/**
 * Скриншот-диф «прототип ↔ реализация» — приёмка Ф6 (TRIP-460, раздел «★ Приёмка»).
 *
 * ЗАЧЕМ. Ни один гард репозитория не меряет СХОДСТВО С МАКЕТОМ: check:design,
 * 2ac, 2ae, 2p меряют инварианты кода. Пока эталон не подставлен рядом, «зелёно»
 * и «похоже» — независимые вещи; именно так два дня подряд получались зелёные
 * отчёты на непохожей странице.
 *
 * КАК ЗАПУСКАТЬ.
 *   1. Прототип: вложение Linear на TRIP-445 (три документа в <script type="text/html">,
 *      `</script` внутри экранирован как @@SCRIPT_END@@). Распаковать нужный id
 *      (src-landing / src-auth / src-demo) в отдельный .html.
 *   2. Прототип тянет ВНЕШНИЕ ресурсы, которых в песочнице нет. Оба надо
 *      локализовать, иначе диф меряет не вёрстку, а недогруз:
 *        · фото — https://www.triplanio.com/hero/* → относительный путь плюс
 *          public/hero рядом (без этого hero даёт 86% на пустом фоне);
 *        · шрифты — <link> на fonts.googleapis.com → вырезать и вставить
 *          @font-face из src/design/fonts.css плюс public/fonts рядом. Пока
 *          прототип рендерится системным шрифтом, а реализация — Golos, любой
 *          текстовый блок расходится по метрикам: tg-sec 26.5% → 19.0%,
 *          audience 15.9% → 9.8% после одной этой подстановки.
 *   3. Поднять два статических сервера (прототип и dist) и передать их URL.
 *
 * ГОТОВЫЙ РЕЦЕПТ, воспроизведён целиком (TRIP-460). Команда — `npm run check:proto`;
 * в CI её нет и не будет: эталон живёт вложением в Linear, а не в репозитории,
 * поэтому это команда исполнителя, а её результат — обязательный артефакт в теле
 * PR. `playwright-core` с этого же PR лежит в devDependencies: до него харнесс
 * не запускался на чистом `npm ci` вовсе, что и было половиной причины, почему
 * приёмку не гоняли.
 *
 *   # 1. прототип из вложения TRIP-445 (id 524d40e9-cd15-43c1-8cf1-c64a32d6d98a)
 *   #    mcp__Linear__get_attachment → вырезать <script id="src-landing">,
 *   #    заменить @@SCRIPT_END@@ на </script  →  /tmp/proto/index.html
 *   # 2. локализовать ОБА внешних ресурса (см. п.2 выше):
 *   #    hero:    'https://www.triplanio.com/hero/' → '/hero/'  + cp -r public/hero /tmp/proto/
 *   #    шрифты:  вырезать <link> на fonts.googleapis/gstatic + preconnect,
 *   #             вставить @font-face 400 800 на /fonts/{onest,golos}/*.woff2
 *   #             + cp -r public/fonts/{onest,golos} /tmp/proto/fonts/
 *   # 3. сборка ОБЯЗАТЕЛЬНО с заглушками, иначе пустой <body>:
 *   VITE_SUPABASE_URL="https://example.supabase.co" \
 *   VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.x" \
 *   npx vite build
 *   # 4. два сервера (file:// в Playwright заблокирован)
 *   #    ★ реализацию отдаёт ТОЛЬКО SPA-сервер: `python3 -m http.server` на
 *   #    /d/... и /terms отвечает 404, и харнесс честно сравнил бы страницу
 *   #    ошибки. Проверено: python 404, `vite preview` 200. Прототип — статика,
 *   #    ему любой сервер годится.
 *   (setsid npx vite preview --port 4173 --strictPort &) ; (cd /tmp/proto && setsid python3 -m http.server 8098 &)
 *   # 5. обе ширины — 390 не опциональна, на ней расхождения ВЫШЕ
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *   npm run check:proto -- --proto http://127.0.0.1:8098/ --impl http://127.0.0.1:4173/ --width 1440 --height 900
 *   npm run check:proto -- --proto http://127.0.0.1:8098/ --impl http://127.0.0.1:4173/ --width 390  --height 844
 *   # ...и так по каждой странице зоны: адреса указывают НА ОДНУ И ТУ ЖЕ
 *   # страницу с обеих сторон (демо ↔ демо, юр ↔ юр). Секции харнесс находит
 *   # сам; `--sections` нужен, только чтобы сузить.
 *   # 6. по каждой секции выше порога — структурный разбор:
 *   npm run check:proto -- ... --elements <секция>
 *
 * ★ ГДЕ ПРОЦЕНТ СЛЕП СОВСЕМ. На полноэкранной градиентной секции (`final`) он
 * НАСЫЩЕН: любая правка цвета красит все пиксели и даёт 90–96% одинаково —
 * «чуть глубже» и «серая грязь» для него неразличимы. Однажды по вердикту
 * «98% = грязь» откатили правку контраста и вернули WCAG-дефект. Такие секции
 * решаются глазами и замером контраста, а не этим числом.
 *
 * КАК ЧИТАТЬ ПРОЦЕНТ. Это доля различающихся пикселей, и на плотном тексте она
 * ЗАВЫШАЕТ: сдвиг строки на 1px перекрашивает все глифы строки, давая 15-25%
 * там, где вёрстка совпадает. Проверено на этом лендинге: share 19.6%, tg-sec
 * 19.0% — а структурный разбор показал сдвиги 1-9px, то есть совпадение.
 * Поэтому процент — ТРИАЖ, а не вердикт: он говорит «посмотри сюда», а что
 * именно разъехалось, отвечает режим --elements (позиции, размеры и кегли
 * элементов секции). Настоящий дефект виден там сдвигом в десятки пикселей:
 * у `pain` высота 1507 против 985 и смещение блоков на 667px.
 *
 * ЧТО ХАРНЕСС УБИРАЕТ ИЗ ЗАМЕРА (иначе числа врут и гонят чинить исправное):
 *   · баннер согласия (.consent) и его плавающая кнопка (.ci-root/.ci-launch) —
 *     компоненты приложения, в прототипе их нет;
 *   · фазы reveal/scrub — обе стороны форсятся в финальное состояние (класс `in`),
 *     иначе одна снята на середине анимации, вторая — в конце;
 *   · разъезд точки скролла — секция позиционируется по своей координате, а не
 *     scrollIntoViewIfNeeded, который упирает её под фикс-шапку.
 * Проверено на этом же лендинге: hero 85.9% → 11.1%, bento 27.7% → 13.5% после
 * снятия трёх артефактов; настоящие дефекты (кнопки, бюджет, документы, CTA)
 * при этом остались видны.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { sectionKey, parseOnly, parseAliases, commonSections } from './proto-sections.mjs';

// Список секций БОЛЬШЕ НЕ КОНСТАНТА. Он был константой лендинга, и на демо и
// юр-страницах не находилась ни одна: каждая печатала «нет секции с одной из
// сторон», счётчик оставался нулём, отчёт заканчивался «худшая секция: 0%» и
// кодом выхода 0 — приёмка рапортовала идеальным совпадением страницу, которую
// не открывала. Теперь секции берутся С САМИХ СТРАНИЦ и сравнивается их
// пересечение (имена классов у порта и прототипа общие по построению),
// а `--sections` только СУЖАЕТ этот список.
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.env.OUT_DIR || '/tmp/proto-diff';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const PROTO = arg('proto'), IMPL = arg('impl');
const ONLY = parseOnly(arg('sections'));
// Секция реализации, названная в макете иначе (`--alias dm-hero=hero`).
// Без этого намеренное переименование выбрасывает секцию из приёмки МОЛЧА.
const ALIAS = parseAliases(arg('alias'));
const W = +arg('width', 1440), H = +arg('height', 900);
const LANG = arg('lang', 'en');
if (!PROTO || !IMPL) {
  console.error('нужны --proto <url> и --impl <url>; см. докблок');
  process.exit(2);
}

/** Обе стороны — в одном состоянии: без баннера согласия, анимации доиграны. */
const SETTLE = `
  .consent, .ci-root, [class*="ci-launch"] { display: none !important; }
  /* Только ВИДИМОСТЬ. Reveal на этом лендинге ДВУНАПРАВЛЕННЫЙ: наблюдатель
     снимает класс in, когда секция уходит вверх, — и блок, добавленный нами
     руками, снова гаснет к моменту съёмки (телефон «Ассистента» пропадал
     целиком, хотя в DOM он на месте: top 604, высота 719).
     transform НЕ трогаем: forced transform:none перебивает конечное
     состояние анимации и раздувает диф (hero 11% против 48%). */
  .rv, .rv-l, .rv-r { opacity: 1 !important; }
`;

async function capture(browser, url, tag) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: SETTLE });

  // Локаль: макет и реализация переключаются своими же кнопками языка, иначе
  // сравнивается английская вёрстка с русской. Русские строки длиннее — часть
  // расхождений видна ТОЛЬКО на ru.
  if (LANG && LANG !== 'en') {
    await page.evaluate(async (lang) => {
      const opener = document.querySelector('.lang-btn') || document.querySelector('.lang button');
      if (opener) { opener.click(); await new Promise((r) => setTimeout(r, 350)); }
      // строгий выбор: сначала data-lang, потом ТОЧНОЕ имя языка. Свободный
      // regex по тексту цеплял последний подходящий пункт и уводил на другую
      // локаль (ru → es), а раскрытое меню ещё и закрывало пол-секции.
      const label = { ru: 'Русский', es: 'Español', en: 'English' }[lang];
      const items = [...document.querySelectorAll('[data-lang], .lang-menu button, .lang-menu a, .mobile-menu button')];
      const target = items.find((el) => el.dataset?.lang === lang)
        || items.find((el) => (el.textContent || '').trim() === label)
        || items.find((el) => (el.textContent || '').trim().startsWith(lang.toUpperCase()));
      if (target) target.click();
      await new Promise((r) => setTimeout(r, 400));
      // закрыть выпадающее меню, чтобы оно не попало в кадр
      document.body.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }, LANG);
    await page.waitForTimeout(1200);
  }

  // Что на странице вообще есть — в порядке документа. Ключ секции считает
  // общий модуль (`proto-sections.mjs`), поэтому в браузер уезжают только сырые
  // атрибуты class.
  const classes = await page.$$eval('section', (els) => els.map((el) => el.getAttribute('class') || ''));
  const order = [];
  for (const cls of classes) {
    const key = sectionKey(cls);
    if (key && !order.includes(key)) order.push(key);
  }

  const found = {};
  // ПЕРВАЯ секция документа снимается до прокрутки: она живёт на первом экране и
  // реагирует на скролл (параллакс, hover-кадр, затухание). Снятая после прогона
  // по всей высоте — даже с возвратом в 0 — она сравнивается в другой фазе: на
  // лендинге 11% против 37% и 83% в зависимости от момента съёмки. Раньше здесь
  // стояло имя `hero` строкой, и на демо (первый экран — `dm-hero`) правило
  // молча не срабатывало.
  const first = order[0];
  if (first) {
    const el = await page.$(`section.${first}`);
    const box = el && await el.boundingBox();
    if (box) {
      const file = path.join(OUT, `${tag}-${first}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: Math.min(box.height, 2400) } });
      found[first] = file;
    }
  }

  // прогон по всей высоте: поднимает ленивые слои и доводит скрабы до конца
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 350) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 45));
    }
  });
  // финальную фазу reveal доводит сам сайт — мы лишь добавляем его же класс и
  // ждём конец transition. CSS-форс (opacity/transform !important) здесь ВРЕДЕН:
  // он перебивает штатное конечное состояние и раздувает диф (проверено: hero
  // 11% → 48% от одного `transform:none`).
  await page.evaluate(() => { document.querySelectorAll('.rv,.rv-l,.rv-r').forEach((el) => el.classList.add('in')); });
  await page.waitForTimeout(1400);

  for (const name of order) {
    if (name === first) continue; // снята выше, до прогона
    const el = await page.$(`section.${name}`);
    if (!el) continue;
    // hero живёт на первом экране и реагирует на скролл (параллакс/затухание):
    // снимать его надо с верха страницы, иначе сравниваются разные фазы — на этом
    // лендинге разница между «сверху» и «после прокрутки» составила 11% против 37%.
    const top = await el.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
    await page.evaluate((y) => window.scrollTo(0, y), top);
    await page.waitForTimeout(700);
    const box = await el.boundingBox();
    if (!box) continue;
    const file = path.join(OUT, `${tag}-${name}.png`);
    // Снимок САМОГО элемента, а не окна: секция бывает выше вьюпорта (на 390
    // «Ассистент» — 1391px против 844), и кадр по вьюпорту ловил у сторон РАЗНЫЕ
    // куски. Так телефон-мокап попадал в кадр макета и не попадал в кадр
    // реализации — на глаз читалось как «блок пропал», хотя он на месте (замер
    // --elements: top 606/604, высота 726/719).
    await el.screenshot({ path: file });
    found[name] = file;
  }
  await ctx.close();
  return { found, order };
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

/** Структурный разбор одной секции: что и на сколько сдвинуто. */
async function elements(url, section) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: SETTLE });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 350) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    document.querySelectorAll('.rv,.rv-l,.rv-r').forEach((el) => el.classList.add('in'));
  });
  await page.waitForTimeout(1200);
  const data = await page.evaluate((sel) => {
    const root = document.querySelector('section.' + sel);
    if (!root) return null;
    const base = root.getBoundingClientRect();
    const items = [];
    const walk = (node, depth) => {
      if (depth > 4) return;
      for (const child of node.children) {
        const r = child.getBoundingClientRect();
        if (r.width >= 2 && r.height >= 2) {
          const cls = String(child.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
          items.push({
            k: child.tagName.toLowerCase() + (cls ? '.' + cls : ''),
            t: Math.round(r.top - base.top), l: Math.round(r.left),
            w: Math.round(r.width), h: Math.round(r.height),
            fs: getComputedStyle(child).fontSize,
          });
        }
        walk(child, depth + 1);
      }
    };
    walk(root, 0);
    return { h: Math.round(base.height), items };
  }, section);
  await ctx.close();
  return data;
}

const SECTION = arg('elements');
if (SECTION) {
  const [p, i] = [await elements(PROTO, SECTION), await elements(IMPL, SECTION)];
  if (!p || !i) { console.error(`секции .${SECTION} нет с одной из сторон`); await browser.close(); process.exit(2); }
  console.log(`\nsection.${SECTION} · ${W}px · высота: макет ${p.h} / реализация ${i.h} (${i.h - p.h >= 0 ? '+' : ''}${i.h - p.h})\n`);
  console.log('элемент'.padEnd(30) + 'top'.padStart(15) + 'left'.padStart(15) + 'высота'.padStart(15) + '   кегль');
  const byKey = new Map();
  for (const it of p.items) { if (!byKey.has(it.k)) byKey.set(it.k, []); byKey.get(it.k).push(it); }
  const seen = new Map();
  let shown = 0;
  for (const it of i.items) {
    const bucket = byKey.get(it.k);
    if (!bucket) continue;
    const n = seen.get(it.k) || 0;
    if (n >= bucket.length) continue;
    seen.set(it.k, n + 1);
    const was = bucket[n];
    const dt = it.t - was.t, dl = it.l - was.l, dh = it.h - was.h;
    if (Math.abs(dt) < 3 && Math.abs(dl) < 3 && Math.abs(dh) < 3) continue;
    shown++;
    const fs = was.fs !== it.fs ? `  ${was.fs}→${it.fs}` : '';
    const cell = (a, bq, d) => `${a}/${bq} (${d >= 0 ? '+' : ''}${d})`.padStart(15);
    console.log(it.k.slice(0, 29).padEnd(30) + cell(was.t, it.t, dt) + cell(was.l, it.l, dl) + cell(was.h, it.h, dh) + fs);
  }
  if (!shown) console.log('  расхождений больше 2px нет — секция совпадает');
  console.log('\nсдвиги в единицы пикселей — совпадение; десятки — разбирать.\n');
  await browser.close();
  process.exit(0);
}
const proto = await capture(browser, PROTO, 'proto');
const impl = await capture(browser, IMPL, 'impl');

const implNamed = impl.order.map((k) => ALIAS.get(k) ?? k);
const implFileKey = new Map(impl.order.map((k) => [ALIAS.get(k) ?? k, k]));
const { sections, onlyProto, onlyImpl, missing } = commonSections(proto.order, implNamed, ONLY);

// ★ НЕЧЕГО СРАВНИВАТЬ — ЭТО ОТКАЗ, А НЕ «0%». Именно этот путь и давал
// ложно-зелёную приёмку: список секций лендинга на демо не совпадал ни с чем,
// и отчёт печатал «худшая секция: 0%» с кодом 0.
if (!sections.length) {
  console.error('\nсравнивать нечего: у прототипа и реализации нет ни одной общей секции.');
  console.error(`  прототип:    ${proto.order.join(', ') || '(секций не найдено)'}`);
  console.error(`  реализация:  ${impl.order.join(', ') || '(секций не найдено)'}`);
  if (ONLY) console.error(`  --sections:  ${ONLY.join(', ')}`);
  console.error('Проверь, что оба адреса открывают ОДНУ страницу (лендинг ↔ лендинг, демо ↔ демо).');
  await browser.close();
  process.exit(2);
}
// Опечатка в --sections не должна выглядеть как «эта секция в порядке».
if (missing.length) {
  console.error(`\n--sections: таких секций нет ни у прототипа, ни у реализации: ${missing.join(', ')}`);
  await browser.close();
  process.exit(2);
}

const scratch = await (await browser.newContext()).newPage();
await scratch.goto('about:blank');

console.log(`\nскриншот-диф прототип ↔ реализация · ${W}×${H}\n`);
console.log('секция'.padEnd(14) + 'расхожд.'.padStart(9) + '   вердикт');
let worst = 0;
for (const name of sections) {
  const implFile = impl.found[implFileKey.get(name) ?? name];
  if (!proto.found[name] || !implFile) { console.log(name.padEnd(14) + '     —     секция не снялась (нулевой размер?)'); continue; }
  const pct = await scratch.evaluate(async ([a, b]) => {
    const load = (b64) => new Promise((res) => { const img = new Image(); img.onload = () => res(img); img.src = 'data:image/png;base64,' + b64; });
    const [one, two] = await Promise.all([load(a), load(b)]);
    const w = Math.min(one.width, two.width), h = Math.min(one.height, two.height);
    const data = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const d1 = data(one), d2 = data(two);
    let diff = 0;
    for (let i = 0; i < d1.length; i += 4) {
      if (Math.abs(d1[i] - d2[i]) > 12 || Math.abs(d1[i + 1] - d2[i + 1]) > 12 || Math.abs(d1[i + 2] - d2[i + 2]) > 12) diff++;
    }
    return +(100 * diff / (w * h)).toFixed(1);
  }, [fs.readFileSync(proto.found[name]).toString('base64'), fs.readFileSync(implFile).toString('base64')]);
  worst = Math.max(worst, pct);
  const verdict = pct > 25 ? '🔴 разобрать' : pct > 10 ? '🟠 посмотреть' : pct > 4 ? '🟡 мелочи' : '🟢 совпадает';
  console.log(name.padEnd(14) + `${pct}%`.padStart(9) + '   ' + verdict);
}
// Число сравнённых секций печатается РЯДОМ с худшим процентом: без него
// «худшая секция: 0%» не отличает «всё совпало» от «мерить было нечего».
console.log(`\nсравнено секций: ${sections.length}  ·  худшая: ${worst}%  ·  картинки: ${OUT}/{proto,impl}-<секция>.png`);
if (onlyProto.length) console.log(`только у макета:      ${onlyProto.join(', ')}`);
if (onlyImpl.length) console.log(`только у реализации:  ${onlyImpl.join(', ')}`);
console.log('пары «макет | реализация» и эти числа идут в тело PR — это и есть приёмка Ф6.\n');
await browser.close();
