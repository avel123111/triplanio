import test from 'node:test';
import assert from 'node:assert/strict';
import { mapShellInsets } from './mapShellInsets.js';

const NONE = { top: 0, right: 0, bottom: 0, left: 0 };

const half = (n) => ({ ...NONE, top: Math.round(n / 2), bottom: Math.round(n / 2) });

test('★★★ ТЕЛЕФОН: КАМЕРЕ ОТСТУП НЕ НУЖЕН, А РАСЧЁТУ КАДРА — НУЖЕН', () => {
  // Вид уводит сам ХОЛСТ (он уезжает вверх на половину шита), поэтому камере
  // отступ не нужен вовсе — а `transform.padding` на проекции `globe` рисует
  // планету диском с прозрачным остатком, это замерено и это были «круги».
  // Но вписывать маршрут всё равно надо в ВИДИМУЮ полосу холста: она
  // центральная, отсюда симметричная коробка по половине шита.
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 612 }),
    { slotBottom: 612, camera: NONE, fit: half(612), shift: 306 });
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 135 }),
    { slotBottom: 135, camera: NONE, fit: half(135), shift: 68 });
});

test('★ без шита обе коробки пусты', () => {
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 0 }),
    { slotBottom: 0, camera: NONE, fit: NONE, shift: 0 });
});

test('★★ ДЕСКТОП: панель режет ШИРИНУ — холст целый, кадр уводит камера', () => {
  // По вертикали не закрыто ничего, высота холста = высоте свободного окна →
  // размер шара попадает точно и без сжатия холста.
  assert.deepEqual(mapShellInsets({ panelPx: 550 }), { slotBottom: 0, camera: { ...NONE, left: 550 }, fit: { ...NONE, left: 550 }, shift: 0 });
});

test('свёрнутая панель не закрывает ничего', () => {
  assert.deepEqual(mapShellInsets({ panelPx: 550, collapsed: true }), { slotBottom: 0, camera: NONE, fit: NONE, shift: 0 });
});

test('★ открытый слой закрывает колонку — и при свёрнутом маршруте (булев флаг)', () => {
  assert.deepEqual(mapShellInsets({ panelPx: 550, collapsed: true, overlayOpen: true }),
    { slotBottom: 0, camera: { ...NONE, left: 550 }, fit: { ...NONE, left: 550 }, shift: 0 });
  assert.deepEqual(mapShellInsets({ panelPx: 550, overlayOpen: true }),
    { slotBottom: 0, camera: { ...NONE, left: 550 }, fit: { ...NONE, left: 550 }, shift: 0 });
  assert.deepEqual(mapShellInsets({ panelPx: 550, collapsed: true, overlayOpen: false }),
    { slotBottom: 0, camera: NONE, fit: NONE, shift: 0 });
});

test('★ режимы не смешиваются: чужая величина не читается', () => {
  // Шит в портале успевает подержать прошлую высоту на переходе в десктоп —
  // прочитать её значит отрезать у десктопной карты низ по призраку.
  assert.deepEqual(mapShellInsets({ phone: false, sheetPx: 612, panelPx: 550 }),
    { slotBottom: 0, camera: { ...NONE, left: 550 }, fit: { ...NONE, left: 550 }, shift: 0 });
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 612, panelPx: 550 }),
    { slotBottom: 612, camera: NONE, fit: half(612), shift: 306 });
});

test('★ немеряное вырождается в «карта во всю площадь», а не в минус', () => {
  for (const bad of [0, -40, NaN, Infinity, undefined, null, '550']) {
    assert.deepEqual(mapShellInsets({ phone: true, sheetPx: /** @type {any} */ (bad) }),
      { slotBottom: 0, camera: NONE, fit: NONE, shift: 0 });
    assert.deepEqual(mapShellInsets({ panelPx: /** @type {any} */ (bad) }),
      { slotBottom: 0, camera: NONE, fit: NONE, shift: 0 });
  }
});

test('дробные измерения округляются (пиксель — целое)', () => {
  assert.equal(mapShellInsets({ phone: true, sheetPx: 611.6 }).slotBottom, 612);
  assert.equal(mapShellInsets({ panelPx: 549.6 }).camera.left, 550);
});

test('без аргументов — карта во всю площадь', () => {
  assert.deepEqual(mapShellInsets(), { slotBottom: 0, camera: NONE, fit: NONE, shift: 0 });
});

test('★ НИЗ СВОБОДНОГО ОКНА = ВЫСОТА ШИТА — по нему отступает то, что лежит ПОВЕРХ карты', () => {
  // Холст во всю высоту шелла и уходит ПОД шит целиком, поэтому «14px от своего
  // низа» у пилюли планировщика приходятся на площадь под шитом. Прибавь эту
  // величину — и отступ снова считается от края шита. Занизь её (так было, пока
  // из неё вычитали радиус скруглений) — и пилюля ляжет НА шит.
  assert.equal(mapShellInsets({ phone: true, sheetPx: 612 }).slotBottom, 612);
  assert.equal(mapShellInsets({ phone: true, sheetPx: 135 }).slotBottom, 135);
  // Десктоп: шита нет, отступать не от чего — читатель обязан получить ноль.
  assert.equal(mapShellInsets({ panelPx: 550 }).slotBottom, 0);
});

test('★★ ПОТОЛОК СДВИГА — ВТОРОЙ СВЕРХУ ДЕТЕНТ: с середины вверх карту не трогаем', () => {
  // Верхний детент закрывает экран целиком: всё, что мы там двигаем, никто не
  // видит, а движение при этом видно на подходе к нему. Выше потолка И сдвиг, И
  // коробка кадра обязаны замереть — иначе маршрут перекадрируется впустую.
  const mid = mapShellInsets({ phone: true, sheetPx: 480, capPx: 480 });
  const top = mapShellInsets({ phone: true, sheetPx: 702, capPx: 480 });
  assert.equal(top.shift, mid.shift);
  assert.deepEqual(top.fit, mid.fit);
  // А низ окна за шитом следует и там: пилюля обязана оставаться над ним.
  assert.equal(top.slotBottom, 702);
});

test('★ без потолка сдвиг идёт по самому шиту (потолок не объявлен — не выдумываем)', () => {
  assert.equal(mapShellInsets({ phone: true, sheetPx: 702 }).shift, 351);
});
