// authErrorText: ошибка GoTrue → строка `auth.err_*`, серверная проза не течёт.
//
// Тест обязан быть КРАСНЫМ на мутации словаря: если код смапить на
// несуществующий ключ, падает и «известный код → своя строка», и «каждый ключ
// словаря есть в auth.json». Зеркалит `errorText.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authErrorText, GOTRUE_CODE_TO_KEY, oauthRedirectError, stripOauthError } from './authErrorText.js';

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

// ── Отказ OAuth в адресе возврата (TRIP-445, дефект C) ───────────────────────
// До этого разбора отмена входа у провайдера не читалась НИГДЕ в src: человек
// молча возвращался на форму. Тест обязан краснеть, если разбор перестанет
// видеть одну из двух сторон адреса (query / hash) или перестанет отличать
// отмену от сбоя.

test('★ отмена у провайдера читается и из query, и из hash', () => {
  const fromQuery = oauthRedirectError('?error=access_denied&error_description=The+user+denied', '');
  const fromHash = oauthRedirectError('', '#error=access_denied&error_description=The+user+denied');
  for (const r of [fromQuery, fromHash]) {
    assert.equal(r.key, 'auth.err_oauth_cancelled');
    assert.equal(r.code, 'access_denied');
  }
});

test('сбой провайдера — другой текст, чем отмена', () => {
  const r = oauthRedirectError('?error=server_error&error_code=unexpected_failure', '');
  assert.equal(r.key, 'auth.err_oauth_failed');
  assert.notEqual(r.key, 'auth.err_oauth_cancelled');
});

test('отмена распознаётся и по error_code (GoTrue кладёт код туда)', () => {
  assert.equal(oauthRedirectError('?error_code=access_denied', '').key, 'auth.err_oauth_cancelled');
});

test('чистый адрес → null (обычный вход не показывает ошибку)', () => {
  assert.equal(oauthRedirectError('', ''), null);
  assert.equal(oauthRedirectError('?camp_source=ads', '#access_token=abc'), null);
  assert.equal(oauthRedirectError(undefined, undefined), null);
});

test('★ показываем ключ, а НЕ прозу сервера', () => {
  const r = oauthRedirectError('?error=server_error&error_description=Database+error+saving+new+user', '');
  assert.ok(r.key.startsWith('auth.err_'));
  assert.ok(!r.key.includes('Database'), 'ключ не должен нести серверный текст');
  // description отдаётся отдельно — только для Sentry.
  assert.equal(r.description, 'Database error saving new user');
});

test('★ каждый ключ разбора существует в auth.json', () => {
  for (const q of ['?error=access_denied', '?error=server_error']) {
    const bare = oauthRedirectError(q, '').key.slice('auth.'.length);
    assert.ok(Object.hasOwn(authDict, bare), `нет ключа ${bare} в auth.json`);
    assert.ok(authDict[bare].length > 0);
  }
});

test('★ чистка адреса снимает ТОЛЬКО ошибку и НЕ трогает метку кампании', () => {
  const out = stripOauthError('?camp_source=google&error=access_denied&error_description=x', '#error_code=access_denied&type=recovery');
  assert.equal(out.search, '?camp_source=google', 'метка кампании обязана пережить чистку');
  assert.equal(out.hash, '#type=recovery');
});

test('чистка пустого адреса не выдумывает ? и #', () => {
  assert.deepEqual(stripOauthError('?error=access_denied', '#error=access_denied'), { search: '', hash: '' });
  assert.deepEqual(stripOauthError('', ''), { search: '', hash: '' });
});
