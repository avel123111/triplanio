// Правило «числительное и слово при нём». Гейт на чистой функции: до него оно
// было выписано одиннадцатью тернарниками по месту, десять из которых давали
// «21 городов» и «22 ночей» — тихо, без падения и только на второй десятке.
//
// ⚠️ МУТАЦИИ, КОТОРЫМИ ТЕСТЫ ПРОВЕРЕНЫ КРАСНЫМИ (зелёный тест не значит ничего,
// пока не увидел его красным — [[triplanio-ci-guard-is-code]]):
//   · вернуть предикат к `n < 5` — падает на 21 и 22;
//   · снять исключение `% 100` (11..14) — падает на 11 и 12;
//   · убрать `Math.abs` — падает на отрицательном.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pluralForm, pluralWord } from './plural.js';

test('★★★ форма считается по последней цифре, с изъятием одиннадцати..четырнадцати', () => {
  const want = {
    one: [1, 21, 31, 101, 1001],
    few: [2, 3, 4, 22, 23, 24, 102],
    many: [0, 5, 9, 10, 11, 12, 13, 14, 15, 25, 100, 111, 112],
  };
  for (const [form, ns] of Object.entries(want)) {
    for (const n of ns) assert.equal(pluralForm(n), form, `${n} обязано быть «${form}»`);
  }
});

test('★★ мусор и знак не роняют правило: слово нужно всегда', () => {
  for (const n of [-1, -21, -5, NaN, undefined, null, '3', 2.7]) {
    assert.ok(['one', 'few', 'many'].includes(pluralForm(/** @type {any} */ (n))), String(n));
  }
  assert.equal(pluralForm(-21), 'one', 'знак формы не меняет');
  assert.equal(pluralForm(NaN), 'many', 'не-число считается нулём');
});

test('★ ключ собирается из основы и формы — суффиксы нигде больше не выписываются', () => {
  const t = (k) => k;
  assert.equal(pluralWord(t, 1, 'trip.cities_count'), 'trip.cities_count_one');
  assert.equal(pluralWord(t, 22, 'view.nights'), 'view.nights_few');
  assert.equal(pluralWord(t, 12, 'tse.day'), 'tse.day_many');
});
