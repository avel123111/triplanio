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
import middleware from '../../middleware.js';

const BOT = 'TelegramBot (like TwitterBot)';
const HUMAN = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const ask = (path, ua) => middleware(new Request(`https://www.triplanio.com${path}`, { headers: { 'user-agent': ua } }));
const bodyOf = async (res) => (res ? res.text() : null);

/* ── человек не должен получать превью НИКОГДА ───────────────────────────── */

test('★ живой человек получает приложение на ЛЮБОМ адресе, а не HTML-заглушку', () => {
  for (const p of ['/', '/join/abc', '/public/trip/xyz', '/d/europe-may-2027', '/terms', '/privacy']) {
    assert.equal(ask(p, HUMAN), undefined, p);
  }
});

/* ── бот получает превью там, где мы его объявили ────────────────────────── */

test('бот получает СВОЁ превью на каждой из пяти поверхностей', async () => {
  const cases = [
    ['/join/tok123', 'invited'],
    ['/public/trip/00000000-0000-0000-0000-000000000000', 'A trip on Triplanio'],
    ['/d/europe-may-2027', 'Demo trip'],
    ['/terms', 'Terms of Service'],
    ['/privacy', 'Privacy Policy'],
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
  for (const p of ['/d/europe-may-2027', '/terms', '/privacy']) {
    assert.match(await bodyOf(ask(p, BOT)), /robots" content="index,follow"/, `${p} обязан индексироваться`);
  }
});

test('чужой адрес боту не подменяется — превью только там, где объявлено', () => {
  for (const p of ['/', '/login', '/trips', '/pro', '/d', '/publicity', '/termsandconditions']) {
    assert.equal(ask(p, BOT), undefined, p);
  }
});

test('слаг демо матчится ПРЕФИКСОМ — он уже переезжал один раз', () => {
  // spain-may-27 → europe-may-2027. Превью не должно быть третьим местом, где
  // слаг надо не забыть поправить.
  assert.ok(ask('/d/spain-may-27', BOT), 'старый слаг');
  assert.ok(ask('/d/whatever-next', BOT), 'будущий слаг');
});

test('пустой User-Agent — это не бот: отдаём приложение', () => {
  assert.equal(ask('/d/europe-may-2027', ''), undefined);
});

test('битый запрос не роняет страницу — превью не имеет права быть точкой отказа', () => {
  assert.doesNotThrow(() => middleware({ url: 'не-адрес', headers: { get: () => BOT } }));
  assert.doesNotThrow(() => middleware({ url: 'https://x/y', headers: null }));
});
