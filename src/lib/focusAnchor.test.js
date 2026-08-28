import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorDelta, reserveNeeded } from './focusAnchor.js';

// Числа — С УСТРОЙСТВА, а не выдуманные: iPhone, iOS 26, Safari (замер в
// PR #1067). Раскладка 766, клавиатура занимает 338, видимая полоса 428, и
// Safari ЦЕНТРИРУЕТ фокусное поле в этой полосе: сдвиг = центрПоля − центрПолосы.
const VH = 766;
const BAND = 428;
const BAND_CENTER = BAND / 2; // 214 — точка, выше которой сдвиг Safari уходит в минус
const TARGET = VH * 0.22;     // 168.5 — куда целимся мы, с запасом ниже 214

/* ── Куда уезжает поле ───────────────────────────────────────────────────── */

test('поле у нижней кромки уезжает под целевую точку', () => {
  // Худший случай приложения: поле в конце панели шита.
  const d = anchorDelta({ fieldTop: 600, fieldHeight: 44, viewportH: VH });
  assert.equal(d, Math.round(622 - TARGET));
  // Проверка смысла, а не арифметики: после прокрутки центр поля ВЫШЕ центра
  // видимой полосы, то есть желаемый сдвиг Safari отрицателен и клампится в 0.
  assert.ok(622 - d < BAND_CENTER);
});

test('★★ поле уже выше цели — не трогаем', () => {
  // Тянуть его ВНИЗ нельзя: именно наверху страница не едет вовсе, и любой наш
  // сдвиг оттуда только вернул бы панораму, которую мы и убираем.
  assert.equal(anchorDelta({ fieldTop: 40, fieldHeight: 44, viewportH: VH }), 0);
});

test('поле ровно в целевой точке — не трогаем', () => {
  const top = TARGET - 22;
  assert.equal(anchorDelta({ fieldTop: top, fieldHeight: 44, viewportH: VH }), 0);
});

/* ── Робастность к высоте клавиатуры ─────────────────────────────────────── */

test('★★ цель ВЫШЕ центра полосы, а не равна ему', () => {
  // Несущее свойство: высота клавиатуры гуляет (RU-раскладка, предиктивная
  // панель, accessory bar), то есть центр полосы плавает. Целься мы в него
  // точно — промах возвращал бы панораму. Запас должен пережить полосу, которая
  // на 60px ниже замеренной.
  const narrowBandCenter = (BAND - 60) / 2;
  assert.ok(TARGET < narrowBandCenter, 'цель обязана лежать выше даже узкой полосы');
});

/* ── Границы ─────────────────────────────────────────────────────────────── */

test('нулевой вьюпорт не двигает ничего', () => {
  assert.equal(anchorDelta({ fieldTop: 600, fieldHeight: 44, viewportH: 0 }), 0);
});

test('высокое поле считается по ЦЕНТРУ, а не по верху', () => {
  // Textarea чата/заметок высокая; по верху её центр уехал бы под клавиатуру.
  const tall = anchorDelta({ fieldTop: 300, fieldHeight: 200, viewportH: VH });
  const short = anchorDelta({ fieldTop: 300, fieldHeight: 44, viewportH: VH });
  assert.ok(tall > short);
  assert.equal(tall - short, 78);
});

/* ── Запас прокрутки снизу (contentInset.bottom) ─────────────────────────── */

test('★★ форма умещается в экран, поле внизу — запас берётся из НЕДОСТАЧИ', () => {
  // Тот самый случай, который валил всю конструкцию: крутить некуда
  // (scrollHeight === clientHeight), и без запаса поле не поднять ничем.
  const delta = anchorDelta({ fieldTop: 600, fieldHeight: 44, viewportH: VH });
  const need = reserveNeeded({ delta, scrollTop: 0, scrollHeight: 700, clientHeight: 700 });
  assert.equal(need, delta, 'места нет вовсе → запас равен всей недостаче');
});

test('★ длинная форма: запас только на НЕДОСТАЮЩЕЕ, а не на всю клавиатуру', () => {
  // Смысл в том, чтобы не оставлять под формой 340px мёртвого поля: если 200px
  // прокрутки уже есть, добирать надо 253, а не 453.
  const delta = anchorDelta({ fieldTop: 600, fieldHeight: 44, viewportH: VH }); // 453
  assert.equal(reserveNeeded({ delta, scrollTop: 0, scrollHeight: 900, clientHeight: 700 }), delta - 200);
});

test('места хватает — запас не добавляется вовсе', () => {
  assert.equal(reserveNeeded({ delta: 100, scrollTop: 0, scrollHeight: 1200, clientHeight: 700 }), 0);
});

test('★ уже прокрученный контейнер: считается ОСТАТОК, а не полный ход', () => {
  // scrollTop=400 из 500 возможных → доступно 100, недостача 150.
  assert.equal(reserveNeeded({ delta: 250, scrollTop: 400, scrollHeight: 1200, clientHeight: 700 }), 150);
});

test('прокрученный за предел не даёт отрицательного запаса', () => {
  assert.equal(reserveNeeded({ delta: 50, scrollTop: 9999, scrollHeight: 1200, clientHeight: 700 }), 50);
});
