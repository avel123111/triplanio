import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANG_STORAGE_KEY, LANG_PARAM, LANGUAGES } from './translations.js';
import { LOCALISED_PAGES, PREFIXED_LANGS, DEFAULT_LANG, APP_ROUTES, withLangPath } from '../routePaths.js';

// TRIP-515. Причина краша от автоперевода — статический lang="en" в index.html:
// пока React не выставил настоящий язык, Chrome/Safari решают «страница
// английская» и предлагают перевод, а переводчик удаляет наши текстовые узлы →
// insertBefore бросает (краш) и nodeValue уходит в никуда (залипший текст).
//
// Лечение п.1 — translate="no" на <html> + пре-пейнт <script>, ставящий верный
// lang СИНХРОННО, до кадра. Скрипт — РУЧНАЯ КОПИЯ detectLandingLang(): пре-пейнт
// скрипт модуль импортировать не может. Значит логика продублирована, и дубль
// молча разъезжается с оригиналом ровно на переименовании ключа/параметра.
// Комментарий такое не ловит — ловит этот тест: литералы в index.html обязаны
// побайтно совпасть с экспортами translations.js.
const html = readFileSync('index.html', 'utf8');

test('документ выведен из-под машинного перевода (translate="no" на <html>)', () => {
  assert.match(
    html,
    /<html[^>]*\btranslate="no"/,
    'нет translate="no" на <html> — встроенный переводчик снова предложит перевод и будет ломать DOM',
  );
});

test('пре-пейнт скрипт несёт ТОТ ЖЕ ключ / параметр / коды, что translations.js', () => {
  assert.ok(
    html.includes(`'${LANG_STORAGE_KEY}'`),
    `index.html не содержит ключ хранилища '${LANG_STORAGE_KEY}' из translations.js — дубль detectLandingLang разъехался`,
  );
  assert.ok(
    html.includes(`'${LANG_PARAM}'`),
    `index.html не содержит имя параметра '${LANG_PARAM}' из translations.js — дубль detectLandingLang разъехался`,
  );
  for (const { code } of LANGUAGES) {
    assert.ok(
      html.includes(`'${code}'`),
      `index.html не содержит код языка '${code}' из LANGUAGES — набор языков разъехался с пре-пейнт скриптом`,
    );
  }
});

test('скрипт действительно выставляет lang ДО кадра', () => {
  assert.match(
    html,
    /document\.documentElement\.setAttribute\(\s*'lang'/,
    'скрипт не выставляет lang — Chrome решит про язык раньше по статике',
  );
});

/* ─────────────────────────────────────────────────────────────────────────────
 * ПРЕ-ПЕЙНТ СКРИПТ ИСПОЛНЯЕТСЯ, А НЕ ГРЕПАЕТСЯ (TRIP-533).
 *
 * Он перестал быть «поставить атрибут» и стал РАЗВИЛКОЙ: беспрефиксный адрес
 * страницы зоны отправляет посетителя на его языковой адрес. У редиректа цена
 * ошибки другая — петля, потерянный запрос, уведённый краулер, — и грепом по
 * литералам такое не проверяется. Поэтому скрипт вынимается из `index.html` и
 * запускается с подставными `location` / `localStorage` / `document`.
 * ───────────────────────────────────────────────────────────────────────────── */

/** Тело пре-пейнт скрипта из index.html (тот, что знает ключ хранилища). */
function prepaintSource() {
  // ★ HTML-КОММЕНТАРИИ ГАСЯТСЯ ПЕРВЫМИ. Докблок над самим скриптом содержит
  // слово `<script>` в прозе, и разбор без этого стартовал с середины
  // комментария: в «исходник» приезжала русская проза, а тест падал
  // синтаксической ошибкой вместо того, чтобы проверять развилку.
  const code = html.replace(/<!--[\s\S]*?-->/g, '');
  const blocks = [...code.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((b) => b.includes(LANG_STORAGE_KEY));
  assert.ok(found, 'в index.html нет пре-пейнт скрипта со ссылкой на ключ хранилища');
  return found;
}

/**
 * Прогнать скрипт на выдуманной странице.
 * @returns {{redirect: string|null, lang: string}}
 */
function run({ path = '/', search = '', hash = '', stored = null, prerendered = false, navLang = 'en-US' } = {}) {
  let redirect = null;
  let lang = prerendered ? 'baked' : 'en';
  const location = {
    pathname: path,
    search,
    hash,
    replace: (to) => { redirect = to; },
  };
  const documentStub = {
    documentElement: {
      hasAttribute: (a) => a === 'data-prerendered' && prerendered,
      setAttribute: (a, v) => { if (a === 'lang') lang = v; },
    },
  };
  const localStorageStub = { getItem: (k) => (k === LANG_STORAGE_KEY ? stored : null) };
  const windowStub = { location };
  // eslint-disable-next-line no-new-func
  new Function('document', 'localStorage', 'location', 'window', 'navigator', 'URLSearchParams', prepaintSource())(
    documentStub, localStorageStub, location, windowStub, { language: navLang }, URLSearchParams,
  );
  return { redirect, lang };
}

test('★ заявленный язык уводит с беспрефиксного адреса на его языковую форму', () => {
  for (const page of LOCALISED_PAGES) {
    for (const code of PREFIXED_LANGS) {
      const { redirect } = run({ path: page, stored: code });
      // Ожидание строит `withLangPath` — форму языкового адреса знает он, и
      // проверяем мы ровно то, что ручная копия развилки с ним согласна.
      assert.equal(redirect, withLangPath(code, page), `${page} + выбран ${code}`);
    }
  }
});

test('★ хвост адреса переезжает вместе с ним — там якорь и метка кампании', () => {
  const { redirect } = run({ path: '/', search: '?camp=x', hash: '#together', stored: 'es' });
  assert.equal(redirect, '/es?camp=x#together');
});

test('★★ языка не заявляли — развилки нет (и краулер всегда получает английский)', () => {
  // Ни у кого из них в хранилище ничего нет: первый визит, приватный режим, бот.
  assert.equal(run({ path: '/', stored: null, navLang: 'ru-RU' }).redirect, null,
    'разворот по navigator.language отрезал бы русскоязычному дорогу к английской версии');
});

test('★★ английский выбран явно — остаёмся на беспрефиксном адресе', () => {
  assert.equal(run({ path: '/', stored: DEFAULT_LANG }).redirect, null);
});

test('★★ префиксный адрес — утверждение: он сильнее сохранённого и петли не создаёт', () => {
  for (const code of PREFIXED_LANGS) {
    const other = PREFIXED_LANGS.find((c) => c !== code) || DEFAULT_LANG;
    assert.equal(run({ path: `/${code}`, stored: other }).redirect, null, `/${code} при выбранном ${other}`);
    assert.equal(run({ path: `/${code}/login`, stored: other }).redirect, null);
  }
});

test('★★★ ПРИЛОЖЕНИЕ И CAPABILITY-АДРЕСА НЕ ТРОГАЮТСЯ РАЗВИЛКОЙ', () => {
  // Язык приложения — из профиля (`users.language`). Уведи развилка `/trips` на
  // `/ru/trips`, и человек получил бы 404 на своём главном экране.
  const appPaths = APP_ROUTES.map((p) => p.replace(/:[^/]+/g, 'x'));
  for (const path of [...appPaths, '/public/trip/abc', '/join/abc', '/email-preferences', '/kit']) {
    assert.equal(run({ path, stored: 'ru' }).redirect, null, `${path} развилкой не трогается`);
  }
});

test('мусор в хранилище развилку не запускает', () => {
  for (const junk of ['de', '', 'null', '../evil', '//evil.com']) {
    assert.equal(run({ path: '/', stored: junk }).redirect, null, junk);
  }
});

test('★★ ВТОРАЯ ПОЛОВИНА СКРИПТА — сам <html lang> — тоже проверяется', () => {
  // ★ ДЫРА, НАЙДЕННАЯ УПРОЩАЮЩИМ ПРОХОДОМ. Первая редакция этих тестов целиком
  // была про развилку: снеси из скрипта ЧТЕНИЕ ХРАНИЛИЩА ДЛЯ `lang` — и все
  // проверки оставались зелёными, то есть исходная работа скрипта (снять причину
  // авто-перевода, TRIP-515) не проверялась ничем. Ровно случай из
  // [[triplanio-ci-guard-is-code]]: пока не увидел красным — не знаешь, что
  // проверяешь.
  //
  // Мерить надо на адресе, который развилка НЕ трогает (иначе тест уедет вместе
  // с редиректом) — берём экран приложения.
  assert.equal(run({ path: '/trips', stored: 'ru', navLang: 'en-US' }).lang, 'ru',
    'язык из хранилища перестал доезжать до <html lang>');
  assert.equal(run({ path: '/trips', stored: null, navLang: 'es-ES' }).lang, 'es',
    'язык браузера перестал доезжать до <html lang>');
  assert.equal(run({ path: '/trips', search: `?${LANG_PARAM}=ru`, stored: 'es', navLang: 'en-US' }).lang, 'ru',
    'рекламный параметр перестал побеждать сохранённый выбор');
  assert.equal(run({ path: '/trips', stored: null, navLang: 'de-DE' }).lang, DEFAULT_LANG,
    'неизвестный язык браузера обязан падать на язык по умолчанию');
});

test('испечённый документ свой lang не пересчитывает (иначе на английском файле встал бы ru)', () => {
  assert.equal(run({ path: '/', prerendered: true, navLang: 'ru-RU' }).lang, 'baked');
});

test('список адресов развилки не разошёлся с LOCALISED_PAGES', () => {
  const listed = /var LOCALISED = \[([^\]]*)\]/.exec(prepaintSource());
  assert.ok(listed, 'в пре-пейнт скрипте нет списка LOCALISED — развилка не найдена');
  const paths = [...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(paths.slice().sort(), [...LOCALISED_PAGES].sort(),
    'ручная копия списка страниц в index.html разъехалась с routePaths.js');
});
