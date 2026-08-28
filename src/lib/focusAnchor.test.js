import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorDelta, TEXT_INPUT_SELECTOR } from './focusAnchor.js';

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

/* ── Предикат и селектор — один источник ─────────────────────────────────── */

// ★ Читателей у вопроса «что такое текстовое поле» ДВА и спрашивают по-разному:
// якорь проверяет КОНКРЕТНЫЙ элемент, поверхность ищет такое поле У СЕБЯ В
// ПОДДЕРЕВЕ (селектор). Две формы неизбежны, два ИСТОЧНИКА — нет. Разъедься они,
// отказ был бы тихим и худшего сорта: поле, которое якорь считает текстовым, а
// шит нет, дало бы «на одном экране работает, на другом нет».

test('★★ селектор исключает РОВНО те типы, что и предикат', () => {
  // Список неклавиатурных типов в тесте намеренно выписан РУКАМИ, а не взят из
  // модуля: иначе тест сверял бы источник сам с собой и прошёл бы любую правку.
  const nonText = ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'];
  for (const t of nonText) {
    assert.ok(TEXT_INPUT_SELECTOR.includes(`[type="${t}"]`), `тип ${t} обязан быть исключён из селектора`);
  }
  // И ни одного лишнего: сколько исключений в списке, столько и в селекторе.
  assert.equal((TEXT_INPUT_SELECTOR.match(/\[type="/g) || []).length, nonText.length);
});

test('селектор ловит три носителя клавиатуры', () => {
  assert.ok(TEXT_INPUT_SELECTOR.startsWith('input:not('));
  assert.ok(TEXT_INPUT_SELECTOR.includes('textarea'));
  assert.ok(TEXT_INPUT_SELECTOR.includes('[contenteditable]'));
});

test('★ contenteditable="false" не считается полем', () => {
  // Иначе любой блок с явно выключенным редактированием делал бы шит
  // полноэкранным — правило срабатывало бы там, где клавиатуры не будет.
  assert.ok(TEXT_INPUT_SELECTOR.includes('[contenteditable="false"]'));
  assert.ok(/\[contenteditable\]:not\(\[contenteditable="false"\]\)/.test(TEXT_INPUT_SELECTOR));
});
