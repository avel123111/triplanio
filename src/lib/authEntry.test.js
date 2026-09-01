// authEntry: куда ведёт CTA гостя и с какого вида открывается экран входа.
//
// Тест обязан быть КРАСНЫМ на мутации: переверни умолчание в `guestEntryPath`
// (список «кто на регистрацию» вместо суффикса `_signin`) — падает «новая
// кнопка наследует регистрацию»; убери чтение метки в `initialAuthView` —
// падает «адрес кнопки открывает регистрацию».
//
// ★ ГЛАВНЫЙ ТЕСТ — ПОСЛЕДНИЙ: он берёт адрес, который РЕАЛЬНО ставит кнопке
// `guestEntryPath`, и прогоняет его через `initialAuthView` — то есть сверяет
// отправителя с приёмником. Без него обе половины могут разъехаться молча:
// каждая валидна сама по себе, а кнопка «Начать бесплатно» снова открывает
// форму входа.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  guestEntryPath, initialAuthView, readViewParam,
  LOGIN_PATH, SIGNUP_PATH, RECOVERY_PATH, SIGNUP_VIEW,
} from './authEntry.js';

test('CTA, обещающий начать, ведёт на регистрацию', () => {
  for (const place of ['hero', 'header', 'menu', 'final']) {
    assert.equal(guestEntryPath(place), SIGNUP_PATH, place);
  }
});

test('пункт «войти» ведёт на вход', () => {
  assert.equal(guestEntryPath('menu_signin'), LOGIN_PATH);
  assert.equal(guestEntryPath('hero_signin'), LOGIN_PATH);
});

test('новое место кнопки наследует регистрацию, а не вход', () => {
  // Умолчание — то, которое чаще право: кнопку, добавленную без правки этого
  // файла, нельзя молча вернуть на экран возвращения.
  assert.equal(guestEntryPath('footer'), SIGNUP_PATH);
  assert.equal(guestEntryPath(''), SIGNUP_PATH);
  assert.equal(guestEntryPath(undefined), SIGNUP_PATH);
});

test('вид экрана: восстановление сильнее метки', () => {
  assert.equal(initialAuthView(RECOVERY_PATH, '?mode=signup'), 'reset-password');
  assert.equal(initialAuthView(RECOVERY_PATH, ''), 'reset-password');
});

test('вид экрана: без метки — вход', () => {
  assert.equal(initialAuthView(LOGIN_PATH, ''), 'login');
  assert.equal(initialAuthView(LOGIN_PATH, '?utm_source=google'), 'login');
  assert.equal(initialAuthView(LOGIN_PATH, '?mode=whatever'), 'login');
});

test('метка вида читается рядом с меткой кампании', () => {
  // Кнопка навешивает метку кампании ПОВЕРХ адреса (`withVisitCampaign` →
  // `appendQuery`), поэтому `mode` приезжает не один и не обязательно первым.
  assert.equal(readViewParam('?mode=signup&utm_source=google&gclid=abc'), SIGNUP_VIEW);
  assert.equal(readViewParam('?utm_source=google&mode=signup'), SIGNUP_VIEW);
  assert.equal(readViewParam(''), null);
  assert.equal(readViewParam(undefined), null);
});

test('★ отправитель и приёмник читают одну строку', () => {
  // Адрес, который кнопка реально ставит, обязан открыть тот вид, ради которого
  // она его ставит. Разбираем его так же, как браузер: путь и строка запроса.
  for (const place of ['hero', 'header', 'menu', 'final', 'menu_signin']) {
    const href = guestEntryPath(place);
    const [pathname, search] = href.split('?');
    const expected = place.endsWith('_signin') ? 'login' : SIGNUP_VIEW;
    assert.equal(initialAuthView(pathname, search ? `?${search}` : ''), expected, place);
  }
});

test('★ вид не разъезжается с экранами Login.jsx', () => {
  // `initialAuthView` называет вид строкой, а рисует его `Login` по
  // `data-screen`. Имя, которого там нет, — это пустой экран у человека и
  // тишина у гардов, поэтому сверяем с разметкой.
  const login = readFileSync(new URL('../pages/Login.jsx', import.meta.url), 'utf8');
  const screens = new Set([...login.matchAll(/data-screen="([^"]+)"/g)].map((m) => m[1]));
  // Вид `login` рисует экран `signin` — имена вида и экрана расходятся здесь
  // намеренно (вид — состояние формы, `data-screen` — имя секции прототипа).
  assert.ok(screens.has('signin'), 'экран входа');
  assert.ok(screens.has(SIGNUP_VIEW), 'экран регистрации');
  assert.ok(screens.has('reset'), 'экран восстановления');
});
