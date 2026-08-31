/**
 * Несуществующий адрес отвечает 404 НА КРАЮ (TRIP-497).
 *
 * ПОЧЕМУ У ЭТОГО ЕСТЬ ТЕСТ, И ПОЧЕМУ ОН СТРОГИЙ. Цена ошибки здесь
 * НЕСИММЕТРИЧНА, и обе стороны молчаливые:
 *   · забыли адрес в списке → живой экран отдаёт «страница не найдена» ВСЕМ, и
 *     узнаем мы об этом от пользователя, а не от гарда;
 *   · пропустили лишнее → всё выглядит рабочим, просто индексаторы продолжают
 *     считать выдуманные адреса страницами — то, ради чего правка и делалась.
 *
 * Замер 31.08 на проде: выдуманный адрес, названный в тексте публичного PR, за
 * два часа собрал десяток заходов (часть — с реферером bing.com), и каждому был
 * отдан 200 с содержимым главной. Приложение к тому моменту уже умело рисовать
 * свою 404 — но только ПОСЛЕ выполнения JavaScript, которого у этих гостей нет.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import middleware from '../../middleware.js';
import { DEMO_PATH } from '../../src/pages/Demo/demoPath.js';
import { isKnownPath } from '../../src/lib/routePaths.js';

const HUMAN = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const AI = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot';

// Сеть заглушена: ветка 404 берёт тело у приложения, и без подмены тест ходил
// бы за ним в живой прод из CI.
const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';
globalThis.fetch = async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } });

const ask = (path, ua = HUMAN) => middleware(new Request(`https://www.triplanio.com${path}`, { headers: { 'user-agent': ua } }));

/* ── что обязано дойти до приложения ─────────────────────────────────────── */

test('★★★ существующий адрес НЕ перехватывается — ни один живой экран не 404-ит', () => {
  const alive = [
    '/', '/login', '/reset-password', '/terms', '/privacy', DEMO_PATH,   // зона
    '/trips', '/stats', '/new-trip', '/settings', '/inbox', '/pro', '/plan-trip-ai', // приложение
    '/trip/0f2e48be-7a98-4ec1-a0b7-a74f91a6418f', '/trip/abc/edit',      // с параметром
    '/join/token123', '/public/trip/abc',                                // свои ветки
    '/kit', '/kit/splash',                                               // витрина вне прода
    '/api/getTripDetails', '/ingest/e',                                  // rewrite'ы
    '/assets/index-AbC123.js', '/robots.txt', '/sitemap.xml', '/llms.txt', '/site.css', // статика
    '/terms/',                                                           // хвостовой слэш
  ];
  for (const p of alive) assert.equal(ask(p), undefined, `${p} обязан дойти до приложения`);
});

test('★★ переехавший слаг доходит до платформы — иначе редирект не сработает', () => {
  // У `/d/spain-may-27` страницы нет, но есть постоянный редирект в vercel.json.
  assert.equal(ask('/d/spain-may-27'), undefined);
});

test('источники редиректов из vercel.json известны предикату — списки не могут разъехаться', () => {
  const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  for (const { source } of cfg.redirects ?? []) {
    assert.equal(isKnownPath(source), true,
      `${source} объявлен редиректом в vercel.json, но предикат считает его несуществующим — край оборвёт переезд`);
  }
});

/* ── что обязано отвечать 404 ────────────────────────────────────────────── */

test('★★★ несуществующий адрес отвечает 404 с запретом индексации', async () => {
  for (const p of ['/kakoy-to-mysor', '/d/opechatka', '/trips/extra', '/settings/lишнее', '/pricing']) {
    const res = await ask(p);
    assert.ok(res, `${p}: край обязан ответить сам`);
    assert.equal(res.status, 404, p);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex', `${p}: 404 обязан нести запрет`);
  }
});

test('★★ тело 404 — само приложение, а не заглушка края', async () => {
  // Человек по битой ссылке обязан увидеть нашу 404 со стилями и шапкой.
  // Меняются только статус и заголовок.
  const body = await (await ask('/kakoy-to-mysor')).text();
  assert.match(body, /id="root"/);
});

test('★★★ краулер движка ответов получает тот же честный 404, что и человек', async () => {
  // Ради него всё и делалось: JavaScript он не выполняет, поэтому `noindex` из
  // приложения до него не доходит — только статус и заголовок.
  const res = await ask('/kakoy-to-mysor', AI);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
});

test('★ 404 не кэшируется надолго — сегодняшний мусор завтра может стать страницей', async () => {
  const cc = (await ask('/kakoy-to-mysor')).headers.get('cache-control');
  assert.match(cc, /max-age=0|no-cache|must-revalidate/);
});

test('падение сети не превращает 404 в 200', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('сеть легла'); };
  try {
    const res = await ask('/kakoy-to-mysor');
    assert.equal(res.status, 404, 'без оболочки статус обязан остаться 404');
    assert.match(await res.text(), /noindex/, 'минимальное тело обязано нести запрет');
  } finally {
    globalThis.fetch = saved;
  }
});

/* ── предикат отдельно от края ───────────────────────────────────────────── */

test('предикат: шаблон с параметром совпадает только по числу сегментов', () => {
  assert.equal(isKnownPath('/trip/abc'), true);
  assert.equal(isKnownPath('/trip/abc/edit'), true);
  assert.equal(isKnownPath('/trip'), false);
  assert.equal(isKnownPath('/trip/abc/edit/more'), false);
  assert.equal(isKnownPath('/trip//edit'), false, 'пустой параметр — это не адрес поездки');
});

test('предикат: файлоподобное имя отдаётся платформе, а не нам', () => {
  // Пропавший чанк уже отдаёт 404 сам (TRIP-284), выдумывать второе правило для
  // статики нельзя: их разъезд молча вернёт HTML под именем .js.
  assert.equal(isKnownPath('/assets/nosuch-AbC123.js'), true);
  assert.equal(isKnownPath('/nosuch.txt'), true);
  assert.equal(isKnownPath('/nosuch'), false);
});
