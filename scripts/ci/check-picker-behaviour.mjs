#!/usr/bin/env node
/**
 * ПОВЕДЕНЧЕСКАЯ ПРИЁМКА ПИКЕРА — то, чего не видит НИ ОДИН гард репозитория.
 *
 * ЗАЧЕМ. Все тесты проекта — грепы по исходникам: jsdom и testing-library в
 * зависимостях нет. Они доказывают, что код ВЫГЛЯДИТ как надо. Цена записана:
 * `release()` — вызов `undefined` на КАЖДОМ клике по пункту — прошёл lint,
 * typecheck, 1744 теста и 13 гардов и доехал до пользователя (TRIPLANIO-33).
 *
 * Проверяется то, что грепом недоказуемо: фокус в поле с первого кадра (от него
 * зависит подъём клавиатуры) · клик по пункту ВЫБИРАЕТ пункт · закрытие снимает
 * фокус сразу, а не через полсекунды · поле за въезд не двигается, панель едет.
 *
 * ЗАПУСК (как `check:proto`, руками — нужен браузер и поднятый сервер):
 *   (setsid npx vite preview --port 4173 --strictPort &) ; npm run check:picker
 * Стенд — витрина `/kit/autocomplete`: единственное место, где пикер можно
 * потрогать анонимно.
 *
 * ⚠️ Chromium — не WebKit: каретку и клавиатуру он не воспроизводит, их приёмка —
 * глаза на устройстве. Здесь проверяется то, что от движка не зависит.
 */
import { chromium } from 'playwright-core';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const BASE = arg('--url', process.env.PICKER_URL || 'http://127.0.0.1:4173');
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const results = [];
const check = (ok, what, detail = '') => {
  results.push({ ok, what, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

console.log(`check-picker-behaviour: ${BASE}/kit/autocomplete (390x844, touch)\n`);
await page.goto(`${BASE}/kit/autocomplete`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const trigger = page.locator('button.input').first();
check(await trigger.count() > 0, 'триггер пикера отрисован');

/* 1 + 4. Тап и покадровый замер въезда: фокус обязан оказаться в поле шторки,
   поле — стоять, панель — ехать. Замер идёт с ПЕРВОГО кадра после тапа. */
await trigger.tap();
await page.evaluate(() => {
  window.__f = [];
  const t = performance.now();
  (function tick() {
    const s = document.querySelector('.sheet--full');
    const i = s && s.querySelector('input.input');
    const l = s && s.querySelector('.ss-list');
    if (s) window.__f.push({
      field: i ? Math.round(i.getBoundingClientRect().top) : null,
      list: l ? Math.round(l.getBoundingClientRect().top) : null,
      focused: !!i && document.activeElement === i,
    });
    if (performance.now() - t < 600) requestAnimationFrame(tick);
  })();
});
await page.waitForTimeout(800);

const frames = await page.evaluate(() => window.__f);
const span = (key) => {
  const v = frames.map((f) => f[key]).filter((x) => x != null);
  return v.length ? Math.max(...v) - Math.min(...v) : -1;
};
check(frames.length > 0 && frames[0].focused,
  'фокус в поле шторки с первого кадра', 'без этого клавиатуру поднимать нечем');
check(span('field') === 0,
  'поле НЕ двигается за въезд', `размах ${span('field')}px`);
check(span('list') > 100,
  'панель ЕДЕТ (шторка выезжает, а не появляется)', `размах листа ${span('list')}px`);

/* 2. ГЛАВНОЕ: клик по пункту выбирает пункт. Именно это упало в проде. */
const field = page.locator('.sheet--full input.input');
await field.fill('Мад');
await page.waitForTimeout(400);
const rows = await page.locator('.sheet--full .ss-opt').count();
check(rows > 0, 'лист показал строки по запросу', `строк: ${rows}`);

const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
if (rows > 0) {
  await page.locator('.sheet--full .ss-opt').first().tap();
  await page.waitForTimeout(600);
  const value = await page.locator('button.input').first().textContent();
  check(/Мадрид/.test(value || ''), 'КЛИК ПО ПУНКТУ ВЫБРАЛ ПУНКТ', `в поле: «${(value || '').trim()}»`);
  check(errors.length === 0, 'выбор не бросил исключение', errors.join(' | ') || 'ошибок нет');
}

/* 3. Закрытие снимает фокус сразу, а не в конце выходной анимации. */
await trigger.tap();
await page.waitForTimeout(700);
await page.evaluate(() => {
  window.__blurAt = null;
  const t = performance.now();
  document.addEventListener('focusout', () => { if (window.__blurAt == null) window.__blurAt = Math.round(performance.now() - t); }, true);
});
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const blurAt = await page.evaluate(() => window.__blurAt);
check(blurAt != null && blurAt < 120,
  'закрытие снимает фокус сразу', `focusout на ${blurAt}-й мс (было 500 — клавиатура отставала)`);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} проверок прошло`);
if (failed.length) {
  console.log(`::error::check-picker-behaviour: ${failed.length} провал(ов) — ${failed.map((f) => f.what).join('; ')}`);
  process.exit(1);
}
console.log('поведение пикера в порядке.');
