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
 *   node scripts/ci/compare-prototype.mjs \
 *        --proto http://localhost:8911/src-landing-local.html \
 *        --impl  http://localhost:8910/ \
 *        --width 1440 --height 900
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

const SECTIONS = ['hero','pain','bento-sec','recognize','archive','audience','collab','tg-sec','share','faq-sec','final'];
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.env.OUT_DIR || '/tmp/proto-diff';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const PROTO = arg('proto'), IMPL = arg('impl');
const W = +arg('width', 1440), H = +arg('height', 900);
if (!PROTO || !IMPL) {
  console.error('нужны --proto <url> и --impl <url>; см. докблок');
  process.exit(2);
}

/** Обе стороны — в одном состоянии: без баннера согласия, анимации доиграны. */
const SETTLE = `
  .consent, .ci-root, [class*="ci-launch"] { display: none !important; }
`;

async function capture(browser, url, tag) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: SETTLE });

  const found = {};
  // hero снимается ПЕРВЫМ, на нетронутой странице: он живёт на первом экране и
  // реагирует на скролл (параллакс, hover-кадр, затухание). Снятый после прогона
  // по всей высоте — даже с возвратом в 0 — он сравнивается в другой фазе: на этом
  // лендинге 11% против 37% и 83% в зависимости от момента съёмки.
  {
    const heroEl = await page.$('section.hero');
    if (heroEl) {
      const box = await heroEl.boundingBox();
      if (box) {
        const file = path.join(OUT, `${tag}-hero.png`);
        await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: Math.min(box.height, 2400) } });
        found.hero = file;
      }
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

  for (const name of SECTIONS) {
    if (name === 'hero') continue; // снят выше, до прогона
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
    await page.screenshot({ path: file, clip: { x: 0, y: Math.max(0, box.y), width: W, height: Math.min(box.height, 2400) } });
    found[name] = file;
  }
  await ctx.close();
  return found;
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

const scratch = await (await browser.newContext()).newPage();
await scratch.goto('about:blank');

console.log(`\nскриншот-диф прототип ↔ реализация · ${W}×${H}\n`);
console.log('секция'.padEnd(14) + 'расхожд.'.padStart(9) + '   вердикт');
let worst = 0;
for (const name of SECTIONS) {
  if (!proto[name] || !impl[name]) { console.log(name.padEnd(14) + '     —     нет секции с одной из сторон'); continue; }
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
  }, [fs.readFileSync(proto[name]).toString('base64'), fs.readFileSync(impl[name]).toString('base64')]);
  worst = Math.max(worst, pct);
  const verdict = pct > 25 ? '🔴 разобрать' : pct > 10 ? '🟠 посмотреть' : pct > 4 ? '🟡 мелочи' : '🟢 совпадает';
  console.log(name.padEnd(14) + `${pct}%`.padStart(9) + '   ' + verdict);
}
console.log(`\nхудшая секция: ${worst}%  ·  картинки: ${OUT}/{proto,impl}-<секция>.png`);
console.log('пары «макет | реализация» и эти числа идут в тело PR — это и есть приёмка Ф6.\n');
await browser.close();
