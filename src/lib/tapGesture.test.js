import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapPick, TAP_SLOP } from './tapGesture.js';

/* Гейт жеста выбора в списке пикера (см. шапку `tapGesture.js`).
 * КАЖДАЯ проверка увидена КРАСНОЙ мутацией источника:
 *   1. `if (down.id !== up.id) return null` снято          → «чужой указатель» зелёный
 *   2. `> slop` → `>= slop`                                 → «ровно порог» краснеет
 *   3. `Math.hypot(...)` → `Math.abs(up.x - down.x)`        → «наискосок» зелёный
 *   4. `return down.row` → `return up.row ?? down.row`      → «строка от down» зелёный
 *   5. `if (!down || !up) return null` снято                → «жеста не было» бросает
 *   6. `TAP_SLOP = 9` → `12`                                → «порог общий с DnD» краснеет
 */

const down = (row = 'A', x = 100, y = 200, id = 1) => ({ id, x, y, row });
const up = (x = 100, y = 200, id = 1) => ({ id, x, y });

test('палец не сдвинулся — это тап, выбрана строка', () => {
  assert.equal(tapPick(down('Париж'), up()), 'Париж');
});

test('сдвиг в пределах порога — всё ещё тап', () => {
  assert.equal(tapPick(down('Париж'), up(100 + TAP_SLOP, 200)), 'Париж');
});

test('сдвиг ровно на порог — ещё тап, за порогом — уже нет', () => {
  assert.equal(tapPick(down('Париж'), up(100, 200 + TAP_SLOP)), 'Париж');
  assert.equal(tapPick(down('Париж'), up(100, 200 + TAP_SLOP + 1)), null);
});

test('скролл списка (палец уехал вниз) выбором не является', () => {
  assert.equal(tapPick(down('Париж'), up(100, 260)), null);
});

test('порог меряется по ДИАГОНАЛИ, а не по одной оси', () => {
  // 7 + 7 по осям = 9.89 по диагонали: каждая ось внутри порога, жест — нет.
  assert.equal(tapPick(down('Париж'), up(107, 207)), null);
});

test('чужой указатель (второй палец) чужой жест не завершает', () => {
  assert.equal(tapPick(down('Париж'), up(100, 200, 2)), null);
});

test('выбирается строка, по которой НАЖАЛИ, а не та, что под пальцем на отпускании', () => {
  // Список перерисовался между down и up; `up` о строках не знает вовсе —
  // именно поэтому у него нет поля `row`, и подменить выбор нечем.
  const u = { ...up(), row: 'Рим' };
  assert.equal(tapPick(down('Париж'), u), 'Париж');
});

test('жеста не было — null, а не исключение', () => {
  assert.equal(tapPick(null, up()), null);
  assert.equal(tapPick(down(), null), null);
  assert.equal(tapPick(undefined, undefined), null);
});

test('порог тот же, что у перетаскивания строк в useRouteDnD', async () => {
  const { readFileSync } = await import('node:fs');
  const dnd = readFileSync(new URL('./useRouteDnD.js', import.meta.url), 'utf8');
  assert.ok(
    new RegExp(`Math\\.hypot\\([^)]*\\)\\s*>\\s*${TAP_SLOP}\\b`).test(dnd),
    `порог ${TAP_SLOP} обязан совпадать с порогом «палец повёз» в useRouteDnD — иначе один жест считается по-разному на двух экранах`,
  );
});

test('ложная, но настоящая строка (0 / пустая строка) выбором СЧИТАЕТСЯ', () => {
  // Опцией листа законно бывает число или строка (валюты, роли, языки). Если
  // отличать «не выбрано» по истинности, такая опция не выберется НИКОГДА и
  // молча: ошибки нет, просто ничего не происходит. Признак — строго `null`.
  assert.equal(tapPick(down(0), up()), 0);
  assert.equal(tapPick(down(''), up()), '');
  assert.equal(tapPick({ id: 1, x: 100, y: 200, row: undefined }, up()), null);
});
