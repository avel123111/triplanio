// Гейт для правила «откуда берётся язык страницы» (TRIP-520).
//
// ЗАЧЕМ ИМЕННО ТЕСТ. Правило пятиступенчатое, и три верхние ступени появились
// вместе с выпечкой готовых страниц. Ошибка в них не роняет ни сборку, ни
// экран — она даёт РАСХОЖДЕНИЕ ФАЙЛА И ЭКРАНА: приехал английский файл, а
// приложение перерисовало его по-русски. Полторы секунды человек читает один
// текст, потом весь текст меняется. Ни один гард такого не видит, глазами это
// ловится только если специально открыть с неанглийским браузером.
//
// Функция читает `window.location` и `localStorage`, поэтому оба подменяются
// здесь заглушками: тест обязан открываться голым `node --test`.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { detectLandingLang, langFromAddress, LANG_STORAGE_KEY, FALLBACK_LANG } from './translations.js';
import { PRERENDERED_PAGES, PREFIXED_LANGS, withLangPath } from '../routePaths.js';

/** Подменить окружение браузера: адрес, хранилище и язык браузера. */
function browser({ search = '', stored = null, navLang = 'ru-RU' } = {}) {
  const store = new Map(stored ? [[LANG_STORAGE_KEY, stored]] : []);
  globalThis.window = { location: { pathname: '/', search } };
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

beforeEach(() => { browser(); });

test('язык назван префиксом — он и побеждает, что бы ни было у посетителя', () => {
  browser({ stored: 'en', navLang: 'en-US', search: '?lang=en' });
  for (const lang of PREFIXED_LANGS) {
    for (const path of PRERENDERED_PAGES) {
      const url = withLangPath(lang, path);
      assert.equal(detectLandingLang(url), lang, `${url} обязан быть на ${lang}`);
    }
  }
});

test('★ бесперфиксная испечённая страница — АНГЛИЙСКАЯ, и ни браузер, ни хранилище её не переубеждают', () => {
  // Это и есть решение «как у Wanderlog»: у корня один язык, потому что у него
  // один файл. Верни сюда язык браузера — и русский посетитель получит
  // английский ФАЙЛ, который через секунду перерисуется в русский ЭКРАН.
  browser({ stored: 'ru', navLang: 'ru-RU' });
  for (const path of PRERENDERED_PAGES) {
    assert.equal(detectLandingLang(path), FALLBACK_LANG, `${path} обязан остаться английским`);
  }
  browser({ stored: 'es', navLang: 'es-ES' });
  for (const path of PRERENDERED_PAGES) {
    assert.equal(detectLandingLang(path), FALLBACK_LANG, `${path} обязан остаться английским`);
  }
});

test('у страниц БЕЗ готового файла язык по-прежнему решает посетитель', () => {
  // Вход, восстановление, приглашение, публичная поездка: содержимое зависит от
  // того, кто открыл, файла на язык у них нет — значит и адрес язык не называет.
  // Прежнее поведение здесь обязано сохраниться целиком.
  for (const path of ['/login', '/reset-password', '/join/tok', '/public/trip/abc']) {
    browser({ navLang: 'ru-RU' });
    assert.equal(detectLandingLang(path), 'ru', `${path}: язык браузера перестал работать`);
    browser({ stored: 'es', navLang: 'ru-RU' });
    assert.equal(detectLandingLang(path), 'es', `${path}: сохранённый выбор перестал побеждать браузер`);
    browser({ search: '?lang=en', stored: 'es', navLang: 'ru-RU' });
    assert.equal(detectLandingLang(path), 'en', `${path}: рекламная ссылка перестала побеждать`);
  }
});

test('язык из адреса запоминается — вход после языковой страницы остаётся на нём', () => {
  const store = browser({ navLang: 'en-US' });
  detectLandingLang('/es/terms');
  assert.equal(store.get(LANG_STORAGE_KEY), 'es', 'язык из префикса не запомнился');
  // Тот же визит уходит на страницу без готового файла — язык обязан доехать.
  assert.equal(detectLandingLang('/login'), 'es');
});

test('неизвестный язык в адресе или параметре не переключает ничего', () => {
  browser({ navLang: 'en-US' });
  assert.equal(detectLandingLang('/de/terms'), FALLBACK_LANG, '/de/ не язык — и не должен им притворяться');
  browser({ search: '?lang=de', navLang: 'en-US' });
  assert.equal(detectLandingLang('/login'), 'en', 'мусор в параметре переключил язык');
});

test('без хранилища и без браузера ответ всё равно есть', () => {
  globalThis.window = { location: { pathname: '/login', search: '' } };
  globalThis.localStorage = { getItem: () => { throw new Error('приватный режим'); }, setItem: () => {} };
  setNavigator(undefined);
  assert.equal(detectLandingLang('/login'), FALLBACK_LANG);
});

// ── Адрес против всего остального (прод-баг, замечен Pavel) ─────────────────
//
// Язык вошедшего берётся из профиля, и `I18nContext` переутверждал его при
// каждом приезде сессии — через секунду после загрузки. Пока языкового адреса
// не существовало, спорить было не с чем; с ним получилось так: открываешь
// `/ru`, русский файл рисуется, приходит профиль `es` — и текст молча
// становится испанским под русским адресом, русским `<html lang>`, русским
// canonical и русским hreflang. Предикат ниже — та самая развилка, поэтому он
// пинится отдельно от пятиступенчатого правила.

test('★★ префикс адреса — прямое утверждение о языке', () => {
  browser({ navLang: 'ru-RU', stored: 'es' });
  for (const code of PREFIXED_LANGS) {
    assert.equal(langFromAddress(withLangPath(code, '/')), code);
    assert.equal(langFromAddress(withLangPath(code, '/d/europe-may-2027')), code);
  }
});

test('★★ голый адрес испечённой страницы — это «английский»', () => {
  browser({ navLang: 'ru-RU', stored: 'ru' });
  for (const page of PRERENDERED_PAGES) {
    assert.equal(langFromAddress(page), FALLBACK_LANG,
      `${page}: под этим адресом лежит английский файл — экран обязан совпасть с ним`);
  }
});

test('★★ где готового файла нет, адрес про язык МОЛЧИТ', () => {
  browser({ navLang: 'ru-RU', stored: 'es' });
  // null здесь несущий: он и есть разрешение спросить профиль, хранилище и
  // браузер. Верни функция 'en' — вход, приглашение и публичная поездка стали
  // бы английскими для всех, а выбор посетителя перестал бы что-либо значить.
  for (const page of ['/login', '/reset-password', '/join/abc', '/public/trip/1', '/trips']) {
    assert.equal(langFromAddress(page), null, `${page}: адрес не называет язык`);
  }
});

test('★ голый адрес НЕ запоминается как выбор человека', () => {
  // Иначе один заход на `triplanio.com` затирал бы русский язык аккаунта
  // английским — молча и навсегда.
  const store = browser({ navLang: 'ru-RU', stored: 'ru' });
  assert.equal(detectLandingLang('/'), FALLBACK_LANG, 'страница обязана быть английской');
  assert.equal(store.get(LANG_STORAGE_KEY), 'ru', 'выбор посетителя затёрт голым адресом');
});
