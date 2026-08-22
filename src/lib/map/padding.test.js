import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPadding, clampPaddingBox, hasPadding, toPaddingBox, MIN_CANVAS } from './padding.js';

const PHONE = { width: 390, height: 800 };

/* ── Ради чего функция существует: отступ не может съесть канвас ─────────── */

test('★★ шит во весь экран: нижний отступ ужат, канвас остаётся', () => {
  // Ровно тот случай, что даёт «чёрный круг»: fitBounds с отступом больше
  // канваса молча уезжает на минимальный зум, и глобус повисает в космосе.
  const out = clampPaddingBox(PHONE, { bottom: 800, top: 24 });
  assert.ok(out.top + out.bottom <= PHONE.height - MIN_CANVAS, JSON.stringify(out));
  assert.ok(out.bottom > 0, 'низ не обнуляем — точка ушла бы под шит');
});

test('★★ пропорция сторон сохраняется при ужатии', () => {
  // Композиция «низ съеден вдвое сильнее верха» обязана пережить кламп, иначе
  // камера после ужатия смотрит не туда, куда её просили.
  const out = clampPaddingBox({ width: 400, height: 300 }, { top: 200, bottom: 400 });
  assert.ok(out.top + out.bottom <= 300 - MIN_CANVAS);
  assert.ok(Math.abs(out.bottom / out.top - 2) < 0.05, JSON.stringify(out));
});

test('оси независимы: съеденный низ не трогает лево/право', () => {
  const out = clampPaddingBox(PHONE, { bottom: 900, left: 40, right: 40 });
  assert.equal(out.left, 40);
  assert.equal(out.right, 40);
});

test('панель слева на десктопе ужимается по ШИРИНЕ, а не по высоте', () => {
  const out = clampPaddingBox({ width: 500, height: 900 }, { left: 700, top: 60 });
  assert.ok(out.left <= 500 - MIN_CANVAS, JSON.stringify(out));
  assert.equal(out.top, 60);
});

test('помещается — не трогаем вовсе', () => {
  assert.deepEqual(clampPaddingBox(PHONE, { top: 20, bottom: 100, left: 10, right: 10 }),
    { top: 20, right: 10, bottom: 100, left: 10 });
});

/* ── Скаляр остаётся скаляром по смыслу ──────────────────────────────────── */

test('число = одинаково со всех сторон', () => {
  assert.deepEqual(toPaddingBox(60), { top: 60, right: 60, bottom: 60, left: 60 });
});

test('★ скаляр, не помещающийся по узкой оси, ужимается — прежняя защита не потеряна', () => {
  const out = clampPaddingBox({ width: 100, height: 900 }, 80);
  assert.ok(out.left + out.right <= 100 - MIN_CANVAS, JSON.stringify(out));
});

/* ── Границы ─────────────────────────────────────────────────────────────── */

test('неизмеренная ось не клампится: врать про размер хуже, чем пропустить кадр', () => {
  assert.deepEqual(clampPaddingBox({ width: 0, height: 0 }, { left: 999, top: 999 }),
    { top: 999, right: 0, bottom: 0, left: 999 });
});

test('мусор на входе = нули, а не NaN в камере', () => {
  assert.deepEqual(toPaddingBox(undefined), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(toPaddingBox(NaN), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(toPaddingBox({ top: 'x', bottom: null }), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(toPaddingBox(-40), { top: 0, right: 0, bottom: 0, left: 0 });
});

test('hasPadding отличает пустой бокс от занятого', () => {
  assert.equal(hasPadding(toPaddingBox(0)), false);
  assert.equal(hasPadding(toPaddingBox({ bottom: 1 })), true);
});

test('addPadding складывает воздух маршрута и место панели', () => {
  assert.deepEqual(addPadding(60, { bottom: 300, left: 400 }),
    { top: 60, right: 60, bottom: 360, left: 460 });
});
