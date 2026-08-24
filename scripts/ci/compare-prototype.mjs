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
 *   2. Прототип тянет фото с https://www.triplanio.com/hero/* — заменить хост на
 *      относительный путь и положить рядом public/hero, иначе фон не загрузится
 *      и диф покажет 86% там, где расхождения нет.
 *   3. Поднять два статических сервера (прототип и dist) и передать их URL.
 *
 *   node scripts/ci/compare-prototype.mjs \
 *        --proto http://localhost:8911/src-landing-local.html \
 *        --impl  http://localhost:8910/ \
 *        --width 1440 --height 900
 *
 * ЧТО ХАРНЕСС УБИРАЕТ ИЗ ЗАМЕРА (иначе числа врут и гонят чинить исправное):
 *   · баннер согласия — компонент приложения, в прототипе его нет;
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
  .ci-root, [class*="ci-launch"] { display: none !important; }
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
