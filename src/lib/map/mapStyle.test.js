// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legLook, SOLID_WIDTH, DASHED_WIDTH } from './mapStyle.js';

// ЗАЧЕМ ЭТОТ ТЕСТ. Развилка «есть переезд / нет переезда» решает не украшение, а
// СМЫСЛ линии: пунктир на живой карте — предупреждение о дыре в плане. Развилка
// эта нужна в трёх местах сразу (базовая отрисовка, прогрессивное раскрытие
// публичного трипа, подсветка выбранного сегмента), и пока она была написана
// тремя копиями `!kind`, поверхность чинилась в одной из них молча: карта
// продолжала рисовать линии, просто где-то не тем обликом. Тест судит ПРАВИЛО,
// а не его вызывателей.

test('legLook: переезд есть — сплошная, переезда нет — пунктир (карта, где планируют)', () => {
  assert.equal(legLook('plane'), 'solid');
  assert.equal(legLook('car'), 'solid');
  assert.equal(legLook(undefined), 'dashed');
  assert.equal(legLook(null), 'dashed');
  assert.equal(legLook(''), 'dashed');
});

test('legLook: поверхность без планирования рисует маршрут ЦЕЛЫМ', () => {
  // share-карточка: дыру предупреждать не перед кем, пунктир читался бы дефектом
  // печати. Плечо без переезда становится такой же сплошной, как любое другое.
  assert.equal(legLook(undefined, false), 'solid');
  assert.equal(legLook(null, false), 'solid');
  assert.equal(legLook('', false), 'solid');
});

test('legLook: markGaps НЕ трогает плечи, у которых переезд есть', () => {
  // Режим касается ровно одного случая. Если он начнёт менять облик обычного
  // плеча, карточка потеряет разницу между «летел» и «дыра» вообще.
  for (const kind of ['plane', 'car', 'train', 'ferry', 'bus']) {
    assert.equal(legLook(kind, true), 'solid');
    assert.equal(legLook(kind, false), 'solid');
  }
});

test('legLook: по умолчанию дыры показываются', () => {
  // Умолчание — поведение живых карт: вызыватель, который про режим не знает,
  // обязан получить предупреждение, а не потерять его.
  assert.equal(legLook(undefined), legLook(undefined, true));
});

test('канон весов: сплошная толще пунктира (иначе «целая линия» тоньше дыры)', () => {
  assert.ok(SOLID_WIDTH > DASHED_WIDTH);
});
