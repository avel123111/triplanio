// authFlowCode: код флоу precheck-функции → факты для экрана.
//
// Тест обязан быть КРАСНЫМ на мутации словаря: убери строку `send_failed` —
// падает «send_failed это отказ, а не успех»; смапь код на несуществующий
// ключ — падает «каждый ключ словаря есть в auth.json». Зеркалит
// `authErrorText.test.js`.
//
// Эти ветки НЕЛЬЗЯ проверить глазами: чтобы увидеть `send_failed`, нужен
// сломанный почтовый провайдер. Поэтому тест здесь — единственный гейт.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authFlowResult } from './authFlowCode.js';

const authDict = JSON.parse(
  readFileSync(new URL('./i18n/locales/en/auth.json', import.meta.url), 'utf8'),
);

// Каждый код, который умеет вернуть каждая из двух edge-функций (их докблоки —
// источник этого списка). Держать синхронным с ними руками: контракт на границе.
const RESET_CODES = ['reset_sent', 'account_not_found', 'rate_limited', 'retry_soon', 'send_failed'];
const SIGNUP_CODES = ['ok', 'confirmation_resent', 'email_exists', 'rate_limited', 'retry_soon'];

test('★ send_failed — ОТКАЗ со своим текстом, а не успех', () => {
  const r = authFlowResult('reset', 'send_failed');
  assert.equal(r.sent, false, 'письмо не ушло — экран «проверь почту» показывать нельзя');
  assert.equal(r.errorKey, 'auth.err_send_failed');
  // Не общий «что-то пошло не так»: человеку важно, что письма НЕ БУДЕТ.
  assert.notEqual(r.errorKey, 'auth.err_generic');
});

test('успешные коды несут sent/proceed и не несут ошибки', () => {
  const sent = authFlowResult('reset', 'reset_sent');
  assert.deepEqual({ sent: sent.sent, errorKey: sent.errorKey }, { sent: true, errorKey: null });

  const resent = authFlowResult('signup', 'confirmation_resent');
  assert.equal(resent.sent, true);
  assert.equal(resent.resent, true, 'повторное письмо помечается — событие воронки то же, но с флагом');

  const ok = authFlowResult('signup', 'ok');
  assert.equal(ok.proceed, true);
  assert.equal(ok.sent, false, 'precheck ничего не слал — это разрешение регистрироваться');
});

test('retry_soon просит таймер, rate_limited — нет', () => {
  assert.equal(authFlowResult('reset', 'retry_soon').cooldown, true);
  assert.equal(authFlowResult('reset', 'rate_limited').cooldown, false);
});

test('один код, два флоу — разные тексты (лимит на сброс ≠ лимит на IP)', () => {
  assert.equal(authFlowResult('reset', 'rate_limited').errorKey, 'auth.err_reset_rate_limited');
  assert.equal(authFlowResult('signup', 'rate_limited').errorKey, 'auth.err_rate_limited');
});

test('отказы signup несут reason для signup_failed', () => {
  assert.equal(authFlowResult('signup', 'email_exists').reason, 'email_exists');
  assert.equal(authFlowResult('signup', 'rate_limited').reason, 'rate_limited');
  assert.equal(authFlowResult('reset', 'rate_limited').reason, null, 'у сброса воронки регистрации нет');
});

test('★ незнакомый код — отказ, НИКОГДА не молчаливый успех', () => {
  for (const flow of ['reset', 'signup']) {
    for (const code of ['totally_new_code', '', undefined, null, 42, {}]) {
      const r = authFlowResult(flow, code);
      assert.equal(r.errorKey, 'auth.err_generic', `${flow}/${String(code)}`);
      assert.equal(r.sent, false, `${flow}/${String(code)} — не выдавать за отправленное письмо`);
      assert.equal(r.proceed, false, `${flow}/${String(code)} — не пускать дальше`);
    }
  }
  assert.equal(authFlowResult('signup', 'nope').reason, 'precheck_failed');
});

test('незнакомый ФЛОУ тоже отказ (опечатка в вызывающем не проходит молча)', () => {
  const r = authFlowResult('reeset', 'reset_sent');
  assert.equal(r.errorKey, 'auth.err_generic');
  assert.equal(r.sent, false);
});

test('★ каждый код обеих функций разобран словарём, без фолбэка', () => {
  for (const code of RESET_CODES) {
    const r = authFlowResult('reset', code);
    assert.notEqual(r.errorKey, 'auth.err_generic', `reset/${code} провалился в фолбэк — код не разобран`);
  }
  for (const code of SIGNUP_CODES) {
    const r = authFlowResult('signup', code);
    assert.notEqual(r.errorKey, 'auth.err_generic', `signup/${code} провалился в фолбэк — код не разобран`);
  }
});

test('★ каждый ключ словаря существует в auth.json', () => {
  const keys = new Set();
  for (const flow of ['reset', 'signup']) {
    for (const code of flow === 'reset' ? RESET_CODES : SIGNUP_CODES) {
      const k = authFlowResult(flow, code).errorKey;
      if (k) keys.add(k);
    }
  }
  assert.ok(keys.size > 0);
  for (const k of keys) {
    const bare = k.slice('auth.'.length);
    assert.ok(k.startsWith('auth.'), `${k} — не из namespace auth`);
    assert.ok(Object.hasOwn(authDict, bare), `${k} нет в locales/en/auth.json`);
  }
});

test('★ ИНВАРИАНТ: «не отправлено и не пропущено» ⇒ есть текст ошибки', () => {
  // Экран берёт `t(res.errorKey)` напрямую. Код, который не ведёт ни к письму,
  // ни к продолжению, обязан нести ключ — иначе `t(null)` и пустая плашка.
  const all = [...RESET_CODES.map((c) => ['reset', c]), ...SIGNUP_CODES.map((c) => ['signup', c]), ['reset', 'nope'], ['signup', 'nope']];
  for (const [flow, code] of all) {
    const r = authFlowResult(flow, code);
    if (!r.sent && !r.proceed) {
      assert.ok(r.errorKey, `${flow}/${code}: тупик без текста — экран покажет пустую ошибку`);
    }
  }
});
