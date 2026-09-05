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
// Кадр стенда — одно число на весь файл: проверки роста сверяются С НИМ, а не с
// переписанным рядом литералом (разъезд выглядел бы как красный гард на верной вёрстке).
const VW = 390;
const VH = 844;
const page = await browser.newPage({ viewport: { width: VW, height: VH }, hasTouch: true, isMobile: true });

console.log(`check-surface-behaviour: ${BASE} (${VW}x${VH}, touch)\n`);
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
      bottom: Math.round(el.getBoundingClientRect().bottom),
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

/* ── ПАНЕЛЬ — СЛОЙ ТОГО ЖЕ ШИТА (телефонная раскладка экрана с картой) ───────
   Панель города/события была ВТОРОЙ поверхностью поверх шита сцены, и платила за
   это всем сразу: рост не совпадал с шитом, поднять её жестом было нечем, скрим
   гасил живую карту, а её собственная анимация высоты выбивалась инлайн-стилями
   vaul после первого же касания пальцем.
   Теперь у экрана ОДИН шит, а панель — его слой, и проверяется ровно то, что из
   этого следует. Ни одного скриншота у этих правил нет: «панель открылась»
   выглядит одинаково и когда всё верно, и когда сломано. Стенд — `/kit/scene-sheet`.
   Жесты идут через CDP: PeekSheet слушает `touch*`, а нативный скролл рождается
   только настоящим касанием — синтетическое событие его не двигает. */
const cdp = await page.context().newCDPSession(page);
// Палец идёт по средней линии — единственная колонка, где под ним заведомо и
// грип, и тело: у жеста разъезжаться по горизонтали не с чем.
const MID_X = Math.round(VW / 2);
const swipe = async (y0, y1, steps = 12) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: MID_X, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: MID_X, y: Math.round(y0 + ((y1 - y0) * i) / steps) }] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
};
const sheetGeo = () => page.evaluate(() => {
  const sh = document.querySelector('.peek-sheet');
  if (!sh) return null;
  const r = sh.getBoundingClientRect();
  const sc = sh.querySelector('[data-sheet-scroller]');
  const grip = sh.querySelector('[data-peek-grip]').getBoundingClientRect();
  const body = sc && sc.getBoundingClientRect();
  return {
    detent: sh.dataset.detent, top: Math.round(r.top), layer: sh.hasAttribute('data-layer'),
    scrollTop: sc ? sc.scrollTop : null,
    gripY: Math.round(grip.y + grip.height / 2),
    bodyMid: body ? Math.round(body.y + body.height / 2) : null,
    scrim: !!document.querySelector('[data-vaul-overlay], .sheet-backdrop'),
  };
});

await page.goto(`${BASE}/kit/scene-sheet`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const beforePanel = await sheetGeo();
await page.locator('button:has-text("Открыть панель города")').first().tap();
await page.waitForTimeout(800);
const withPanel = await sheetGeo();
check(!!withPanel && withPanel.layer === true && withPanel.top === beforePanel.top,
  'ПАНЕЛЬ ОТКРЫВАЕТСЯ РОСТОМ ШИТА (детент не меняется — панель не подменяет экран)',
  withPanel ? `верх ${beforePanel.top} → ${withPanel.top} · слой: ${withPanel.layer}` : 'панель не открылась');
check(!!withPanel && withPanel.scrim === false,
  'КАРТА НЕ ГАСНЕТ: у слоя нет ни скрима, ни модальной подложки',
  withPanel ? `подложка: ${withPanel.scrim}` : '');

await swipe(withPanel.bodyMid, withPanel.bodyMid - 200);
const afterScroll = await sheetGeo();
check(afterScroll.scrollTop > 0 && afterScroll.top === withPanel.top,
  'СКРОЛЛ ВНУТРИ ПАНЕЛИ ЖИВОЙ, а шит при этом стоит',
  `прокручено ${afterScroll.scrollTop}px · верх шита ${afterScroll.top}`);

await swipe(afterScroll.gripY, afterScroll.gripY - 300);
const afterUp = await sheetGeo();
check(afterUp.top === 0,
  'ПАНЕЛЬ ПОДНИМАЕТСЯ ЖЕСТОМ ДО ЭКРАНА (детент, а не вторая поверхность)',
  `верх ${afterScroll.top} → ${afterUp.top}, детент ${afterUp.detent}`);
await swipe(afterUp.gripY, afterUp.gripY + 300);
const afterDown = await sheetGeo();
check(afterDown.top > 0, 'и опускается обратно тем же жестом', `верх ${afterDown.top}`);

/* ★ ПОДЪЁМ ПО ЗАЯВКЕ — ПОСЛЕ КАСАНИЯ ПАЛЬЦЕМ, И ЭТО ЧАСТЬ ПРОВЕРКИ. Прежняя
   редакция (панель отдельной шторкой) играла переход ровно до первого касания:
   vaul ставил инлайн `transition: transform`, и объявленный в CSS переход высоты
   переставал существовать. Снаружи это выглядело как «иногда плавно, иногда
   рывком», то есть как случайность. */
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: MID_X, y: 300 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(300);
const rise = await page.evaluate(async () => {
  const sh = document.querySelector('.peek-sheet');
  const t0 = performance.now(); const f = [];
  document.evaluate("//button[contains(., 'Открыть форму')]", document, null, 9, null).singleNodeValue.click();
  await new Promise((r) => { (function tick() { f.push(Math.round(sh.getBoundingClientRect().top)); if (performance.now() - t0 < 500) requestAnimationFrame(tick); else r(); })(); });
  return { first: f[0], mid: f[Math.floor(f.length / 2)], last: f[f.length - 1] };
});
check(rise.last === 0 && rise.mid > 0 && rise.mid < rise.first,
  'ФОРМА ПОДНИМАЕТ ШИТ ДО ЭКРАНА ПЛАВНО — И ПОСЛЕ КАСАНИЯ ПАЛЬЦЕМ ТОЖЕ',
  `кадры: ${rise.first} → ${rise.mid} → ${rise.last}`);

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

// Метка элемента-инициатора: тап по кнопке фокусирует её. Возврат фокуса (п.3
// контракта) сверяем по ТЕКСТУ активного элемента до и после краха.
const activeText = () => page.evaluate(() => (document.activeElement?.textContent || '').trim().slice(0, 40));

/* Сценарий 1: краш внутри шита. Открыть → сломать содержимое → шит ЗАКРЫТ (а не
   погашен), сосед жив, крах-экрана нет.
   ★★ БЛОКЕР ИЗ РЕВЬЮ: `sheetGone===0` сам по себе зелен и на реализации, которая
   лишь рисует null и НЕ закрывает поверхность (кнопка исчезает всё равно — она
   под границей). Поэтому решает ПОВТОРНОЕ ОТКРЫТИЕ: при застрявшем open=true
   `setOpen(true)` — no-op, содержимое не вернётся. */
await page.locator('button:has-text("Открыть шит")').first().tap();
await page.waitForTimeout(700);
const sheetOpened = await page.locator('button:has-text("Сломать содержимое")').count();
await page.locator('button:has-text("Сломать содержимое")').first().tap();
await page.waitForTimeout(900);
const sheetGone = await page.locator('button:has-text("Сломать содержимое")').count();
const retryBlocks = await page.locator('[role="alert"]').count();
const focusAfterSheet = await activeText();
check(sheetOpened > 0, 'шит открылся', `кнопка краха: ${sheetOpened}`);
check(sheetGone === 0, 'содержимое крашнувшегося шита снято', `осталось кнопок краха: ${sheetGone}`);
check(await neighborAlive() > 0, 'ПРИЛОЖЕНИЕ ЖИВО ПОСЛЕ КРАХА (сосед на месте, не крах-экран)');
check(retryBlocks === 0, 'ФОЛБЭК ПУСТОЙ, А НЕ RETRY-БЛОК (нет role=alert)', `role=alert: ${retryBlocks}`);
check(/Открыть шит/.test(focusAfterSheet), 'ФОКУС ВЕРНУЛСЯ НА ИНИЦИАТОРА', `активен: «${focusAfterSheet}»`);
// Повторное открытие: содержимое обязано вернуться → поверхность была ЗАКРЫТА
// (open сброшен), а не просто погашена.
await page.locator('button:has-text("Открыть шит")').first().tap();
await page.waitForTimeout(700);
const reopened = await page.locator('button:has-text("Сломать содержимое")').count();
check(reopened > 0, 'ПОВЕРХНОСТЬ БЫЛА ЗАКРЫТА, А НЕ ПОГАШЕНА (переоткрытие вернуло содержимое)',
  `кнопка краха после переоткрытия: ${reopened}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

/* Сценарий 2: краш при busy. Открыть confirm → красная кнопка ставит busy=true,
   перерисовка роняет содержимое. Промис обязан разрешиться false (жёсткая
   отмена мимо busy-guard), а не зависнуть; фокус вернуться на инициатора. */
await page.locator('button:has-text("Confirm с крахом при busy")').first().tap();
await page.waitForTimeout(800);
const confirmOpened = await page.locator('button:has-text("Уронить окно")').count();
await page.locator('button:has-text("Уронить окно")').first().tap();
await page.waitForTimeout(1000);
const promiseValue = (await page.locator('text=/промис:/').first().textContent() || '').trim();
const focusAfterConfirm = await activeText();
check(confirmOpened > 0, 'confirm с крахом открылся', `красных кнопок: ${confirmOpened}`);
check(/false/.test(promiseValue),
  'ПРОМИС confirm() РАЗРЕШЁН false ПРИ КРАХЕ В BUSY (не завис)',
  `бейдж промиса: «${promiseValue}»`);
check(/Confirm с крахом/.test(focusAfterConfirm), 'ФОКУС ВЕРНУЛСЯ НА ИНИЦИАТОРА confirm', `активен: «${focusAfterConfirm}»`);
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
