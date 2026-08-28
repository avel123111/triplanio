/**
 * Тесты подписей share-карточки (TRIP-443).
 *
 * ЗАЧЕМ. Подпись стоит ПОД числом и обязана с ним согласоваться. До этого формы
 * были фиксированными строками — карточка печатала «95 дни» и «5 города». У
 * такого дефекта нет ни скриншота-эталона, ни гарда: он виден только глазами и
 * только на конкретных числах. Гейт — тест на чистой функции (правило проекта:
 * «у поведения нет скриншота, гейт = тест на чистой функции»).
 *
 * Русское правило проверяется целиком, а не «1 / не 1»: ловушка здесь —
 * ВТОРОЙ десяток. 11..14 берут форму «5+» («11 дней»), хотя последняя цифра
 * говорит обратное; наивная реализация по последней цифре даёт «11 день» и
 * «12 дня» — и молчит, пока трип не окажется нужной длины.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { cardStrings, plural } from './shareCardText.ts';

const RU_DAYS = ['день', 'дня', 'дней'] as const;

Deno.test('ru: последняя цифра выбирает форму', () => {
  assertEquals(plural(1, RU_DAYS), 'день');
  assertEquals(plural(2, RU_DAYS), 'дня');
  assertEquals(plural(4, RU_DAYS), 'дня');
  assertEquals(plural(5, RU_DAYS), 'дней');
  assertEquals(plural(0, RU_DAYS), 'дней');
});

Deno.test('ru: второй десяток (11..14) — всегда форма «5+»', () => {
  for (const n of [11, 12, 13, 14, 111, 112]) {
    assertEquals(plural(n, RU_DAYS), 'дней', `${n} должно быть «дней»`);
  }
});

Deno.test('ru: за вторым десятком правило снова по последней цифре', () => {
  assertEquals(plural(21, RU_DAYS), 'день');
  assertEquals(plural(22, RU_DAYS), 'дня');
  assertEquals(plural(25, RU_DAYS), 'дней');
  assertEquals(plural(101, RU_DAYS), 'день');
});

Deno.test('карточка с данными из живого бага печатает согласованные подписи', () => {
  // Тот самый скриншот: «95 дни», «5 города», «3 страны».
  const s = cardStrings('ru', { days: 95, cities: 5, countries: 3 });
  assertEquals(s.days, 'дней');
  assertEquals(s.cities, 'городов');
  assertEquals(s.countries, 'страны');
  assertEquals(s.km, 'км');
  assertEquals(s.visited, 'Страны');
});

Deno.test('единственное число', () => {
  const s = cardStrings('ru', { days: 1, cities: 1, countries: 1 });
  assertEquals(s.days, 'день');
  assertEquals(s.cities, 'город');
  assertEquals(s.countries, 'страна');
});

Deno.test('en: единственное и множественное', () => {
  assertEquals(cardStrings('en', { days: 1, cities: 1, countries: 1 }).days, 'Day');
  assertEquals(cardStrings('en', { days: 7, cities: 3, countries: 2 }).days, 'Days');
  assertEquals(cardStrings('en', { days: 7, cities: 1, countries: 2 }).cities, 'City');
  // Второй десяток НЕ должен утаскивать английский в единственное число.
  assertEquals(cardStrings('en', { days: 11, cities: 11, countries: 11 }).days, 'Days');
});

Deno.test('es: единственное и множественное', () => {
  assertEquals(cardStrings('es', { days: 1, cities: 1, countries: 1 }).cities, 'Ciudad');
  assertEquals(cardStrings('es', { days: 4, cities: 4, countries: 4 }).cities, 'Ciudades');
});

Deno.test('неизвестный язык падает на en, а не роняет карточку', () => {
  // @ts-expect-error — намеренно недопустимый Lang: контракт «фолбэк, не бросок».
  const s = cardStrings('de', { days: 3, cities: 3, countries: 3 });
  assertEquals(s.days, 'Days');
});
