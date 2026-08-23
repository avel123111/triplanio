// Правило «камеру уже кадрировали» — чистая функция, значит у неё есть тест.
// В этом репо так со всеми правилами, живущими вне разметки (mapShellInsets,
// tripStep, tripMenu, insets): у них нет ни скриншота, ни гарда, и сломать их
// можно молча — экран при этом не падает, просто начинает дёргаться.
//
// Импорт ОТНОСИТЕЛЬНЫЙ, не через alias `@/`: `node --test` его не резолвит.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasFramed, markFramed } from './framed.js';

test('свежая карта считается НЕкадрированной (иначе первый кадр поедет анимацией в пустоту)', () => {
  assert.equal(hasFramed({}), false);
});

test('отметка держится на инстансе', () => {
  const map = {};
  markFramed(map);
  assert.equal(hasFramed(map), true);
});

test('инстансы независимы — факт не глобальный', () => {
  // Ровно ради этого WeakMap, а не модульная переменная: пересозданная карта
  // (перезагрузка страницы, смена стиля) обязана снова считаться свежей.
  const a = {}; const b = {};
  markFramed(a);
  assert.equal(hasFramed(a), true);
  assert.equal(hasFramed(b), false);
});

test('факт МОНОТОНЕН: повторная отметка ничего не ломает и не снимается', () => {
  const map = {};
  markFramed(map);
  markFramed(map);
  assert.equal(hasFramed(map), true);
});

test('пустая ссылка не роняет и не отмечается', () => {
  // Обе двери зовутся из эффектов, где инстанс может быть ещё/уже null:
  // `useMapSurface` обнуляет свою ссылку в cleanup раньше, чем отработают
  // соседние эффекты (та же грабля разобрана в useMapInsets).
  assert.equal(hasFramed(null), false);
  assert.equal(hasFramed(undefined), false);
  assert.doesNotThrow(() => markFramed(null));
  assert.doesNotThrow(() => markFramed(undefined));
});
