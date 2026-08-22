// authErrorText: ошибка GoTrue → строка `auth.err_*`, серверная проза не течёт.
//
// Тест обязан быть КРАСНЫМ на мутации словаря: если код смапить на
// несуществующий ключ, падает и «известный код → своя строка», и «каждый ключ
// словаря есть в auth.json». Зеркалит `errorText.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authErrorText, GOTRUE_CODE_TO_KEY } from './authErrorText.js';

const authDict = JSON.parse(
  readFileSync(new URL('./i18n/locales/en/auth.json', import.meta.url), 'utf8'),
);

// Мини-`t`, зеркалящий раскол facade по ПЕРВОЙ точке: ns='auth', bare-ключ.
// Нет строки → возвращает сам адрес (как реальный `t` при промахе).
function fakeT(key) {
  const dot = key.indexOf('.');
  if (dot <= 0) return key;
  const ns = key.slice(0, dot);
  const bare = key.slice(dot + 1);
  if (ns === 'auth' && Object.hasOwn(authDict, bare)) return authDict[bare];
  return key;
}

test('известный код → своя строка из auth.json', () => {
  const out = authErrorText(fakeT, { code: 'invalid_credentials' });
  assert.equal(out, authDict.err_invalid_credentials);
  assert.notEqual(out, 'auth.err_invalid_credentials'); // не сырой адрес
});

test('AuthSessionMissingError (.code может быть undefined) → err_reset_link', () => {
  const out = authErrorText(fakeT, { name: 'AuthSessionMissingError', message: 'Auth session missing!' });
  assert.equal(out, authDict.err_reset_link);
});

test('recovery-код session_expired тоже → err_reset_link', () => {
  assert.equal(authErrorText(fakeT, { code: 'session_expired' }), authDict.err_reset_link);
});

test('неизвестный код → err_generic (не сырой адрес, не серверная проза)', () => {
  const out = authErrorText(fakeT, { code: 'some_unmapped_code', message: 'Raw server prose' });
  assert.equal(out, authDict.err_generic);
  assert.notEqual(out, 'Raw server prose');
});

test('без кода / undefined / null → err_generic', () => {
  assert.equal(authErrorText(fakeT, { message: 'x' }), authDict.err_generic);
  assert.equal(authErrorText(fakeT, undefined), authDict.err_generic);
  assert.equal(authErrorText(fakeT, null), authDict.err_generic);
});

test('★ каждый ключ словаря существует в auth.json (иначе показали бы сырой адрес)', () => {
  for (const [code, key] of Object.entries(GOTRUE_CODE_TO_KEY)) {
    assert.ok(key.startsWith('auth.'), `ключ ${key} для ${code} должен быть в namespace auth`);
    const bare = key.slice('auth.'.length);
    assert.ok(Object.hasOwn(authDict, bare), `код ${code} → отсутствующий ключ ${key}`);
    assert.ok(authDict[bare].length > 0, `ключ ${key} пустой`);
  }
});

test('★ ни один код словаря не показывает пользователю сырой адрес auth.err_<code>', () => {
  for (const code of Object.keys(GOTRUE_CODE_TO_KEY)) {
    const out = authErrorText(fakeT, { code });
    assert.notEqual(out, GOTRUE_CODE_TO_KEY[code]); // не сырой адрес auth.err_<...>
    assert.ok(out.length > 0);
  }
});
