// Демо-поездка: даты в ДАННЫХ и даты в ТЕКСТЕ обязаны сходиться.
//
// ЗАЧЕМ. Витрина продукта про планирование поездок собрана из трёх независимых
// кусков: ISO-даты городов в `demoTrip.js`, руками выложенная сетка календаря
// там же и переведённая копия в `landing.json` × 3 языка. Ни один инструмент их
// не связывает: перенеси поездку на другой месяц, замени в строках название
// месяца — и заголовки дней покажут ПРОШЛОГОДНИЕ дни недели, а календарь
// поставит числа не под теми колонками. Это не гипотеза: ровно так выглядел бы
// перенос с сентября 2026 на май 2027, если бы дни недели не пересчитали
// (14-е было понедельником, стало пятницей; 1-е число месяца сместилось со
// вторника на субботу, то есть вся сетка едет на четыре ячейки).
//
// Глазами это не ловится: «Понедельник, 14 мая» выглядит совершенно нормально.
// Поэтому гейт здесь, и он КРАСНЕЕТ на любой из трёх правок по отдельности.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_VISITS, DEMO_CAL } from './demoTrip.js';

const LOCALES = ['en', 'ru', 'es'];
const dict = Object.fromEntries(LOCALES.map((l) => [
  l, JSON.parse(readFileSync(new URL(`../../lib/i18n/locales/${l}/landing.json`, import.meta.url), 'utf8')),
]));

// Окно поездки — из ДАННЫХ, а не из константы теста: сдвинули даты городов,
// и все проверки ниже поехали за ними сами.
const days = DEMO_VISITS.flatMap((v) => [v.start_date, v.end_date]).sort();
const FIRST = days[0];
const LAST = days[days.length - 1];
const [YEAR, MONTH] = FIRST.split('-').map(Number);

const weekday = (day, locale) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
  .format(new Date(Date.UTC(YEAR, MONTH - 1, day)));

test('окружение умеет локальные названия дней (иначе проверки ниже пусты)', () => {
  assert.match(weekday(14, 'ru'), /[а-яё]/i, 'у Node нет полного ICU — тест ничего не проверяет');
  assert.match(weekday(14, 'es'), /[a-záéíóúñ]/i);
});

test('поездка целиком внутри одного месяца (на этом стоят проверки ниже)', () => {
  assert.equal(FIRST.slice(0, 7), LAST.slice(0, 7), `${FIRST}..${LAST}`);
});

test('★ день недели в заголовке дня = настоящий день недели этой даты', () => {
  let checked = 0;
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(dict[locale])) {
      if (!/^demo\.tl\.d\d+\.dh$/.test(key)) continue;
      // «Пятница, 14 мая» / «Friday, 14 May» / «Viernes, 14 de mayo»
      const m = value.match(/^(\S+),\s.*?(\d{1,2})/u);
      assert.ok(m, `${locale}/${key}: «${value}» — не разобрать «день недели, число»`);
      const [, said, dayStr] = m;
      const day = Number(dayStr);
      const real = weekday(day, locale);
      assert.equal(
        said.toLocaleLowerCase(locale), real.toLocaleLowerCase(locale),
        `${locale}/${key}: «${value}» — ${day}.${MONTH}.${YEAR} это ${real}, а не ${said}`,
      );
      const iso = `${YEAR}-${String(MONTH).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const outside = `${locale}/${key}: ${iso} вне окна поездки ${FIRST}..${LAST}`;
      assert.ok(iso >= FIRST, outside);
      assert.ok(iso <= LAST, outside);
      checked += 1;
    }
  }
  assert.ok(checked >= 15, `проверено ${checked} заголовков — ожидалось не меньше пяти на каждый из трёх языков`);
});

test('★ сетка календаря ставит числа под их днями недели', () => {
  const firstDay = Number(FIRST.slice(8));
  const idx = DEMO_CAL.findIndex((c) => c.n === firstDay);
  assert.ok(idx > 0, `в DEMO_CAL нет ячейки первого дня поездки (${firstDay})`);

  // Сетка с ПОНЕДЕЛЬНИКА: колонка 0 — понедельник. `getUTCDay()` считает с
  // воскресенья, поэтому сдвигаем.
  const real = (new Date(`${FIRST}T00:00:00Z`).getUTCDay() + 6) % 7;
  assert.equal(
    idx % 7, real,
    `${FIRST} — ${weekday(firstDay, 'ru')}, это колонка ${real}, а ячейка стоит в колонке ${idx % 7}. `
    + `Ведущих ячеек сейчас ${idx}; их должно быть столько, чтобы хвост прошлого месяца и дни `
    + `до поездки заняли ровно колонки перед ${real}-й (сетка не пересчитана вслед за датами).`,
  );

  // Числа поездки идут подряд и покрывают всё окно — иначе день выпал из мока.
  const trip = DEMO_CAL.slice(idx, idx + (Number(LAST.slice(8)) - firstDay + 1)).map((c) => c.n);
  assert.deepEqual(trip, trip.map((_, i) => firstDay + i), 'дни поездки в календаре идут не подряд');
});
