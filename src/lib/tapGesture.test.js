import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapPick, TAP_SLOP, swallowNextClick } from './tapGesture.js';

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

// ─── swallowNextClick ────────────────────────────────────────────────────────
// Фейковая цель вместо `window`: правило проверяется без браузера, как и `tapPick`.
function fakeTarget() {
  const ls = [];
  return {
    ls,
    addEventListener: (type, fn, capture) => ls.push({ type, fn, capture }),
    removeEventListener: (type, fn) => {
      const i = ls.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) ls.splice(i, 1);
    },
    fire: () => {
      const ev = { stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
      [...ls].forEach((l) => l.fn(ev));
      return ev;
    },
  };
}

test('★★★ первый click после тапа съедается — иначе он нажмёт то, что легло под палец', () => {
  // Замер (тач-эмуляция 390): тап по строке города в точке x=235 попадал по
  // плитке «Старт» (x 197..280), появившейся на месте списка, и город уходил в
  // маршрут стартом. На мыши такого click нет вовсе — поэтому баг и не видно
  // ни глазами на десктопе, ни автоматизацией, которая кликает мышью.
  const t = fakeTarget();
  swallowNextClick(t);
  assert.equal(t.ls.length, 1, 'слушатель не поставлен');
  assert.equal(t.ls[0].capture, true, 'слушатель обязан быть в фазе ПЕРЕХВАТА: узла, по которому придёт click, ещё нет');
  const ev = t.fire();
  assert.ok(ev.stopped && ev.prevented, 'click не заглушен');
});

test('★★ съедается РОВНО ОДИН — второй клик человека проходит', () => {
  // Держать глушилку дольше одного события значит съесть настоящее нажатие.
  const t = fakeTarget();
  swallowNextClick(t);
  t.fire();
  assert.equal(t.ls.length, 0, 'слушатель остался висеть после первого click');
});

test('★ окно снимается само — на мыши и клавиатуре click не придёт вовсе', async () => {
  const t = fakeTarget();
  swallowNextClick(t, 10);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(t.ls.length, 0, 'слушатель пережил своё окно и съест чужой клик');
});

test('★ снятие досрочно и повторное снятие безопасны', () => {
  const t = fakeTarget();
  const off = swallowNextClick(t);
  off(); off();
  assert.equal(t.ls.length, 0);
  // Нет цели — нет и работы: модуль обязан открываться в не-браузерном контексте.
  assert.doesNotThrow(() => swallowNextClick(null)());
});
