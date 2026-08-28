import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Что здесь держится (TRIP-478). У экрана запуска нет ни скриншота, ни гарда:
// он снимается СОБЫТИЯМИ, а не значением, поэтому регресс выглядит как
// «всё работает» — заставка уходит, просто на полсекунды раньше, и человек
// получает обратно второе ожидание, ради устранения которого задача и делалась.
// Единственный гейт — этот тест.
//
// Главный случай — ЭСТАФЕТА (последний тест): ожидание переходит между разными
// позициями дерева (словарь → <Suspense> маршрута), React выполняет очистку
// уехавшего раньше эффекта приехавшего, и между ними удержаний ноль. Первая
// версия снимала заставку ровно в эту щель, и на /trips после входа было видно
// два лоудера подряд — splash, затем спиннер загрузки чанка экрана.
//
// Состояние живёт в модульных переменных, поэтому каждый сценарий берёт СВЕЖИЙ
// модуль (`?case=` — cache-buster для ESM). DOM подставляем руками: узел
// заставки приезжает из index.html, в node его нет.
async function freshSplash(caseId) {
  const el = {
    attrs: /** @type {Record<string, string>} */ ({}),
    removed: false,
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { this.removed = true; },
  };
  const timers = [];
  const realDoc = globalThis.document;
  const realTimeout = globalThis.setTimeout;

  globalThis.document = /** @type {any} */ ({ getElementById: (id) => (id === 'splash' ? el : null) });
  // Таймеры собираем вместе с их задержкой, а не ждём: тест про ПОРЯДОК
  // событий. Задержка нужна, чтобы отделить обычный ход от ПОТОЛКА (10 с) —
  // иначе любой прогон таймеров снимал бы заставку по потолку и тест проверял
  // бы не то поведение.
  globalThis.setTimeout = /** @type {any} */ ((fn, ms = 0) => { timers.push({ fn, ms }); return 0; });

  const mod = await import(`./splash.js?case=${caseId}`);
  const runUpTo = (limit) => {
    for (let i = 0; i < timers.length; i += 1) {
      if (timers[i].ms >= limit) continue;
      const { fn } = timers.splice(i, 1)[0];
      i -= 1;
      fn();
    }
  };
  return {
    ...mod,
    el,
    // Решение о снятии откладывается на микрозадачу — она встаёт в очередь
    // раньше этого await, поэтому одного тика достаточно.
    tick: () => Promise.resolve(),
    flush: () => runUpTo(5000),      // обычный ход: всё, кроме потолка
    flushCeiling: () => runUpTo(Infinity),
    restore: () => { globalThis.document = realDoc; globalThis.setTimeout = realTimeout; },
  };
}

test('готовность приложения не снимает заставку, пока на экране ожидание', async () => {
  const s = await freshSplash('held');
  try {
    s.holdSplash();          // смонтировался <AppLoading>
    s.hideSplash();          // приложение отчиталось о готовности
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], undefined, 'заставка ушла поверх живого ожидания');
  } finally { s.restore(); }
});

test('снятие последнего удержания после отчёта о готовности снимает заставку', async () => {
  const s = await freshSplash('release');
  try {
    const release = s.holdSplash();
    s.hideSplash();
    release();               // <AppLoading> размонтировался
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], '');
    assert.equal(s.el.removed, true, 'узел заставки остался в дереве');
  } finally { s.restore(); }
});

test('ожидание, кончившееся ДО отчёта о готовности, заставку не снимает', async () => {
  const s = await freshSplash('early');
  try {
    s.holdSplash()();        // ожидание мелькнуло и ушло
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], undefined, 'ожидание сняло заставку за приложение');
  } finally { s.restore(); }
});

test('без единого ожидания заставку снимает сам отчёт о готовности', async () => {
  const s = await freshSplash('plain');
  try {
    s.hideSplash();
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], '');
  } finally { s.restore(); }
});

test('краш снимает заставку мимо удержаний и без отсрочки', async () => {
  const s = await freshSplash('crash');
  try {
    s.holdSplash();          // ожидание уехало вместе с упавшим поддеревом
    s.hideSplash({ crashed: true });
    s.flush();               // без await: экран краха не ждёт микрозадачи
    assert.equal(s.el.attrs['data-out'], '', 'экран краха остался под заставкой');
  } finally { s.restore(); }
});

test('повторные вызовы безвредны', async () => {
  const s = await freshSplash('idempotent');
  try {
    s.hideSplash();
    s.hideSplash();
    await s.tick();
    s.flush();
    s.hideSplash();
    await s.tick();
    s.flush();
    assert.equal(s.el.removed, true);
  } finally { s.restore(); }
});

test('эстафета между двумя ожиданиями одного коммита заставку не роняет', async () => {
  const s = await freshSplash('relay');
  try {
    const dict = s.holdSplash();   // ожидание словаря
    s.hideSplash();                // приложение готово
    // Один коммит React: сперва очистка уехавшего, следом эффект приехавшего.
    dict();
    const route = s.holdSplash();  // <Suspense fallback> маршрута
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], undefined, 'заставка ушла в щель между ожиданиями');

    route();                       // чанк экрана приехал — ожиданий больше нет
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], '', 'заставка не ушла, когда всё готово');
  } finally { s.restore(); }
});


// ★ ПРАВИЛО ЦЕЛИКОМ, А НЕ ТОЛЬКО ЕГО ЛОГИКА. Всё, что откладывает первый
// читаемый кадр, обязано пройти через <AppLoading> — только он держит заставку.
// Дыра была ровно в обходе: `<Suspense fallback={null}>` — тоже ожидание, но
// молча, поэтому заставка его не видела и уходила в пустой кадр. Теперь у
// молчаливого ожидания есть свой облик (`<AppLoading silent />`), и этот тест
// закрывает возврат к обходу: он ищет `fallback={null}` во всём src.
//
// Ловит именно РЕГРЕСС ПРАВИЛА, а не опечатку: `fallback={null}` пишется легко
// и выглядит невинно — «мне тут нечего показать», — а стоит пустого кадра
// между заставкой и страницей.
function jsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return jsxFiles(full);
    return e.isFile() && e.name.endsWith('.jsx') ? [full] : [];
  });
}

test('молчаливое ожидание идёт через <AppLoading silent>, а не через fallback={null}', () => {
  const offenders = jsxFiles('src')
    .filter((f) => /<Suspense[^>]*fallback=\{null\}/s.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, [],
    'fallback={null} — ожидание, невидимое для экрана запуска: между заставкой и '
    + 'страницей появится пустой кадр. Нужен <AppLoading silent />.');
});

test('потолок снимает заставку даже под вечным удержанием', async () => {
  const s = await freshSplash('ceiling');
  try {
    s.holdSplash();          // ожидание, которое никогда не кончится:
                             // site.css отдал 404, запрос завис
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], undefined, 'ушла раньше потолка');

    s.flushCeiling();        // прошло 10 секунд
    s.flush();
    assert.equal(s.el.attrs['data-out'], '',
      'заставка заперла экран навсегда: под ней уже ничего не появится');
  } finally { s.restore(); }
});

// ★ ОДИН ИСТОЧНИК, А НЕ ДВЕ ПОХОЖИЕ КОПИИ (TRIP-478). Заставка живёт в
// дизайн-системе (`src/design/splash.css` + `.html`) и попадает в документ
// подстановкой на сборке; витрина `/kit/splash` рисует ТЕ ЖЕ файлы. Впиши
// разметку или стили обратно в `index.html` — и копии начнут расходиться
// молча: витрина будет показывать одно, человек при запуске видеть другое,
// а гарды дизайн-системы перестанут видеть заставку вовсе (index.html вне
// их периметра). Поэтому в документе допустимы ТОЛЬКО плейсхолдеры.
test('в index.html нет копии заставки — только плейсхолдеры', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.ok(html.includes('<!--splash:style-->'), 'потерян плейсхолдер стилей');
  assert.ok(html.includes('<!--splash:markup-->'), 'потерян плейсхолдер разметки');
  assert.equal(/\.splash\s*\{/.test(html), false, 'стили заставки вписаны в index.html копией');
  assert.equal(html.includes('class="splash"'), false, 'разметка заставки вписана в index.html копией');
});

// ★ КОПИЮ ЦВЕТА ДЕРЖИТ ТЕСТ, А НЕ ОБЕЩАНИЕ. `var()` на заставке не работает
// физически: `app.css` с токенами приезжает вместе с бандлом, то есть ПОЗЖЕ
// первого кадра. Значения приходится дублировать литералами — но расхождение
// с темой видно только глазом и только на первых полсекунды запуска, поэтому
// сверку делает тест. Синий знака сюда не входит: это константа
// логотипа, одна в обеих темах.
test('цвета заставки = токены темы из app.css', () => {
  const app = readFileSync('src/design/app.css', 'utf8');
  const splash = readFileSync('src/design/splash.css', 'utf8');

  // Токены светлой темы объявлены в `:root{…}`, тёмной — в `:root[data-theme="dark"]{…}`.
  const block = (re) => app.match(re)?.[1] ?? '';
  const light = block(/:root\s*\{([\s\S]*?)\n\}/);
  const dark = block(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  const token = (src, name) => src.match(new RegExp(`--${name}:\\s*([#\\w().,\\s-]+?);`))?.[1]?.trim();

  const expected = {
    'фон, светлая':  token(light, 'bg'),
    'фон, тёмная':   token(dark, 'bg'),
    'слово, светлая': token(light, 'ink'),
    'слово, тёмная':  token(dark, 'ink'),
  };
  for (const [what, value] of Object.entries(expected)) {
    assert.ok(value, `не найден токен темы для «${what}» — изменилась форма app.css, сверка ослепла`);
    assert.ok(
      splash.toLowerCase().includes(value.toLowerCase()),
      `${what}: в splash.css нет значения ${value} из app.css — заставка разъедется с приложением`,
    );
  }
});
