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
 * ★ ЧЕТЫРЕ ПОВЕРХНОСТИ ЗОНЫ ЖИВУТ НЕ ПО СВОЕМУ АДРЕСУ — ИХ НАДО ОТКРЫТЬ.
 * Документ лендинга держит ТРИ страницы зоны в одном файле и переключает их
 * своими функциями; документ авторизации — девять экранов одним `data-screen`.
 * Пока харнесс этого не умел, юр-страницы, публичка и приглашение не
 * принимались НИ РАЗУ, а у входа сравнивался один экран из тринадцати
 * состояний. Из «сравнивать нечего» тогда сделали вывод, что эталона юр-страниц
 * не существует, — он существует, это `<main class="doc">` под `body.doc-open`.
 *
 *   # юридические (макет — то же тело лендинга, реализация — свой маршрут)
 *   npm run check:proto -- --proto <лендинг> --proto-state doc:terms   --impl <impl>/terms
 *   npm run check:proto -- --proto <лендинг> --proto-state doc:privacy --impl <impl>/privacy
 *   # публичная поездка — ⚠️ ТОЛЬКО НА ЖИВОМ ТРИПЕ, см. ниже
 *   npm run check:proto -- --proto <лендинг> --proto-state trip --impl <impl>/public/trip/<id>
 *   # экраны авторизации и приглашения (флаг общий: `.screen[data-screen]` есть у обеих сторон)
 *   npm run check:proto -- --proto <auth> --impl <impl>/login       --screen signup --alias pane-form=pane
 *   npm run check:proto -- --proto <auth> --impl <impl>/join/<токен> --screen join-error --alias pane-form=pane
 *   #   вход:        signin · signup · forgot · sent · reset · done
 *   #   приглашение: join-working · join-signin · join-error  (они на /join, не на /login)
 *   # `--alias pane-form=pane` обязателен: левая колонка формы названа в порту
 *   # иначе, и без сопоставления сравнивался бы только внутренний `.screen`.
 *
 * ⚠️ ПУБЛИЧКУ БЕЗ ЖИВОГО ТРИПА ПРИНИМАТЬ НЕЛЬЗЯ. `/public/trip/<любой-uuid>` на
 * стенде без базы честно рисует «This link is invalid» — и харнесс сравнит
 * СТРАНИЦУ ОТКАЗА с макетом поездки, выдав правдоподобные 96.1% с кодом 0.
 * Имена секций при этом совпадают, поэтому отличить отказ от поездки инструмент
 * не может по построению: это ограничение метода, а не дефект. Для приёмки
 * нужен реальный публичный трип на стенде.
 *
 * ★ ПЕРЕИМЕНОВАЛ СЕКЦИЮ — ПРИЁМКА КРАСНЕЕТ, А НЕ МОЛЧИТ. Непарное имя с ОБЕИХ
 * сторон = код 2. Одно и то же под разными именами сопоставляется
 * `--alias <реализация>=<макет>`, разные вещи объявляются
 * `--allow-unpaired <имя>,<имя>`. Требуется РЕШЕНИЕ автора; молча улучшать
 * вердикт исчезновением худшей секции больше нельзя (демо: `hero` → `dm-hero`
 * убрало 88.5% из отчёта и дало 44.2% с кодом 0).
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
 * элементов секции).
 *
 * ★ НО И --elements НЕ ВЕРДИКТ. Узлы он парует ПО ПОРЯДКУ внутри ключа, и при
 * разном числе одноимённых узлов пара съезжает — отчёт печатает выдуманные
 * расхождения. Такие ключи теперь называются вслух, а их строки помечены «?». Настоящий дефект виден там сдвигом в десятки пикселей:
 * у `pain` высота 1507 против 985 и смещение блоков на 667px.
 *
 * ЧТО ХАРНЕСС УБИРАЕТ ИЗ ЗАМЕРА (иначе числа врут и гонят чинить исправное):
 *   · баннер согласия (.consent) и его плавающая кнопка (.ci-root/.ci-launch) —
 *     компоненты приложения, в прототипе их нет;
 *   · панель управления прототипа (#dock) — переключатели экранов и состояний,
 *     в реализации их нет по построению. На 390 она закрывала пол-экрана
 *     авторизации: 73.9% дифа были ею;
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
import { sectionKey, parseOnly, parseAliases, commonSections, unpairedVerdict, SECTION_SELECTOR, sectionSel } from './proto-sections.mjs';

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
// Непарные секции, объявленные РАЗНЫМИ вещами (а не переименованием одной).
const ALLOW_UNPAIRED = parseOnly(arg('allow-unpaired'));
// Состояние ДОКУМЕНТА-прототипа: он держит три страницы зоны в одном файле и
// переключает их своими же функциями (`window.openDoc` / `window.openTrip`).
// Флаг только для стороны макета: у реализации эти страницы — отдельные адреса.
const PROTO_STATE = arg('proto-state');
// Экран авторизации: `.screen[data-screen=…]` есть у ОБЕИХ сторон, поэтому
// флаг общий (см. setScreen).
const SCREEN = arg('screen');
const W = +arg('width', 1440), H = +arg('height', 900);
const LANG = arg('lang', 'en');
if (!PROTO || !IMPL) {
  console.error('нужны --proto <url> и --impl <url>; см. докблок');
  process.exit(2);
}

/** Обе стороны — в одном состоянии: без баннера согласия, анимации доиграны. */
const SETTLE = `
  .consent, .ci-root, [class*="ci-launch"] { display: none !important; }
  /* Панель управления САМОГО прототипа («Прототип · v5.7 Daylight» с
     переключателями экранов и состояний). На 390 она закрывала пол-экрана
     авторизации, и диф показывал 73.9% — это была её собственная панель, а не
     наша вёрстка. Симметрично баннеру согласия выше: с каждой стороны гасим то,
     чего у другой нет по построению. */
  #dock, .dock { display: none !important; }
  /* Только ВИДИМОСТЬ. Reveal на этом лендинге ДВУНАПРАВЛЕННЫЙ: наблюдатель
     снимает класс in, когда секция уходит вверх, — и блок, добавленный нами
     руками, снова гаснет к моменту съёмки (телефон «Ассистента» пропадал
     целиком, хотя в DOM он на месте: top 604, высота 719).
     transform НЕ трогаем: forced transform:none перебивает конечное
     состояние анимации и раздувает диф (hero 11% против 48%). */
  .rv, .rv-l, .rv-r { opacity: 1 !important; }
`;

/**
 * Локаль: макет и реализация переключаются своими же кнопками языка, иначе
 * сравнивается английская вёрстка с русской. Русские строки длиннее — часть
 * расхождений видна ТОЛЬКО на ru.
 *
 * ★ ОБЩИЙ для съёмки и для `--elements`. Раньше переключение жило ТОЛЬКО в
 * съёмке, и структурный разбор молча сравнивал русский макет с английской
 * реализацией: заголовок `route-sec` выходил «104 против 52, две строки против
 * одной» — расхождение, которого нет (прямой замер обеих сторон на ru: один и
 * тот же заголовок 660×104, кегль 46.4px). Режим, который зовут вердиктом,
 * обязан стоять в тех же условиях, что и триаж.
 */
async function switchLang(page) {
  if (!LANG || LANG === 'en') return;
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

/**
 * Привести ДОКУМЕНТ-прототип к нужной странице зоны.
 *
 * Прототип лендинга держит три страницы в одном файле и переключает их
 * классами на `body` (`doc-open`, `pt-open`), а наружу отдаёт свои же функции
 * `window.openDoc(name)` и `window.openTrip()`. Зовём именно их, а не ставим
 * класс руками: функция делает ещё и `render()`, `hidden=false`, resize карты и
 * сброс прокрутки — подделка класса дала бы пустой контейнер и «приёмку»
 * невидимого блока.
 *
 * ЭТО И БЫЛО ПРИЧИНОЙ, ПО КОТОРОЙ ЮР-СТРАНИЦЫ И ПУБЛИЧКА НЕ ПРИНИМАЛИСЬ НИ
 * РАЗУ: у харнесса не было способа открыть их состояние, и вывод сделали
 * неверный — что эталона не существует. Существует.
 */
async function applyProtoState(page, spec) {
  if (!spec) return;
  const [kind, which] = spec.split(':').map((s) => (s || '').trim());
  const res = await page.evaluate(async ([k, w]) => {
    if (k === 'doc') {
      if (typeof window.openDoc !== 'function') return { ok: false, why: 'у документа нет window.openDoc' };
      window.openDoc(w === 'privacy' ? 'privacy' : 'terms');
    } else if (k === 'trip') {
      if (typeof window.openTrip !== 'function') return { ok: false, why: 'у документа нет window.openTrip' };
      window.openTrip();
    } else {
      return { ok: false, why: `неизвестное состояние «${k}» (знаю doc:terms · doc:privacy · trip)` };
    }
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true };
  }, [kind, which]);
  if (!res.ok) {
    console.error(`\n--proto-state ${spec}: ${res.why}`);
    console.error('  Состояние не применилось — сравнение шло бы с ДРУГОЙ страницей, а это');
    console.error('  ровно та ложно-зелёная приёмка, ради которой харнесс и чинили.');
    process.exit(2);
  }
  await page.waitForTimeout(900);
}

/**
 * Поставить экран авторизации — на ЛЮБОЙ из сторон.
 *
 * У документа авторизации шесть экранов и три экрана приглашения, у реализации
 * те же девять, и `data-screen` у них совпадает по значениям. Различается
 * ТОЛЬКО имя класса активности: у макета `is-active`, у реализации
 * `av-is-active` (свой namespace зоны). Поэтому имя не зашито — оно снимается
 * с текущего активного экрана. Класс и есть механизм переключения у обеих
 * сторон, так что это настоящее состояние, а не его имитация.
 *
 * Без этого приёмка входа сравнивала ОДИН экран из тринадцати состояний.
 */
async function setScreen(page, id, side) {
  if (!id) return;
  const res = await page.evaluate(async (want) => {
    const all = [...document.querySelectorAll('.screen[data-screen]')];
    if (!all.length) return { ok: false, why: 'на странице нет .screen[data-screen]', have: [] };
    const to = all.find((s) => s.dataset.screen === want);
    if (!to) return { ok: false, why: `нет экрана «${want}»`, have: all.map((s) => s.dataset.screen) };
    // Имя класса активности берём с живого экрана — оно разное у сторон.
    const cur = all.find((s) => [...s.classList].some((c) => c.endsWith('is-active')));
    const activeCls = cur ? [...cur.classList].find((c) => c.endsWith('is-active')) : null;
    if (!activeCls) return { ok: false, why: 'ни один экран не активен — не с чего снять имя класса', have: [] };
    const leavingCls = activeCls.replace(/is-active$/, 'is-leaving');
    for (const s of all) { s.classList.remove(activeCls); s.classList.remove(leavingCls); }
    to.classList.add(activeCls);
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true };
  }, id);
  if (!res.ok) {
    console.error(`\n--screen ${id}: ${side} — ${res.why}`);
    if (res.have?.length) console.error(`  есть: ${[...new Set(res.have)].join(', ')}`);
    console.error('  Экран, которого нет, нельзя «принять»: сравнение шло бы с текущим.');
    process.exit(2);
  }
  await page.waitForTimeout(700);
}

/**
 * Первый ВИДИМЫЙ узел секции, а не первый в DOM.
 *
 * У авторизации все девять экранов — это `<section class="screen">` с одним и
 * тем же опознавателем, и наружу торчит ровно активный; остальные скрыты
 * `visibility:hidden`. Пока брался первый в DOM, съёмка любого экрана кроме
 * дефолтного падала «element is not visible» — то есть режим `--screen` был бы
 * мёртв ровно там, ради чего он и нужен. То же и с `body.doc-open`: скрытые
 * секции лендинга никуда не деваются.
 */
async function visibleSection(page, name) {
  for (const el of await page.$$(sectionSel(name))) {
    const ok = await el.evaluate((n) => n.getClientRects().length > 0
      && getComputedStyle(n).visibility !== 'hidden');
    if (ok) return el;
  }
  return null;
}

async function capture(browser, url, tag) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: SETTLE });

  // Состояние — ДО языка и до съёмки: openDoc/openTrip перерисовывают документ
  // целиком, поэтому переключение языка раньше них было бы затёрто.
  if (tag === 'proto') await applyProtoState(page, PROTO_STATE);
  await switchLang(page);
  await setScreen(page, SCREEN, tag === 'proto' ? 'макет' : 'реализация');

  // Что на странице вообще есть — в порядке документа. Ключ секции считает
  // общий модуль (`proto-sections.mjs`), поэтому в браузер уезжают только сырые
  // атрибуты class.
  // Только ОТРИСОВАННЫЕ: под `body.doc-open` секции лендинга скрыты
  // `display:none`, но из DOM никуда не делись — попав в список, они раздували
  // «только у макета» и уводили `first` на секцию без размеров.
  const classes = await page.$$eval(
    SECTION_SELECTOR,
    (els) => els.filter((el) => el.getClientRects().length > 0
      && getComputedStyle(el).visibility !== 'hidden').map((el) => el.getAttribute('class') || ''),
  );
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
    const el = await visibleSection(page, first);
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
    const el = await visibleSection(page, name);
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
async function elements(url, section, isProto) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: SETTLE });
  if (isProto) await applyProtoState(page, PROTO_STATE);
  await switchLang(page);
  await setScreen(page, SCREEN, isProto ? 'макет' : 'реализация');
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 350) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    document.querySelectorAll('.rv,.rv-l,.rv-r').forEach((el) => el.classList.add('in'));
  });
  await page.waitForTimeout(1200);
  const data = await page.evaluate((sel) => {
    const root = [...document.querySelectorAll(sel)].find((n) => n.getClientRects().length > 0
      && getComputedStyle(n).visibility !== 'hidden');
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
  }, sectionSel(section));
  await ctx.close();
  return data;
}

const SECTION = arg('elements');
if (SECTION) {
  const [p, i] = [await elements(PROTO, SECTION, true), await elements(IMPL, SECTION, false)];
  if (!p || !i) { console.error(`секции .${SECTION} нет с одной из сторон`); await browser.close(); process.exit(2); }
  console.log(`\nsection.${SECTION} · ${W}px · высота: макет ${p.h} / реализация ${i.h} (${i.h - p.h >= 0 ? '+' : ''}${i.h - p.h})\n`);
  console.log('элемент'.padEnd(30) + 'top'.padStart(15) + 'left'.padStart(15) + 'высота'.padStart(15) + '   кегль');
  const byKey = new Map();
  for (const it of p.items) { if (!byKey.has(it.k)) byKey.set(it.k, []); byKey.get(it.k).push(it); }

  // ★ УЗЛЫ ПАРУЮТСЯ ПО ПОРЯДКУ ВНУТРИ КЛЮЧА, и если у сторон РАЗНОЕ ЧИСЛО узлов
  // с одним ключом, всё после лишнего съезжает на соседа — отчёт начинает
  // печатать выдуманные расхождения. Ключи с расхождением по числу называем
  // вслух и помечаем их строки `?`: пусть читатель знает, где паре верить
  // нельзя. (Вторая причина ложных расхождений — разный ЯЗЫК сторон — снята
  // отдельно: `switchLang` теперь общий у съёмки и у этого режима.)
  const implCount = new Map();
  for (const it of i.items) implCount.set(it.k, (implCount.get(it.k) || 0) + 1);
  const shaky = new Set();
  for (const [k, bucket] of byKey) {
    const n = implCount.get(k) || 0;
    if (n !== bucket.length) shaky.add(k);
  }
  for (const k of implCount.keys()) if (!byKey.has(k)) shaky.add(k);
  if (shaky.size) {
    console.log(`⚠ разное число узлов у ключей: ${[...shaky].slice(0, 8).join(', ')}`
      + `${shaky.size > 8 ? ` и ещё ${shaky.size - 8}` : ''}`);
    console.log('  их строки помечены «?» — пара могла съехать, сверяй такие узлы прямым замером\n');
  }

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
    const mark = shaky.has(it.k) ? '? ' : '';
    console.log((mark + it.k).slice(0, 29).padEnd(30) + cell(was.t, it.t, dt) + cell(was.l, it.l, dl) + cell(was.h, it.h, dh) + fs);
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

// ★ НЕПАРНОЕ С ОБЕИХ СТОРОН — ОТКАЗ, А НЕ СТРОКА В ОТЧЁТЕ.
// Это почти всегда переименование, и оно выбрасывает секцию из приёмки МОЛЧА,
// УЛУЧШАЯ вердикт. Замерено на демо: первый экран назвали `dm-hero` (законно,
// `hero` занято лендингом) — худшая секция 88.5% просто исчезла из сравнения, и
// отчёт стал 44.2% с кодом выхода 0. Минус сорок четыре пункта без единой
// правки вёрстки. Молчать об этом — то же самое, чем харнесс болел раньше,
// только с другого конца.
const unpaired = unpairedVerdict(onlyProto, onlyImpl, ALLOW_UNPAIRED);
if (unpaired.blocking) {
  console.error('НЕПАРНЫЕ СЕКЦИИ С ОБЕИХ СТОРОН — приёмка не принята.');
  console.error(`  у макета:       ${unpaired.proto.join(', ')}`);
  console.error(`  у реализации:   ${unpaired.impl.join(', ')}`);
  console.error('  Одно и то же под разными именами → сопоставь: --alias <реализация>=<макет>');
  console.error('  Разные вещи → объяви вслух:        --allow-unpaired <имя>,<имя>');
  await browser.close();
  process.exit(2);
}
await browser.close();
