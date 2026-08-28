import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_INSETS, addBox, canFrame, getMapInsets, padUnchanged, setMapInsets, toBox } from './insets.js';

const B = (top, right, bottom, left) => ({ top, right, bottom, left });

test('число раскрывается во все четыре стороны', () => {
  assert.deepEqual(toBox(60), B(60, 60, 60, 60));
});

test('★ мусор из DOM вырождается в ноль, а не в отрицательный отступ', () => {
  // Отрицательный отступ mapbox принимает молча и уводит кадр наружу канваса.
  for (const bad of [undefined, null, NaN, -10, 'x', {}, { left: -5 }, { left: Infinity }]) {
    assert.deepEqual(toBox(bad), NO_INSETS, `${JSON.stringify(bad)}`);
  }
});


test('★ отступ фита = воздух + закрытая площадь', () => {
  // Правило, ради которого модуль и существует: в фит уходит сумма, в
  // поверхность — только закрытая площадь.
  assert.deepEqual(addBox(toBox(60), B(0, 0, 0, 550)), B(60, 60, 60, 610));
});

test('★ арифметика кадра: маршрут встаёт по центру СВОБОДНОГО окна с полями в воздух', () => {
  // Десктоп 1280 шириной, панель 550, воздух 60. Проверяем ровно то, что
  // посчитает mapbox: коробку фита он симметризует (полусуммы сторон), а центр
  // вида сдвигает отступ ПОВЕРХНОСТИ.
  const W = 1280, air = 60, panel = 550;
  const fit = addBox(toBox(air), B(0, 0, 0, panel));       // {60,60,60,610}
  const box = W - (fit.left + fit.right);                   // ширина, куда влезает маршрут
  const centerX = W / 2 + (panel - 0) / 2;                  // сдвиг центра отступом поверхности
  assert.equal(box, 610);
  assert.equal(centerX, 915);
  // Свободное окно [550..1280]: его центр обязан совпасть с центром вида…
  assert.equal((panel + W) / 2, centerX);
  // …а поля слева и справа от маршрута — с воздухом.
  assert.equal(centerX - box / 2 - panel, air);
  assert.equal(W - (centerX + box / 2), air);
});

test('★ та же арифметика по вертикали (телефон, шит)', () => {
  const H = 900, air = 40, sheet = 612;
  const fit = addBox(toBox(air), B(0, 0, sheet, 0));
  const box = H - (fit.top + fit.bottom);
  const centerY = H / 2 - sheet / 2;
  assert.equal(box, 208);
  assert.equal(centerY, 144);
  assert.equal((0 + (H - sheet)) / 2, centerY);
  assert.equal(centerY - box / 2, air);
  assert.equal((H - sheet) - (centerY + box / 2), air);
});

test('отступ живёт на ИНСТАНСЕ и снимается', () => {
  const a = {}, b = {};
  setMapInsets(a, { left: 550 });
  setMapInsets(b, { bottom: 300 });
  assert.deepEqual(getMapInsets(a), B(0, 0, 0, 550));
  assert.deepEqual(getMapInsets(b), B(0, 0, 300, 0));
  setMapInsets(a, null);
  assert.deepEqual(getMapInsets(a), NO_INSETS);
  // Снятие у одного не трогает другого — карта одна, экранов много.
  assert.deepEqual(getMapInsets(b), B(0, 0, 300, 0));
});

test('★ незнакомая карта отдаёт ноль, а не undefined', () => {
  // Читателей отступа много, и ни один не обязан проверять на null: «карта, про
  // которую ничего не объявляли» = «ничего не закрыто».
  assert.deepEqual(getMapInsets({}), NO_INSETS);
  assert.deepEqual(getMapInsets(null), NO_INSETS);
});



test('★ окна нет — кадрировать некуда', () => {
  // Верхний детент закрывает экран целиком: вписаться формально можно (кламп
  // оставит полоску), но обратный ход шита потом вытаскивал бы камеру из
  // предельного зума — то есть рывок, ради которого всё и делалось.
  assert.equal(canFrame(430, 900, B(0, 0, 900, 0)), false);
  assert.equal(canFrame(430, 900, B(0, 0, 861, 0)), false, 'ровно на границе 80 — ещё нет');
  assert.equal(canFrame(430, 900, B(0, 0, 820, 0)), true, '80 свободных — уже да');
});


test('★ немеряный канвас — не кадрируем', () => {
  // Ноль приходит первым кадром и на размонтировании; «вписаться в ничто» —
  // это не ошибка вызывателя, а нормальное состояние, и ответ на него «подожди».
  assert.equal(canFrame(0, 0, NO_INSETS), false);
});

// ═════════════════════════════════════════════════════════════════════════════
// «ОТСТУП УЖЕ ТАКОЙ» — ГЕЙТ ПРОТИВ ОБРЫВА ЧУЖОГО ПЕРЕЛЁТА
// Любая команда камере отменяет летящую, поэтому `easeTo` с тем же отступом
// это не «ничего не делает», а «убивает автофокус». Замер на живом экране:
// без вмешательства камера доезжает до зума 4.57, с «нулевым» easeTo через
// 200 мс после старта — остаётся на 2.15.
// ═════════════════════════════════════════════════════════════════════════════
const mapWithPad = (pad) => ({ getPadding: () => pad });

test('★ совпадающий отступ опознан — команду камере слать нельзя', () => {
  const map = mapWithPad({ top: 0, right: 0, bottom: 0, left: 0 });
  assert.equal(padUnchanged(map, NO_INSETS), true);
});

test('★ отличие хоть по одной стороне = отступ ехать обязан', () => {
  const map = mapWithPad({ top: 0, right: 0, bottom: 0, left: 0 });
  assert.equal(padUnchanged(map, { top: 0, right: 0, bottom: 0, left: 380 }), false);
});

test('дробные значения сравниваются округлёнными (mapbox хранит float)', () => {
  const map = mapWithPad({ top: 260.4, right: 0, bottom: 259.5, left: 0 });
  assert.equal(padUnchanged(map, { top: 260, right: 0, bottom: 260, left: 0 }), true);
});

test('★ библиотека без getPadding читается как «не знаем» → прежнее поведение', () => {
  assert.equal(padUnchanged({}, NO_INSETS), false);
  assert.equal(padUnchanged(null, NO_INSETS), false);
  assert.equal(padUnchanged(mapWithPad({ top: 0, right: 0, bottom: 0, left: 0 }), null), false);
});

test('упавший getPadding не роняет вызывателя', () => {
  const map = { getPadding: () => { throw new Error('boom'); } };
  assert.equal(padUnchanged(map, NO_INSETS), false);
});
