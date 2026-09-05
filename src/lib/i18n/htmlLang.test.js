import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANG_STORAGE_KEY, LANG_PARAM, LANGUAGES } from './translations.js';

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
