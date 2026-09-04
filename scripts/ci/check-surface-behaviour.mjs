#!/usr/bin/env node
/**
 * ПОВЕДЕНЧЕСКАЯ ПРИЁМКА ПОВЕРХНОСТЕЙ — то, чего не видит НИ ОДИН гард репозитория.
 *
 * ★ ИМЯ РАСШИРЕНО ВМЕСТЕ С ПЕРИМЕТРОМ (TRIP-494). Гард звался «пикером», пока
 * проверял один экран; теперь он проверяет СЕМЬЮ полноростных поверхностей —
 * шторку пикера и оболочку панелей редактора, — и имя «пикер» врало бы ровно
 * так же, как врут разъехавшиеся комментарии.
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

console.log(`check-surface-behaviour: ${BASE} (390x844, touch)\n`);
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
    const s = document.querySelector('[data-sheet-full]');
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
const field = page.locator('[data-sheet-full] input.input');
await field.fill('Мад');
await page.waitForTimeout(400);
const rows = await page.locator('[data-sheet-full] .ss-opt').count();
check(rows > 0, 'лист показал строки по запросу', `строк: ${rows}`);

const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
if (rows > 0) {
  await page.locator('[data-sheet-full] .ss-opt').first().tap();
  await page.waitForTimeout(600);
  const value = await page.locator('button.input').first().textContent();
  check(/Мадрид/.test(value || ''), 'КЛИК ПО ПУНКТУ ВЫБРАЛ ПУНКТ', `в поле: «${(value || '').trim()}»`);
  check(errors.length === 0, 'выбор не бросил исключение', errors.join(' | ') || 'ошибок нет');
}

/* 2а. ВЫБОР БЕЗ `click` — репро продового бага (iPhone/WebKit): слово из
   подсказки клавиатуры остаётся композицией, первое касание тратится на её
   коммит, `click` до строки не доходит. Chromium этого не воспроизводит, поэтому
   потерю моделируем: шлём строке только пару pointerdown/pointerup. */
await trigger.tap();
await page.waitForTimeout(700);
await page.locator('[data-sheet-full] input.input').fill('Мад');
await page.waitForTimeout(400);
const pointerOnly = await page.evaluate(() => {
  const row = document.querySelector('[data-sheet-full] .ss-opt');
  if (!row) return 'строки нет';
  const r = row.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const ev = (type, dx = 0, dy = 0) => new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch',
    clientX: x + dx, clientY: y + dy,
  });
  row.dispatchEvent(ev('pointerdown'));
  row.dispatchEvent(ev('pointerup'));
  return null;
});
await page.waitForTimeout(600);
const pointerValue = await page.locator('button.input').first().textContent();
check(pointerOnly === null && /Мадрид/.test(pointerValue || ''),
  'ВЫБОР РАБОТАЕТ БЕЗ `click` (репро iOS: тач без мышиной совместимости)',
  pointerOnly || `в поле: «${(pointerValue || '').trim()}»`);

/* 2б. Обратная сторона того же жеста: протяжка по списку — скролл, не выбор.
   Прежде границу держал сам `click` (браузер его на протяжке не рождает), теперь
   держит порог смещения. */
await trigger.tap();
await page.waitForTimeout(700);
await page.locator('[data-sheet-full] input.input').fill('Мад');
await page.waitForTimeout(400);
const dragged = await page.evaluate(() => {
  const row = document.querySelector('[data-sheet-full] .ss-opt');
  if (!row) return 'строки нет';
  const r = row.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const ev = (type, dy) => new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch',
    clientX: x, clientY: y + dy,
  });
  row.dispatchEvent(ev('pointerdown', 0));
  row.dispatchEvent(ev('pointerup', -60));
  return null;
});
await page.waitForTimeout(500);
const stillOpen = await page.locator('[data-sheet-full] .ss-opt').count();
check(dragged === null && stillOpen > 0,
  'ПРОТЯЖКА ПО СПИСКУ НЕ ВЫБИРАЕТ (скролл остался скроллом)',
  dragged || `лист на месте, строк: ${stillOpen}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

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

/* ── СЕМЬЯ ПОЛНОРОСТНЫХ ПОВЕРХНОСТЕЙ (TRIP-494) ─────────────────────────────
   Их ДВЕ, и это одна и та же вещь. До сведения они отличались краской (шторка
   `--surface`, панель `--bg` — в тёмной теме ступень, а не оттенок) и бровью (у
   панели её не было вовсе). Ни того, ни другого не видел ни один гард: стенда у
   семьи не существовало, а панель редактора живёт за логином.
   Здесь обе открываются на витрине и сверяются ДРУГ С ДРУГОМ, а не с числом в
   коде: разъехаться они могут только между собой. */
await page.goto(`${BASE}/kit/full-surface`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const openSurface = async (label) => {
  await page.locator(`button:has-text("${label}")`).first().tap();
  await page.waitForTimeout(900);
  const got = await page.evaluate(() => {
    const el = document.querySelector('[data-sheet-full]');
    if (!el) return null;
    const scroller = el.querySelector('[data-sheet-scroller]');
    return {
      paint: getComputedStyle(el, '::before').backgroundColor,
      // ⚠️ СВЕРКА ДРУГ С ДРУГОМ ЛОВИТ ТОЛЬКО РАЗЪЕЗД. Обе поверхности берут
      // краску из ОДНОГО правила, поэтому неверное значение они получат ВМЕСТЕ
      // и «краска одна» останется зелёной. Отсюда второй замер: цвет страницы,
      // с которым краска обязана совпасть (полноростная поверхность — экран).
      pageGround: getComputedStyle(document.body).backgroundColor,
      grip: !!el.querySelector('.sheet-grip'),
      top: Math.round(el.getBoundingClientRect().top),
      // скроллер обязан скроллить СЕБЯ, а не уезжать за нижний край экрана
      scrolls: scroller ? scroller.scrollHeight > scroller.clientHeight : null,
      inViewport: scroller ? Math.round(scroller.getBoundingClientRect().bottom) <= innerHeight + 1 : null,
    };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  return got;
};

/* ★★ СМЕНА ФАЗЫ НЕ ПЕРЕЗАПУСКАЕТ ВЪЕЗД (TRIP-494). Композер города меняет
   содержимое ОДНОЙ открытой поверхности: поле и лист уходят, приходят плитки.
   Пока условие въезда стояло живым запросом по содержимому (`:has(.ss-search)`),
   на этой смене перебивание собственной анимации vaul отваливалось вместе с
   полем, и открытая шторка ЗАНОВО проигрывала появление — снаружи «шит закрылся
   и открылся второй такой же, но с плитками».
   Проверяется то, что видно снаружи: та же коробка (узел не подменился) и НИ
   ОДНОГО старта анимации на ней после смены фазы. */
await page.goto(`${BASE}/kit/full-surface`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.locator('button:has-text("Шторка пикера")').first().tap();
await page.waitForTimeout(1100);
const phase = await page.evaluate(async () => {
  const el = document.querySelector('[data-sheet-full]');
  if (!el) return { err: 'шторка не открылась' };
  el.dataset.kitMark = 'same-box';           // метка на УЗЛЕ: переживёт только он сам
  const started = [];
  el.addEventListener('animationstart', (e) => started.push(e.animationName));
  const before = getComputedStyle(el).animationName;
  el.querySelector('.ss-opt')?.click();      // выбор строки = переход на вторую фазу
  await new Promise((r) => setTimeout(r, 700));
  const now = document.querySelector('[data-sheet-full]');
  return {
    sameBox: !!now && now.dataset.kitMark === 'same-box',
    fieldGone: !!now && !now.querySelector('.ss-search'),
    tiles: !!now && !!now.querySelector('.te-add-type'),
    before,
    after: now ? getComputedStyle(now).animationName : null,
    started,
  };
});
check(phase.sameBox === true && phase.fieldGone === true && phase.tiles === true,
  'смена фазы прошла В ТОЙ ЖЕ коробке (поле ушло, плитки пришли)',
  phase.err || `та же коробка: ${phase.sameBox} · поля нет: ${phase.fieldGone} · плитки: ${phase.tiles}`);
check(phase.started && phase.started.length === 0 && phase.after === phase.before,
  'СМЕНА ФАЗЫ НЕ ПЕРЕЗАПУСКАЕТ ВЪЕЗД (шторка не появляется второй раз)',
  `анимаций стартовало: ${(phase.started || []).join(', ') || 'ни одной'} · было «${phase.before}» стало «${phase.after}»`);
await page.keyboard.press('Escape');
await page.waitForTimeout(700);

/* ★★ ДИСМИСС ДОВОДИТСЯ ДО КОНЦА, ДАЖЕ КОГДА ВНУТРИ СТОПКА СЛОЁВ (TRIP-496).
   Панель редактора держит стопку (город → переезд) в ОДНОЙ шторке. Пока
   открытость задавалась литералом, свайп вниз по верхнему слою кончался так:
   vaul дотягивал коробку до низа и сообщал «закрыто», обработчик снимал только
   верхний слой, элемент оставался отрисованным — и шторка залипала там, где её
   бросил палец (замер модели: `translate3d(0px, 460px, 0px)`, и через 2.4 с то
   же самое). Здесь это проверяется ЖЕСТОМ: уводим стенд на второй слой и тащим
   поверхность вниз. */
await page.goto(`${BASE}/kit/full-surface`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.locator('button:has-text("Панель редактора")').first().tap();
await page.waitForTimeout(900);
await page.locator('button:has-text("Открыть переезд")').first().tap();
await page.waitForTimeout(700);
const drilled = await page.evaluate(() => !!document.querySelector('.lp-sheet'));
// свайп вниз по шторке — как пальцем по её верхней части
await page.mouse.move(195, 40);
await page.mouse.down();
for (const y of [80, 160, 260, 380, 500]) { await page.mouse.move(195, y); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForTimeout(1400);
const afterSwipe = await page.evaluate(() => {
  const el = document.querySelector('.lp-sheet');
  if (!el) return { gone: true };
  const r = el.getBoundingClientRect();
  return { gone: false, top: Math.round(r.top), inline: el.style.transform || '(нет)', visible: r.top < innerHeight - 8 };
});
check(drilled, 'стопка слоёв открылась (город → переезд)', drilled ? 'второй слой на месте' : 'слой не открылся');
check(afterSwipe.gone === true || afterSwipe.visible === false,
  'СВАЙП ВНИЗ ЗАКРЫВАЕТ ПОВЕРХНОСТЬ ДО КОНЦА (не залипает на полпути)',
  afterSwipe.gone ? 'шторки в дереве нет' : `верх ${afterSwipe.top}, transform ${afterSwipe.inline}`);

const picker = await openSurface('Шторка пикера');
const panel = await openSurface('Панель редактора');
check(!!picker && !!panel, 'обе поверхности семьи открылись на витрине',
  `${picker ? 'шторка ок' : 'шторки нет'} · ${panel ? 'панель ок' : 'панели нет'}`);

if (picker && panel) {
  check(picker.grip && panel.grip, 'БРОВЬ У ОБЕИХ ПОВЕРХНОСТЕЙ',
    `шторка ${picker.grip ? 'есть' : 'НЕТ'} · панель ${panel.grip ? 'есть' : 'НЕТ'}`);
  check(picker.paint === panel.paint, 'КРАСКА У ОБЕИХ ОДНА',
    `${picker.paint} · ${panel.paint}`);
  check(picker.paint === picker.pageGround, 'И ЭТО КРАСКА СТРАНИЦЫ, А НЕ КАРТОЧКИ',
    `поверхность ${picker.paint} · страница ${picker.pageGround}`);
  check(picker.top === 0 && panel.top === 0, 'обе — экран во весь вьюпорт',
    `верх: ${picker.top} · ${panel.top}`);
  check(picker.scrolls === true && picker.inViewport === true,
    'ДЛИННЫЙ ЛИСТ СКРОЛЛИТ СЕБЯ, А НЕ УЕЗЖАЕТ ЗА ЭКРАН',
    `скроллится: ${picker.scrolls} · низ в кадре: ${picker.inViewport}`);
  check(panel.scrolls === true && panel.inViewport === true,
    'то же у тела панели',
    `скроллится: ${panel.scrolls} · низ в кадре: ${panel.inViewport}`);
}

/* ── ГРАНИЦА КРАХА ПОВЕРХНОСТИ (TRIP-515) ────────────────────────────────────
   Грепом недоказуемо, и грепом же не проверить: краш ВНУТРИ окна обязан закрыть
   окно, а не приложение, а промис confirm() — разрешиться false ДАЖЕ когда краш
   случился при busy (там busy-guard глотает обычное закрытие). Стенд —
   /kit/surface-crash. Оба сценария роняют поддерево окна намеренно.
   ⚠️ Прод-сборка глушит оверлей ошибок Vite; на dev-сервере он бы перехватывал
   краш — поэтому стенд смотрят под `vite preview`, как и остальную приёмку. */
await page.goto(`${BASE}/kit/surface-crash`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const escaped = [];
page.on('pageerror', (e) => escaped.push(String(e).slice(0, 140)));
// Сосед — Badge вне окна: жив = приложение не упало (крах-экран накрыл бы его).
const neighborAlive = () => page.locator('text=сосед жив').count();

check(await neighborAlive() > 0, 'стенд краха отрисован (сосед на месте)');

/* Сценарий 1: краш внутри шита. Открыть → сломать содержимое → шит закрыт,
   сосед жив, приложение не упало (иначе соседа накрыл бы крах-экран). */
await page.locator('button:has-text("Открыть шит")').first().tap();
await page.waitForTimeout(700);
const sheetOpened = await page.locator('button:has-text("Сломать содержимое")').count();
await page.locator('button:has-text("Сломать содержимое")').first().tap();
await page.waitForTimeout(900);
const sheetGone = await page.locator('button:has-text("Сломать содержимое")').count();
check(sheetOpened > 0, 'шит открылся', `кнопка краха: ${sheetOpened}`);
check(sheetGone === 0, 'КРАШ ЗАКРЫЛ ШИТ (поверхность снята)', `осталось кнопок краха: ${sheetGone}`);
check(await neighborAlive() > 0, 'ПРИЛОЖЕНИЕ ЖИВО ПОСЛЕ КРАХА (сосед на месте, не крах-экран)');

/* Сценарий 2: краш при busy. Открыть confirm → красная кнопка ставит busy=true,
   перерисовка роняет содержимое. Промис обязан разрешиться false (жёсткая
   отмена мимо busy-guard), а не зависнуть. */
await page.locator('button:has-text("Confirm с крахом при busy")').first().tap();
await page.waitForTimeout(800);
const confirmOpened = await page.locator('button:has-text("Уронить окно")').count();
await page.locator('button:has-text("Уронить окно")').first().tap();
await page.waitForTimeout(1000);
const promiseValue = (await page.locator('text=/промис:/').first().textContent() || '').trim();
check(confirmOpened > 0, 'confirm с крахом открылся', `красных кнопок: ${confirmOpened}`);
check(/false/.test(promiseValue),
  'ПРОМИС confirm() РАЗРЕШЁН false ПРИ КРАХЕ В BUSY (не завис)',
  `бейдж промиса: «${promiseValue}»`);
check(await neighborAlive() > 0, 'приложение живо после краха confirm');
check(escaped.length === 0, 'краш не улетел неперехваченным', escaped.join(' | ') || 'ошибок нет');

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} проверок прошло`);
if (failed.length) {
  console.log(`::error::check-surface-behaviour: ${failed.length} провал(ов) — ${failed.map((f) => f.what).join('; ')}`);
  process.exit(1);
}
console.log('поведение поверхностей в порядке.');
