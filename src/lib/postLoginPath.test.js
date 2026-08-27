// Предикат «этот адрес можно отдать браузеру» — гейт шва авторизации.
//
// Пока он жил внутри Login.jsx, проверить его было нечем, а стоил он открытого
// редиректа: `startsWith('/')` пропускал `//evil.com`, и вызыватель уводил
// человека с домена через `window.location.href`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeInternalPath, PENDING_KEY, APP_HOME } from './postLoginPath.js';

test('★★★ protocol-relative НЕ проходит — это и есть уход с домена', () => {
  for (const bad of ['//evil.com', '//evil.com/join/x', '/\\evil.com', '//', '/\\']) {
    assert.equal(isSafeInternalPath(bad), false, bad);
  }
});

test('внутренний путь проходит', () => {
  for (const ok of ['/trips', '/join/abc', '/trip/1?lens=route', '/x#y', '/']) {
    assert.equal(isSafeInternalPath(ok), true, ok);
  }
});

test('внешний адрес и мусор не проходят', () => {
  for (const bad of ['https://evil.com', 'http://evil.com', 'evil.com', 'javascript:alert(1)',
    '', ' ', null, undefined, 42, {}, ['/trips']]) {
    assert.equal(isSafeInternalPath(bad), false, String(bad));
  }
});

test('ключ хранилища и дом объявлены здесь — оба берутся отсюда, а не переписываются', () => {
  assert.equal(PENDING_KEY, 'postLoginRedirect');
  assert.equal(APP_HOME, '/trips');
});
