// Гейт для правила «откуда берётся язык страницы» (TRIP-520).
//
// ЗАЧЕМ ИМЕННО ТЕСТ. Правило трёхслойное, и верхний слой появился вместе с
// языковыми адресами. Ошибка в нём не роняет ни сборку, ни экран — она даёт
// РАСХОЖДЕНИЕ ФАЙЛА И ЭКРАНА («приехал английский файл, приложение перерисовало
// его по-русски») либо, наоборот, УТЕЧКУ («открыл английский лендинг — всё
// приложение стало английским»). Ни один гард такого не видит, глазами это
// ловится только если специально войти под неанглийским профилем.
//
// Функции читают `window.location` и `localStorage`, поэтому оба подменяются
// здесь заглушками: тест обязан открываться голым `node --test`.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  visitorLang, initialLang, rememberLang, currentLang, publishLang,
  LANG_STORAGE_KEY, FALLBACK_LANG,
} from './translations.js';
import {
  localeOf, DEFAULT_LANG, PREFIXED_LANGS, PRERENDERED_PAGES, LOCALISED_PAGES, withLangPath,
} from '../routePaths.js';

/** Подменить окружение браузера: адрес, хранилище и язык браузера. */
function browser({ path = '/', search = '', stored = null, navLang = 'ru-RU' } = {}) {
  const store = new Map(stored ? [[LANG_STORAGE_KEY, stored]] : []);
  globalThis.window = { location: { pathname: path, search } };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  // `navigator` у Node 22 — геттер на globalThis, присваиванием его не подменить.
  setNavigator(navLang == null ? undefined : { language: navLang });
  return store;
}

function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

beforeEach(() => { browser(); publishLang(null); });

/* ── Слой 1: что обещает адрес ───────────────────────────────────────────── */

test('★★ префикс адреса — прямое утверждение о языке', () => {
  for (const code of PREFIXED_LANGS) {
    for (const page of LOCALISED_PAGES) {
      assert.equal(localeOf(withLangPath(code, page)), code, `${withLangPath(code, page)}`);
    }
  }
});

test('★★ беспрефиксный адрес ПЕРЕВЕДЁННОЙ страницы — это «английский»', () => {
  // Обычная роль `defaultLocale`: у страницы есть адрес на каждый язык, и
  // беспрефиксный из них — английский. Под ним и лежит английский файл.
  for (const page of LOCALISED_PAGES) {
    assert.equal(localeOf(page), DEFAULT_LANG, `${page}: под этим адресом лежит английский файл`);
  }
});

test('★★★ молчат ровно две вещи: capability-адреса и приложение', () => {
  // ★ МОДЕЛЬ СМЕНИЛАСЬ (TRIP-533). Раньше локаль была у подмножества зоны, и
  // молчание адреса было НОРМОЙ — из него и рос весь класс «язык слетает при
  // навигации»: где адрес молчит, язык падает на слой устройства, а первый же
  // адрес, который язык УТВЕРЖДАЕТ (`/`), его перебивает.
  //
  // Теперь адрес СТРАНИЦЫ зоны говорит всегда, включая вход и юр-документы (у
  // последних переведена обвязка; сам текст английский по решению TRIP-465 §7 —
  // это решается `lang="en"` на самом документе и отсутствием hreflang, а не
  // лишением страницы языкового адреса).
  //
  // Молчат ровно две вещи, и обе по правилу домена:
  for (const page of ['/join/abc', '/public/trip/1']) {
    // одноразовая ссылка: язык принадлежит ПОЛУЧАТЕЛЮ, а не отправителю;
    assert.equal(localeOf(page), null, `${page}: capability-адрес языка не называет`);
  }
  for (const page of ['/trips', '/settings', '/trip/abc']) {
    // экран приложения: авторитет у языка профиля в БД.
    assert.equal(localeOf(page), null, `${page}: язык экрана приложения — из профиля`);
  }
  // Юр-документы печём и они же теперь имеют языковой адрес — раньше тут стояло
  // обратное утверждение, и именно оно теряло язык на переходе между вкладками.
  for (const page of ['/terms', '/privacy']) {
    assert.equal(PRERENDERED_PAGES.includes(page), true, `${page} обязан печься`);
    assert.equal(localeOf(page), DEFAULT_LANG, `${page}: беспрефиксная форма — английская`);
  }
});

test('неизвестный префикс языком не притворяется', () => {
  assert.equal(localeOf('/de'), null);
  assert.equal(localeOf('/de/terms'), null);
});

/* ── Слой 3: что известно о посетителе ───────────────────────────────────── */

test('язык посетителя: рекламная ссылка → сохранённый выбор → браузер', () => {
  browser({ search: '?lang=en', stored: 'es', navLang: 'ru-RU' });
  assert.equal(visitorLang(), 'en', 'рекламная ссылка перестала побеждать');
  browser({ stored: 'es', navLang: 'ru-RU' });
  assert.equal(visitorLang(), 'es', 'сохранённый выбор перестал побеждать браузер');
  browser({ navLang: 'ru-RU' });
  assert.equal(visitorLang(), 'ru', 'язык браузера перестал работать');
});

test('мусор в параметре и отсутствие всего не переключают язык', () => {
  browser({ search: '?lang=de', navLang: 'en-US' });
  assert.equal(visitorLang(), 'en');
  globalThis.window = { location: { pathname: '/login', search: '' } };
  globalThis.localStorage = { getItem: () => { throw new Error('приватный режим'); }, setItem: () => {} };
  setNavigator(undefined);
  assert.equal(visitorLang(), FALLBACK_LANG, 'без хранилища и без браузера ответа не стало');
});

test('★ язык посетителя НЕ смотрит на адрес', () => {
  // Это и есть развязка слоёв. Смешай их — и вернулась бы утечка: голый `/`
  // отвечал бы «английский» ещё и там, где спрашивают про ПОСЕТИТЕЛЯ, то есть
  // при регистрации и на входе.
  browser({ path: '/', stored: 'ru', navLang: 'ru-RU' });
  assert.equal(visitorLang(), 'ru', 'адрес просочился в слой посетителя');
});

/* ── Первый кадр: адрес, иначе посетитель ────────────────────────────────── */

test('★ первый кадр: адрес страницы зоны решает сам, посетитель — только вне их', () => {
  browser({ path: '/ru', stored: 'es', navLang: 'es-ES' });
  assert.equal(initialLang('/ru'), 'ru', 'префикс проиграл сохранённому выбору');
  browser({ path: '/', stored: 'ru', navLang: 'ru-RU' });
  assert.equal(initialLang('/'), DEFAULT_LANG, 'беспрефиксный лендинг обязан быть английским');

  // ★★ КОМПРОМИСС, КОТОРЫЙ НАДО ВИДЕТЬ, А НЕ ОБНАРУЖИТЬ ПОТОМ (TRIP-533).
  //
  // Беспрефиксная форма страницы зоны — АНГЛИЙСКАЯ, включая вход. Значит
  // посетитель с испанским браузером, впервые приехавший ПРЯМО на голый
  // `/login`, увидит английскую форму, хотя до этой правки увидел бы испанскую.
  //
  // Это осознанная цена единообразия, и она мала, потому что попасть туда почти
  // не через что:
  //   · ссылка внутри зоны несёт язык (дверь `zoneCta` + гард 2ah);
  //   · рекламная ссылка несёт `?lang=`, и край уводит её на `/es/login`;
  //   · вернувшийся заявлял язык раньше — его уводит развилка в `index.html`.
  // Остаётся первый в жизни визит прямо по набранному адресу. Ровно так же
  // ведут себя Figma (`/login` английский, испанский — `/es-es/login/`) и Notion
  // (локаль отбрасывается на границе приложения).
  //
  // Разворачивать по `navigator.language` было бы хуже: язык браузера — догадка,
  // и человек с русским браузером, которому нужен английский, не смог бы
  // остаться на английской странице.
  browser({ path: '/login', stored: 'ru', navLang: 'en-US' });
  assert.equal(initialLang('/login'), DEFAULT_LANG, 'беспрефиксная форма входа — английская');
  browser({ path: '/ru/login', stored: 'es', navLang: 'en-US' });
  assert.equal(initialLang('/ru/login'), 'ru', 'языковая форма входа называет свой язык');
  browser({ path: '/es/terms', stored: 'ru', navLang: 'en-US' });
  assert.equal(initialLang('/es/terms'), 'es', 'обвязка юр-документа говорит на языке адреса');

  // А вот capability-адрес и экран приложения по-прежнему решает не адрес.
  browser({ path: '/public/trip/1', stored: 'ru', navLang: 'en-US' });
  assert.equal(initialLang('/public/trip/1'), 'ru', 'язык публичной ссылки — язык получателя');
});

test('★ голый адрес НЕ запоминается как выбор человека', () => {
  // Иначе один заход на `triplanio.com` затирал бы русский язык аккаунта
  // английским — молча и навсегда.
  const store = browser({ path: '/', stored: 'ru', navLang: 'ru-RU' });
  assert.equal(initialLang('/'), DEFAULT_LANG, 'страница обязана быть английской');
  assert.equal(store.get(LANG_STORAGE_KEY), 'ru', 'выбор посетителя затёрт голым адресом');
});

test('язык из ПРЕФИКСА запоминается — вход после языковой страницы остаётся на нём', () => {
  const store = browser({ navLang: 'en-US' });
  rememberLang('es'); // ровно это делает провайдер, увидев префикс в адресе
  assert.equal(store.get(LANG_STORAGE_KEY), 'es', 'язык из префикса не запомнился');
  assert.equal(visitorLang(), 'es', 'запомненный язык не доехал до страницы без языкового адреса');
});

/* ── Язык на экране — один на всех читателей ─────────────────────────────── */

test('★ язык регистрации берётся с ЭКРАНА, а не считается заново', () => {
  // `AuthContext` живёт вне дерева React и раньше считал язык своей копией
  // лестницы. Со слоем маршрута копия разошлась бы с оригиналом: на `/ru`
  // человек видит русский, а копия ответила бы «сохранённый выбор».
  browser({ path: '/ru', stored: 'es', navLang: 'es-ES' });
  publishLang('ru');
  assert.equal(currentLang(), 'ru');
});

test('до первого кадра язык на экране = язык первого кадра', () => {
  browser({ path: '/ru', stored: 'es' });
  assert.equal(currentLang(), initialLang('/ru'));
});
