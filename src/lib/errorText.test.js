// errorText: машинный `code` → человеческая строка, серверная проза не течёт.
//
// DoD TRIP-400 «errorText покрывает реестр»: тест идёт по ВСЕМУ `ERROR_CODES`
// и требует, чтобы КАЖДЫЙ код разрешался в реальную строку, а не в сырой адрес
// `err.<code>`. Покрытие держит фолбэк `err.temporary` (обязан существовать)
// плюс точные строки для кодов, что видит пользователь. Так новый код в реестре
// не может показать пользователю `err.NEW_CODE` — он молча уходит в общий текст.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { errorText, classifyError } from './errorText.js';
import { ERROR_CODES, REFUSAL_CODES } from './errorCodes.js';

const errDict = JSON.parse(
  readFileSync(new URL('./i18n/locales/en/err.json', import.meta.url), 'utf8'),
);

// Мини-`t`, зеркалящий раскол facade по ПЕРВОЙ точке: ns='err', bare-ключ.
// Нет строки → возвращает сам адрес (как реальный `t` при промахе).
function fakeT(key) {
  const dot = key.indexOf('.');
  if (dot <= 0) return key;
  const ns = key.slice(0, dot);
  const bare = key.slice(dot + 1);
  if (ns === 'err' && Object.hasOwn(errDict, bare)) return errDict[bare];
  return key;
}

test('фолбэк err.temporary существует и непустой', () => {
  assert.equal(typeof errDict.temporary, 'string');
  assert.ok(errDict.temporary.length > 0);
});

test('фолбэк err.refusal существует и непустой (TRIP-423)', () => {
  assert.equal(typeof errDict.refusal, 'string');
  assert.ok(errDict.refusal.length > 0);
});

test('★ отказ без своей строки → err.refusal, НЕ err.temporary (TRIP-423)', () => {
  // Отказ обещать «попробуй позже» = врать: ответ всегда будет «нет».
  for (const code of REFUSAL_CODES) {
    const out = errorText(fakeT, code);
    if (Object.hasOwn(errDict, code)) {
      assert.equal(out, errDict[code], `код ${code} должен брать свою строку`);
    } else {
      assert.equal(out, errDict.refusal, `код ${code} без строки → err.refusal`);
      assert.notEqual(out, errDict.temporary, `код ${code} не должен уходить в temporary`);
    }
  }
});

test('неизвестный (НЕ refusal) код → err.temporary, не err.refusal (TRIP-423)', () => {
  assert.equal(errorText(fakeT, 'NO_SUCH_CODE'), errDict.temporary);
});

test('код с точной строкой возвращает её, а не адрес', () => {
  assert.equal(errorText(fakeT, 'FORBIDDEN'), errDict.FORBIDDEN);
  assert.equal(errorText(fakeT, 'INVALID_INPUT'), errDict.INVALID_INPUT);
});

test('неизвестный код и null уходят в общий фолбэк', () => {
  assert.equal(errorText(fakeT, 'NO_SUCH_CODE'), errDict.temporary);
  assert.equal(errorText(fakeT, null), errDict.temporary);
  assert.equal(errorText(fakeT, undefined), errDict.temporary);
});

test('★ ни один код реестра не показывает пользователю сырой адрес err.<code>', () => {
  for (const code of ERROR_CODES) {
    const out = errorText(fakeT, code);
    assert.notEqual(out, `err.${code}`, `код ${code} утёк сырым адресом`);
    assert.ok(out.length > 0);
  }
});

// ── classifyError: единственная карта код→трактовка (upsell/refusal/error) ──
test('classifyError: PRO_REQUIRED → upsell (открыть апселл, не тост)', () => {
  const r = classifyError(fakeT, 'PRO_REQUIRED');
  assert.equal(r.kind, 'upsell');
  assert.equal(typeof r.text, 'string');
  assert.ok(r.text.length > 0);
});

test('classifyError: каждый REFUSAL_CODES → refusal, текст = err.<code> или общий', () => {
  for (const code of REFUSAL_CODES) {
    const r = classifyError(fakeT, code);
    assert.equal(r.kind, 'refusal', `код ${code} должен быть refusal`);
    assert.equal(r.text, errorText(fakeT, code));
    assert.notEqual(r.text, `err.${code}`);
  }
});

test('classifyError: PRO_REQUIRED НЕ в REFUSAL_CODES (апселл — отдельная ветка)', () => {
  assert.ok(!REFUSAL_CODES.has('PRO_REQUIRED'));
});

test('classifyError: неизвестный код и null → error + общий текст', () => {
  for (const code of ['NO_SUCH_CODE', null, undefined]) {
    const r = classifyError(fakeT, code);
    assert.equal(r.kind, 'error');
    assert.equal(r.text, errDict.temporary);
  }
});
