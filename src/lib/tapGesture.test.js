import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapPick, TAP_SLOP } from './tapGesture.js';

const down = (row = 'A', x = 100, y = 200, id = 1) => ({ id, x, y, row });
const up = (x = 100, y = 200, id = 1) => ({ id, x, y });

test('тап выбирает; протяжка — нет', () => {
  assert.equal(tapPick(down('Париж'), up()), 'Париж');
  assert.equal(tapPick(down('Париж'), up(100, 200 + TAP_SLOP)), 'Париж');
  assert.equal(tapPick(down('Париж'), up(100, 260)), null);
  // 7+7 по осям = 9.9 по диагонали: порог меряется по расстоянию, не по оси.
  assert.equal(tapPick(down('Париж'), up(107, 207)), null);
});

test('чужой палец чужой жест не завершает', () => {
  assert.equal(tapPick(down('Париж'), up(100, 200, 2)), null);
});

test('выбирается строка, по которой НАЖАЛИ', () => {
  // Список мог перерисоваться: «то, что под пальцем» на отпускании — уже другой
  // город, поэтому у `up` полей строки нет вовсе.
  assert.equal(tapPick(down('Париж'), { ...up(), row: 'Рим' }), 'Париж');
});

test('ложная, но настоящая строка (0 / пустая) — это выбор, а не «ничего»', () => {
  assert.equal(tapPick(down(0), up()), 0);
  assert.equal(tapPick(down(''), up()), '');
  assert.equal(tapPick({ id: 1, x: 100, y: 200, row: undefined }, up()), null);
});

test('жеста не было — null, а не исключение', () => {
  assert.equal(tapPick(null, up()), null);
  assert.equal(tapPick(down(), null), null);
});
