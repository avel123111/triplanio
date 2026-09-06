/**
 * ★ ГЕЙТ АДРЕСА ВИЗАРДА (TRIP-520).
 *
 * `normalizeStep`/`stepEntryFrom` решают, куда попадёт человек по ссылке, из
 * истории и на возврате — это поведение без скриншота, и разъедется оно молча.
 * Форма проверки — та же, что уже принята в репо для поведения (`routeModel`,
 * `forkFilter`, `trip-cities`).
 *
 * ⚠️ КАЖДАЯ ПРОВЕРКА УВИДЕНА КРАСНОЙ. Мутации, которыми это сделано:
 *   · `normalizeStep`: вернуть `raw` вместо `home` на неизвестном → падает «опечатка → home»;
 *   · `normalizeStep`: снять гейт `!citiesValid` → падает «review без городов → cities»;
 *   · `normalizeStep`: гейтить и `return` тоже → падает «return проходит без городов»;
 *   · `stepEntryFrom`: убрать ранний `isFirst` → падает «первый рендер = direct даже на POP»;
 *   · `stepEntryFrom`: поставить чтение `intent` ВЫШЕ ветки POP → падает «POP игнорирует state»;
 *   · `stepEntryFrom`: вернуть `intent` без белого списка → падает «мусорное намерение → direct».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStep, stepEntryFrom } from './stepUrl.js';

// ─── normalizeStep ───────────────────────────────────────────────────────────
test('normalizeStep: канонические шаги проходят как есть', () => {
  assert.equal(normalizeStep('home', { citiesValid: true }), 'home');
  assert.equal(normalizeStep('cities', { citiesValid: true }), 'cities');
  assert.equal(normalizeStep('return', { citiesValid: true }), 'return');
  assert.equal(normalizeStep('review', { citiesValid: true }), 'review');
});

test('normalizeStep: неизвестное / опечатка / пустое → home', () => {
  assert.equal(normalizeStep('nope', { citiesValid: true }), 'home');
  assert.equal(normalizeStep('Review', { citiesValid: true }), 'home'); // регистр важен
  assert.equal(normalizeStep('', { citiesValid: true }), 'home');
  assert.equal(normalizeStep(null), 'home');
  assert.equal(normalizeStep(undefined), 'home');
});

test('normalizeStep: review при невалидных городах откатывается на cities', () => {
  assert.equal(normalizeStep('review', { citiesValid: false }), 'cities');
  assert.equal(normalizeStep('review'), 'cities'); // дефолт citiesValid=false
});

test('normalizeStep: невалидные города НЕ трогают остальные шаги', () => {
  assert.equal(normalizeStep('return', { citiesValid: false }), 'return');
  assert.equal(normalizeStep('cities', { citiesValid: false }), 'cities');
  assert.equal(normalizeStep('home', { citiesValid: false }), 'home');
});

// ─── stepEntryFrom ───────────────────────────────────────────────────────────
test('stepEntryFrom: первый рендер = direct, даже когда navType=POP', () => {
  assert.equal(stepEntryFrom({ isFirst: true, navType: 'POP', intent: 'next' }), 'direct');
  assert.equal(stepEntryFrom({ isFirst: true, navType: 'PUSH' }), 'direct');
});

test('stepEntryFrom: POP = back и ИГНОРИРУЕТ intent из state', () => {
  assert.equal(stepEntryFrom({ navType: 'POP' }), 'back');
  // критично: на возврате в state лежит намерение первого прихода — не читать его
  assert.equal(stepEntryFrom({ navType: 'POP', intent: 'next' }), 'back');
});

test('stepEntryFrom: REPLACE = restore', () => {
  assert.equal(stepEntryFrom({ navType: 'REPLACE' }), 'restore');
  assert.equal(stepEntryFrom({ navType: 'REPLACE', intent: 'next' }), 'restore');
});

test('stepEntryFrom: PUSH берёт намерение писателя из белого списка', () => {
  assert.equal(stepEntryFrom({ navType: 'PUSH', intent: 'next' }), 'next');
  assert.equal(stepEntryFrom({ navType: 'PUSH', intent: 'jump' }), 'jump');
});

test('stepEntryFrom: PUSH без намерения / с мусорным намерением → direct', () => {
  assert.equal(stepEntryFrom({ navType: 'PUSH' }), 'direct');
  assert.equal(stepEntryFrom({ navType: 'PUSH', intent: 'garbage' }), 'direct');
});
