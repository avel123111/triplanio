import test from 'node:test';
import assert from 'node:assert/strict';
import { SURFACE_EASE, SURFACE_EASE_CSS, SURFACE_SETTLE_MS, surfaceEasing } from './surfaceMotion.js';

test('кривая закреплена в обоих концах', () => {
  assert.equal(surfaceEasing(0), 0);
  assert.equal(surfaceEasing(1), 1);
  // Выход за диапазон — не «почти ноль» и не NaN, а сам конец.
  assert.equal(surfaceEasing(-1), 0);
  assert.equal(surfaceEasing(2), 1);
});

test('кривая монотонна — камера не имеет права ехать назад', () => {
  let prev = -1;
  for (let i = 0; i <= 100; i += 1) {
    const v = surfaceEasing(i / 100);
    assert.ok(v >= prev, `t=${i / 100}: ${v} < ${prev}`);
    prev = v;
  }
});

test('★ параметр решается, а не подставляется', () => {
  // Ловушка, ради которой модуль и написан: подстановка `t` вместо параметра
  // кривой даёт ПОХОЖУЮ, но другую кривую. У ease-out `.22,1,.36,1` разница
  // максимальна на первой трети хода — там, где глаз и ловит рассинхрон.
  const naive = (t) => { const v = 1 - t; return 3 * v * v * t * 1 + 3 * v * t * t * 1 + t * t * t; };
  assert.ok(surfaceEasing(0.25) - naive(0.25) > 0.15,
    `решённая кривая обязана заметно опережать наивную: ${surfaceEasing(0.25)} vs ${naive(0.25)}`);
  // На четверти времени ease-out уже прошёл больше половины пути.
  assert.ok(surfaceEasing(0.25) > 0.5);
});



test('линейная кривая совпадает сама с собой', () => {
  // Контроль метода: для прямой решение параметра обязано дать тождество.
  for (const t of [0.1, 0.3, 0.5, 0.77, 0.9]) {
    assert.ok(Math.abs(surfaceEasing(t, [1 / 3, 1 / 3, 2 / 3, 2 / 3]) - t) < 1e-6);
  }
});
