/**
 * Превью ссылок для краулеров (`middleware.js`) — TRIP-445, Ф11.
 *
 * ПОЧЕМУ У ЭТОГО ЕСТЬ ТЕСТ. Ошибиться тут можно только МОЛЧА: превью видит не
 * автор, а получатель ссылки в чужом мессенджере, и «отдали не то» выглядит
 * ровно как «всё работает». Два способа сломать, оба беззвучные:
 *   · перепутать ветку — и человек получит HTML-заглушку вместо приложения
 *     (страница просто перестанет открываться, но только у части браузеров);
 *   · снять `noindex` там, где в адресе одноразовый токен, — и ссылка-приглашение
 *     или публичная поездка уедут в поисковый индекс вместе с токеном доступа.
 *
 * Тест живёт в `scripts/ci/`, а не рядом с самим файлом в корне: `npm test`
 * собирает только `.test.js` под `src` и `.test.mjs` под `scripts`. Корневой
 * `middleware.test.js` в прогон бы не попал — то есть был бы тестом, которого
 * никто не запускает.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import middleware from '../../middleware.js';
import { DEMO_PATH } from '../../src/pages/Demo/demoPath.js';
import { PRERENDERED_PAGES, LOCALISED_PAGES, PREFIXED_LANGS, withLangPath } from '../../src/lib/routePaths.js';

const BOT = 'TelegramBot (like TwitterBot)';
/** Поисковики — они выполняют JS и обязаны получить ПРИЛОЖЕНИЕ, а не заглушку. */
const SEARCH = {
  Googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  Bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  YandexBot: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  DuckDuckBot: 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
};
const HUMAN = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const ask = (path, ua) => middleware(new Request(`https://www.triplanio.com${path}`, { headers: { 'user-agent': ua } }));

// ★ СЕТЬ ЗАГЛУШЕНА. Ветка 404 берёт тело у самого приложения
// (`fetch('/index.html')`), и без подмены этот тест ходил бы за ним в ЖИВОЙ
// прод — из CI, на каждый прогон. Заглушка отдаёт узнаваемую оболочку, чтобы
// проверять можно было именно «тело = приложение», а не «интернет доступен».
const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';
globalThis.fetch = async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } });
const bodyOf = async (res) => (res ? res.text() : null);
const readMiddleware = () => readFileSync(new URL('../../middleware.js', import.meta.url), 'utf8');

/* ── человек не должен получать превью НИКОГДА ───────────────────────────── */

test('★ живой человек получает приложение на ЛЮБОМ адресе, а не HTML-заглушку', () => {
  for (const p of ['/', '/join/abc', '/public/trip/xyz', DEMO_PATH, '/terms', '/privacy']) {
    assert.equal(ask(p, HUMAN), undefined, p);
  }
});

/* ── бот получает превью там, где мы его объявили ────────────────────────── */

test('бот получает СВОЁ превью там, где готового файла нет и быть не может', async () => {
  // ★ ПОВЕРХНОСТЕЙ ОСТАЛОСЬ ДВЕ (TRIP-520). Демо и юр-страницы уехали отсюда не
  // потому, что превью им не нужно, а потому, что оно у них теперь СВОЁ: эти
  // страницы приезжают готовыми файлами, og-теги в которых выведены из
  // настоящего заголовка при выпечке. Заглушка рядом с файлом означала бы два
  // описания одной страницы в двух местах — и первое же изменение текста
  // разошлось бы молча. Проверку, что замена на месте, держит `prerender.test.mjs`.
  //
  // Здесь остаётся то, что испечь нельзя по построению: у приглашения и
  // публичной поездки содержимое своё у КАЖДОЙ ссылки, а в адресе одноразовый
  // токен.
  const cases = [
    ['/join/tok123', 'invited'],
    ['/public/trip/00000000-0000-0000-0000-000000000000', 'A trip on Triplanio'],
  ];
  for (const [path, marker] of cases) {
    const res = ask(path, BOT);
    assert.ok(res, `${path}: превью не отдано`);
    assert.equal(res.status, 200, path);
    const html = await bodyOf(res);
    assert.match(html, new RegExp(marker, 'i'), path);
    // og:title и twitter:title обязаны совпадать с <title> — рассинхрон тут
    // означает «в одном мессенджере одно, в другом другое».
    const title = html.match(/<title>([^<]*)<\/title>/)[1];
    assert.ok(html.includes(`property="og:title" content="${title}"`), `${path}: og:title разошёлся с <title>`);
    assert.ok(html.includes(`name="twitter:title" content="${title}"`), `${path}: twitter:title разошёлся с <title>`);
    assert.match(html, /og:image" content="https:\/\/www\.triplanio\.com\//, `${path}: og:image должен быть АБСОЛЮТНЫМ`);
  }
});

test('★★★ адрес с одноразовым токеном закрыт от индексации, публичный — открыт', async () => {
  // Приглашение и публичная поездка несут токен доступа В АДРЕСЕ: попасть в
  // поисковый индекс им нельзя. Демо и юр-страницы, наоборот, живут в
  // sitemap.xml и обязаны индексироваться.
  for (const p of ['/join/tok123', '/public/trip/abc']) {
    assert.match(await bodyOf(ask(p, BOT)), /robots" content="noindex"/, `${p} обязан быть noindex`);
  }
  // Индексируемые страницы заглушки больше не получают вовсе — у них свой файл.
  for (const p of [DEMO_PATH, '/terms', '/privacy']) {
    assert.equal(ask(p, BOT), undefined, `${p} обязан отдаваться готовым файлом, а не заглушкой`);
    assert.equal(PRERENDERED_PAGES.includes(p), true, `${p} перестал печься — тогда заглушку убирать было нельзя`);
  }
});

test('★★★ ПОИСКОВИК получает приложение на ИНДЕКСИРУЕМОМ адресе — иначе в индекс уедет пустая страница', () => {
  // Найдено на живом проде 27.08: Googlebot получал 1231 байт заглушки вместо
  // 7183 байт приложения на /terms и /d/…, причём с `index,follow`. То есть в
  // индекс уезжала страница с одним заголовком в теле — ровно на тех двух
  // адресах, которые мы сами объявили в sitemap.xml. Краулер превью JS не
  // выполняет и заглушку требует; поисковик его выполняет и обязан получить
  // настоящую страницу. Один список UA на обоих — выбор в пользу одного за
  // счёт другого.
  for (const [name, ua] of Object.entries(SEARCH)) {
    for (const p of ['/', '/terms', '/privacy', '/d/europe-may-2027']) {
      assert.equal(ask(p, ua), undefined, `${name} на ${p} обязан получить приложение`);
    }
  }
});

test('★★★ ПОИСКОВИК на ТОКЕН-адресе получает заглушку с noindex — иначе токен уедет в индекс', async () => {
  // Обратная сторона предыдущего теста, и первая его редакция ЗАПИРАЛА ЗДЕСЬ БАГ:
  // она требовала приложение и на `/join/`, и на `/public/trip/`. А в приложении
  // `noindex` нет вовсе (проверено грепом по `src/**`), в `robots.txt` — `Allow: /`
  // (намеренно: `Disallow` не дал бы краулеру ЗАГРУЗИТЬ страницу и прочитать её
  // `noindex`). То есть разделение аудиторий молча сняло единственную защиту
  // именно с тех двух адресов, у которых в URL лежит одноразовый токен доступа.
  //
  // Правило: маска широкая там, где индексировать НЕЛЬЗЯ (терять в поиске нечего),
  // и поимённая там, где НУЖНО.
  for (const [name, ua] of Object.entries(SEARCH)) {
    for (const p of ['/join/tok', '/public/trip/abc?t=secret']) {
      const res = ask(p, ua);
      assert.ok(res, `${name} на ${p} обязан получить заглушку, а не приложение`);
      assert.match(await bodyOf(res), /<meta name="robots" content="noindex">/,
        `${name} на ${p}: заглушка обязана нести noindex`);
    }
  }
});

test('★★ незнакомый краулер на токен-адресе тоже получает noindex, а человек — нет', async () => {
  // Цена поимённого списка на токен-адресе была бы «незнакомый бот проиндексирует
  // токен», поэтому здесь маска по признаку бота, а не по имени.
  const res = ask('/public/trip/abc?t=secret', 'SomeUnknownCrawler/1.0 (+spider)');
  assert.ok(res, 'незнакомый краулер обязан получить заглушку');
  assert.match(await bodyOf(res), /noindex/);
  assert.equal(ask('/public/trip/abc?t=secret', HUMAN), undefined,
    'человек на том же адресе обязан получить приложение');
});

test('чужой адрес боту не подменяется — превью только там, где объявлено', async () => {
  // Существующие адреса без превью: бот идёт в приложение, как и человек.
  for (const p of ['/', '/login', '/trips', '/pro']) {
    assert.equal(ask(p, BOT), undefined, p);
  }
  // ★ А НЕСУЩЕСТВУЮЩИЕ теперь отвечают 404 — ВСЕМ, включая краулер превью
  // (TRIP-497). Раньше здесь стоял `undefined`, то есть бот получал 200 и
  // содержимое главной под любым набором букв. Превью при этом по-прежнему нет:
  // его не на что вешать.
  for (const p of ['/d', '/publicity', '/termsandconditions']) {
    const res = await ask(p, BOT);
    assert.equal(res?.status, 404, `${p} обязан отдать 404`);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex', `${p}: 404 обязан нести запрет индексации`);
    assert.match(await bodyOf(res), /id="root"/, `${p}: тело 404 — приложение, а не заглушка края`);
  }
});

test('★★ демо — ТОЧНЫЙ адрес: несуществующий слаг не получает превью', async () => {
  // Найдено ревью-ботом на PR #1030. Префикс `/d/` отдавал боту 200 и
  // индексируемое превью на ЛЮБОЙ слаг, включая опечатку и мёртвую ссылку, —
  // при том что человеку там 404 (маршрут точный, `demoPath.js`). Превью,
  // расходящееся со страницей, — это ложная запись в поисковом индексе.
  // ПЕРЕЕХАВШИЙ слаг — особый случай: страницы нет, но есть постоянный редирект
  // в `vercel.json`. Оборви его 404-м, и вместо переезда на канонический адрес
  // человек получит «не найдено», а накопленный ссылочный вес пропадёт.
  assert.equal(ask('/d/spain-may-27', BOT), undefined, 'адрес с редиректом обязан дойти до платформы');
  // Остальные чужие слаги — 404 (TRIP-497), и превью на них по-прежнему нет.
  for (const p of ['/d/whatever-next', '/d/not-real', '/d/']) {
    const res = await ask(p, BOT);
    assert.equal(res?.status, 404, p);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex', `${p}: 404 обязан нести запрет индексации`);
  }
  // Канонический адрес заглушки больше не получает — у него свой готовый файл.
  assert.equal(ask(DEMO_PATH, BOT), undefined, 'у демо теперь свой файл, заглушка ему не нужна');
});

test('адрес демо берётся из общей константы, а не переписан здесь', () => {
  // Пятая копия слага — это ровно тот способ сломать ссылку молча, от которого
  // `demoPath.js` и заведён.
  assert.equal(DEMO_PATH, '/d/europe-may-2027');
  assert.ok(!/\/d\/[a-z0-9-]+/.test(readMiddleware()), 'слаг демо вписан в middleware.js литералом');
});

test('пустой User-Agent — это не бот: отдаём приложение', () => {
  assert.equal(ask('/d/europe-may-2027', ''), undefined);
});

test('битый запрос не роняет страницу — превью не имеет права быть точкой отказа', () => {
  assert.doesNotThrow(() => middleware({ url: 'не-адрес', headers: { get: () => BOT } }));
  assert.doesNotThrow(() => middleware({ url: 'https://x/y', headers: null }));
});

/* ── рекламная ссылка приземляется на СВОЙ файл, а не на английский ───────── */

test('★ ?lang= на переведённой странице уводит на её языковой адрес', () => {
  // До выпечки язык из параметра применялся уже в браузере — это был
  // единственный способ. Теперь у испанской страницы есть свой файл, и оставь мы
  // прежнее поведение, платный посетитель получал бы АНГЛИЙСКИЙ файл, который
  // через полторы секунды перерисовывался бы в испанский.
  for (const lang of PREFIXED_LANGS) {
    for (const path of LOCALISED_PAGES) {
      const res = ask(`${path}?lang=${lang}`, HUMAN);
      assert.ok(res, `${path}?lang=${lang}: переезда нет`);
      assert.equal(res.status, 307, 'переезд обязан быть временным — адрес зависит от параметра');
      assert.equal(res.headers.get('location'), withLangPath(lang, path), `${path}?lang=${lang}`);
    }
  }
});

test('★ метка кампании переживает переезд по языку', () => {
  // Метка живёт В АДРЕСЕ (TRIP-514). Потеряй её переезд — и весь платный трафик
  // на языковую страницу стал бы неатрибутированным, молча.
  const res = ask('/?lang=es&camp_source=google&camp_campaign=es_launch', HUMAN);
  const loc = res.headers.get('location');
  assert.match(loc, /^\/es\?/, `ушли не на испанский адрес: ${loc}`);
  assert.match(loc, /camp_source=google/, 'метка кампании потеряна');
  assert.match(loc, /camp_campaign=es_launch/, 'метка кампании потеряна');
  assert.doesNotMatch(loc, /lang=/, 'параметр языка остался и снова сработает на новом адресе');
});

test('?lang= НЕ трогает страницы без языкового адреса и мусорные значения', () => {
  // У входа и публичной поездки готового файла на язык нет — там параметр
  // работает как работал, уже в браузере.
  for (const p of ['/login?lang=es', '/public/trip/abc?lang=ru', '/terms?lang=ru']) {
    assert.equal(ask(p, HUMAN), undefined, `${p} не должен никуда переезжать`);
  }
  assert.equal(ask('/?lang=de', HUMAN), undefined, 'неизвестный язык не должен порождать переезд');
  assert.equal(ask('/?lang=en', HUMAN), undefined, 'английский живёт без префикса — переезжать некуда');
});
