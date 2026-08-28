/**
 * Текст карточки раскладывается в ОДНОМ месте (TRIP-443 → превью на DOM-тексте).
 *
 * ЗАЧЕМ ЭТОТ ТЕСТ. Раскладку текста читают двое: SVG-рендер карточки и клиент,
 * который кладёт тот же текст DOM-ом поверх кадра превью. Пока источник один
 * (`buildCardText`), превью и готовая карточка не могут разойтись по построению.
 * Стоит кому-то напечатать строку в `buildCardSvg` мимо списка — превью её
 * потеряет, и дефект будет ТИХИМ: карточка выглядит правильно, а в превью текста
 * просто нет. Ровно так этот экран и ломался весь день.
 *
 * Поэтому главный инвариант тут не «координата равна числу», а «в кадре нет
 * текста, которого нет в списке»: счёт узлов `<text>` сверяется со списком.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildCardSvg, buildCardText, type CardData, type Format } from './template.ts';

const DATA: CardData = {
  title: 'Автотур по Балканам',
  from: 'Белград',
  to: 'Будва',
  distanceStr: '4 382',
  days: '95',
  cities: '5',
  countries: '3',
  flags: ['rs', 'ba', 'me'],
  kmLabel: 'км',
  daysLabel: 'дней',
  citiesLabel: 'городов',
  countriesLabel: 'страны',
  visitedLabel: 'Страны',
  brand: 'Triplanio',
};

const FORMATS: Format[] = ['story', 'post'];

Deno.test('весь текст открытой зоны приходит из buildCardText, ничего мимо', () => {
  for (const format of FORMATS) {
    const items = buildCardText(format, DATA);
    const svg = buildCardSvg(format, DATA, null, true, '');
    const nodes = (svg.match(/<text\b/g) || []).length;
    // Каждый элемент рисуется ДВАЖДЫ (тёмная копия тени + белый оригинал), плюс
    // подпись «Страны» внутри кремовой рамки — она часть картинки, а не текст
    // карточки, и в список намеренно не входит.
    assertEquals(nodes, items.length * 2 + 1, `${format}: текст в кадре разошёлся со списком`);
  }
});

Deno.test('маршрут — ОДНА строка со стрелкой-символом', () => {
  const route = buildCardText('story', DATA).filter((i) => i.kind === 'route');
  assertEquals(route.length, 1, 'маршрут обязан быть одним элементом: его правят одним полем');
  assertEquals(route[0].value, 'Белград → Будва');
  // Стрелка — настоящий символ, а не фигура: фигур со скруглённым штрихом
  // (нарисованная стрелка) в кадре больше нет.
  assert(!buildCardSvg('story', DATA, null, true, '').includes('stroke-linecap="round"'));
});

Deno.test('маршрут без второго города — просто город, без стрелки', () => {
  for (const to of ['', 'Белград']) {
    const route = buildCardText('story', { ...DATA, to }).filter((i) => i.kind === 'route');
    assertEquals(route[0].value, 'Белград', `to="${to}"`);
  }
});

Deno.test('длинный заголовок — две строки одного кегля, маршрут ниже них', () => {
  const items = buildCardText('story', DATA);
  const title = items.filter((i) => i.kind === 'title');
  const route = items.find((i) => i.kind === 'route')!;
  assertEquals(title.length, 2);
  assertEquals(title[0].size, title[1].size, 'строки заголовка одного кегля');
  assert(title[0].y < title[1].y && title[1].y < route.y, 'порядок сверху вниз');
});

Deno.test('подпись «Страны» в список НЕ входит — она внутри рамки, часть картинки', () => {
  const values = buildCardText('story', DATA).map((i) => i.value);
  assert(!values.includes(DATA.visitedLabel));
});

Deno.test('координаты — в единицах карточки, а не экрана', () => {
  for (const format of FORMATS) {
    const svg = buildCardSvg(format, DATA, null, true, '');
    const w = Number(svg.match(/viewBox="0 0 (\d+) (\d+)"/)![1]);
    const h = Number(svg.match(/viewBox="0 0 (\d+) (\d+)"/)![2]);
    for (const i of buildCardText(format, DATA)) {
      assert(i.x >= 0 && i.x <= w, `${format}: x вне кадра (${i.x})`);
      assert(i.y >= 0 && i.y <= h, `${format}: y вне кадра (${i.y})`);
      assert(i.size > 0 && i.weight >= 400 && i.weight <= 800, `${format}: облик вне шкалы`);
    }
  }
});
