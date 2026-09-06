// Гейт для выпечки готовых страниц (TRIP-520).
//
// ЗАЧЕМ ИМЕННО ТЕСТ, А НЕ ГЛАЗА. Всё, что решает `compose`, невидимо на экране:
// человек и так получает то же самое приложение. Ошибка здесь проявляется ТОЛЬКО
// у того, кто JS не выполняет, — то есть у поискового робота ChatGPT и у
// краулера превью в мессенджере. Забыли снять заставку — каждый готовый файл
// показывает 700 мс пустого экрана перед готовым кадром; забыли `data-prerendered`
// — на английском файле оказывается `lang="ru"` и браузер предлагает перевод
// (ровно причина краша TRIP-515); забыли объявить стили — возвращается тот самый
// круг загрузки, ради снятия которого всё делалось.
//
// Браузера здесь нет намеренно: `compose` — чистая функция, и её гейт обязан
// работать в обычном `npm test`, а не только там, где есть chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compose } from './composePage.mjs';
import { fileFor, prerenderedDocPaths, SHELL_FILE } from './prerenderPaths.mjs';
import { prerenderedUrls } from '../../src/lib/routePaths.js';

/** Шаблон в том виде, в каком его отдаёт сборка: заставка на месте, теги общие. */
const TEMPLATE = `<!doctype html>
<html lang="en" translate="no">
  <head>
    <title>Triplanio — общий заголовок</title>
    <meta name="description" content="общее описание" />
    <meta property="og:title" content="Triplanio — общий заголовок" />
    <meta property="og:description" content="общее описание" />
    <meta property="og:image" content="https://www.triplanio.com/og-cover.jpg" />
    <meta name="twitter:title" content="Triplanio — общий заголовок" />
    <meta name="twitter:description" content="общее описание" />
    <style id="splash-css">.splash{opacity:1}</style>
  </head>
  <body>
    <div class="splash" id="splash" aria-hidden="true"><svg><path d="M0 0"/></svg></div>
    <div id="root"></div>
    <script type="module" src="/assets/main.js"></script>
  </body>
</html>`;

const SNAP = {
  lang: 'es',
  title: 'Triplanio — todo tu viaje',
  description: 'Todo tu viaje en un solo lugar.',
  root: '<main><h1>Planifica todo tu viaje</h1></main>',
  head: '  <link rel="canonical" href="https://www.triplanio.com/es">\n',
};

test('★ заставка снимается — иначе готовый кадр ждёт 700 мс ни за чем', () => {
  const html = compose(TEMPLATE, SNAP);
  assert.equal(html.includes('id="splash"'), false, 'разметка заставки осталась');
  assert.equal(html.includes('splash-css'), false, 'стили заставки остались');
  // Снялась именно заставка, а не половина документа заодно.
  assert.match(html, /<div id="root">/);
  assert.match(html, /<script type="module"/);
});

test('★ вложенный div внутри заставки не оставляет половину её на экране', () => {
  // Нежадное совпадение до первого `</div>` оборвалось бы здесь, и в готовый
  // файл уехал бы кусок заставки — поверх содержимого, без единой ошибки в лог.
  const nested = TEMPLATE.replace(
    '<svg><path d="M0 0"/></svg>',
    '<div class="mark"><svg><path d="M0 0"/></svg></div><div class="word"></div>',
  );
  const html = compose(nested, SNAP);
  assert.equal(html.includes('id="splash"'), false, 'заставка осталась');
  assert.equal(html.includes('class="mark"'), false, 'внутренность заставки осталась');
  assert.equal(html.includes('class="word"'), false, 'вторая половина заставки осталась');
  assert.match(html, /<div id="root">/, 'вместе с заставкой срезало содержимое');
});

test('★ документ объявляет свой язык и то, что он испечён', () => {
  const html = compose(TEMPLATE, SNAP);
  assert.match(html, /<html lang="es"[^>]*data-prerendered>/);
  // Признак читает пре-пейнт скрипт в index.html: без него он пересчитал бы
  // язык по браузеру и поставил бы `lang="ru"` на испанском файле.
  assert.equal((html.match(/lang="/g) || []).length >= 1, true);
  assert.equal(html.includes('lang="en"'), false, 'остался язык шаблона');
  assert.match(html, /translate="no"/, 'потеряли защиту от автоперевода');
  // ★ Класс зоны — в файле. Токены сайтовой темы объявлены на `html.site`, и без
  // класса первый кадр рисуется без темы: замер — заголовок rgb(39,36,51)
  // вместо rgb(19,50,78), фон прозрачный вместо белого.
  assert.match(html, /<html[^>]*class="site"/, 'готовая страница осталась без темы зоны');
});

test('★ стили объявлены в документе, а не подключаются потом', () => {
  assert.match(compose(TEMPLATE, SNAP), /<link id="site-css" rel="stylesheet" href="\/site\.css"/);
});

test('★ заголовок и описание — свои, и одинаковые во всех трёх местах', () => {
  const html = compose(TEMPLATE, SNAP);
  assert.match(html, /<title>Triplanio — todo tu viaje<\/title>/);
  for (const tag of ['name="description"', 'property="og:title"', 'property="og:description"',
    'name="twitter:title"', 'name="twitter:description"']) {
    assert.ok(html.includes(tag), `${tag} пропал`);
  }
  // Ровно один заголовок и одно описание на документ: пара «шаблонное + своё»
  // означала бы, что мессенджер и поисковик читают РАЗНОЕ.
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.equal((html.match(/name="description"/g) || []).length, 1);
  assert.equal(html.includes('общий заголовок'), false, 'шаблонный заголовок остался вторым');
  assert.equal(html.includes('общее описание'), false, 'шаблонное описание осталось вторым');
  // og:title обязан совпасть с <title>, иначе в одном мессенджере одно, в другом другое.
  assert.ok(html.includes(`content="${SNAP.title}"`));
  // og:image шаблонный и остаётся: своей картинки у страницы нет.
  assert.match(html, /og:image" content="https:\/\/www\.triplanio\.com\//);
});

test('★ содержимое приезжает в документе — ради этого всё и делалось', () => {
  const html = compose(TEMPLATE, SNAP);
  assert.ok(html.includes(SNAP.root), 'содержимое не попало в файл');
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.triplanio\.com\/es">/);
});

test('кавычки и угловые скобки в заголовке не ломают разметку', () => {
  const html = compose(TEMPLATE, { ...SNAP, title: 'A "quoted" <b>title</b> & more' });
  assert.ok(html.includes('&quot;quoted&quot;'), 'кавычка не экранирована — атрибут оборван');
  assert.equal(html.includes('<b>title</b></title>'), false, 'разметка из заголовка уехала в документ');
});

test('файл адреса: каталог + index.html, чтобы /es и /es/ были одним адресом', () => {
  assert.equal(fileFor('/'), 'index.html');
  assert.equal(fileFor('/es'), 'es/index.html');
  assert.equal(fileFor('/ru/d/europe-may-2027'), 'ru/d/europe-may-2027/index.html');
  assert.equal(fileFor('/terms'), 'terms/index.html');
  // Оболочка занимает СВОЁ имя: `index.html` отдан лендингу.
  assert.notEqual(SHELL_FILE, 'index.html');
  assert.equal(prerenderedDocPaths().length, prerenderedUrls().length);
  assert.equal(new Set(prerenderedDocPaths()).size, prerenderedUrls().length, 'два адреса метят в один файл');
});
