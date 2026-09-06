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
 *   · `stepEntryFrom`: вернуть `intent` без белого списка → падает «мусорное намерение → direct»;
 *   · `normalizeStep`: снять `return` из гейта городов → падает «return без городов → cities»;
 *   · `resolveBack`: заменить `depth > 0` на `depth >= 0` → падает «на дне флоу это выход»;
 *   · `resolveBack`: игнорировать `enteredByPush` → падает «прямой заход уходит на /trips»;
 *   · `nextStepState`: на `advance:false` вернуть `depth:0` → падает «replace теряет глубину»;
 *   · `nextStepState`: на `advance:true` не прибавлять 1 → падает «переход не углубляет».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStep, stepEntryFrom, resolveBack, nextStepState } from './stepUrl.js';

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

test('normalizeStep: return при невалидных городах тоже откатывается на cities', () => {
  // Осиротевшая после сброса запись `?step=return` или прямая ссылка не должны
  // открывать выбор финиша над пустым маршрутом.
  assert.equal(normalizeStep('return', { citiesValid: false }), 'cities');
  assert.equal(normalizeStep('return', { citiesValid: true }), 'return');
});

test('normalizeStep: невалидные города НЕ трогают home/cities', () => {
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

// ─── resolveBack ─────────────────────────────────────────────────────────────
test('resolveBack: глубже дна флоу → шаг назад историей, без выхода', () => {
  // depth>0 значит запись флоу лежит НИЖЕ (в т.ч. после прыжка по рейлу на home,
  // где step==='home', но истории под нами полно) — «назад» это шаг, не выход.
  assert.equal(resolveBack({ depth: 1, enteredByPush: true }), 'step');
  assert.equal(resolveBack({ depth: 3, enteredByPush: false }), 'step');
});

test('resolveBack: на дне флоу — выход, направление по способу входа', () => {
  // Вошли push-ом (под нами свой маршрут) → возврат историей; прямой заход /
  // новая вкладка (истории нет) → на /trips, а не в пустоту.
  assert.equal(resolveBack({ depth: 0, enteredByPush: true }), 'exit-history');
  assert.equal(resolveBack({ depth: 0, enteredByPush: false }), 'exit-trips');
  assert.equal(resolveBack({}), 'exit-trips'); // дефолты: дно, не push
});

// ─── nextStepState (глубину нельзя терять ни одному писателю) ─────────────────
test('nextStepState: переход углубляет (+1), намерение переносится', () => {
  assert.deepEqual(nextStepState(null, { intent: 'next', advance: true }), { from: 'next', depth: 1 });
  assert.deepEqual(nextStepState({ depth: 3 }, { intent: 'jump', advance: true }), { from: 'jump', depth: 4 });
});

test('nextStepState: replace (restore/reset) СОХРАНЯЕТ глубину, не роняет в 0', () => {
  // Ровно тот инвариант, что был нарушен: restore/reset писали `replace` без
  // state, depth утекал в 0 и «назад» снова путал шаг с выходом.
  assert.equal(nextStepState({ depth: 3 }).depth, 3);
  assert.equal(nextStepState({ depth: 5 }, { advance: false }).depth, 5);
  assert.equal(nextStepState(null).depth, 0); // дна нет — 0, как и было
});
