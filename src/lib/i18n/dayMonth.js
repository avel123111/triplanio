// «День + короткий месяц»: 5 авг. · 5 Aug · 5 ago.
//
// ОТДЕЛЬНЫМ модулем и БЕЗ ЕДИНОГО ИМПОРТА — чтобы его брал `node --test`: соседний
// `format.js` тянет `./translations` без расширения, и под голым Node такой путь не
// резолвится (та же конвенция, что у `trip-cities.js`). Зачем функция вообще
// переехала с luxon на `Intl` — в докблоке `format.js`.
//
// ★ «БЕЗ ИМПОРТОВ» — ЕЩЁ И ПЕРФ-ИНВАРИАНТ ЛЕНДИНГА, А НЕ ТОЛЬКО УДОБСТВО ТЕСТА.
// Этот модуль лежит в СИНХРОННОМ графе лендинга (`main.jsx → App.jsx →
// I18nContext → format.js → сюда`), поэтому любой его статический импорт тянет
// за собой всё, что тянет импортируемый. Замер (TRIP-527): один
// `import { isYmd } from '../time.js'` (а `time.js` → `naive-time.js` → luxon)
// вернул чанк luxon в `modulepreload` документа — 71.5 КБ / 22 КБ gzip
// анонимному посетителю, которому дат не показывают вовсе. Ровно то, что снял
// TRIP-475 шаг 3. Поэтому предикат формы даты ниже — СОБСТВЕННАЯ копия
// (`src/lib/time.js` держит такую же для графа приложения): цена общего дома
// здесь — вес первого кадра.
//
// Принимает ГОТОВЫЙ locale-тег (`ru-RU`), а не язык: перевод `ru → ru-RU` — дело
// вызывающего, здесь ноль знаний о словаре.
//
// ★ ПОРЯДОК СЛОВ СОБИРАЕМ САМИ, а не отдаём локали. `Intl` с `{day,month}` печатает
// по-английски «Aug 5», а прежний luxon-токен `'d MMM'` печатал «5 Aug». Сборка из
// `formatToParts` сохраняет прежний вид всех трёх языков ПОБУКВЕННО — иначе правка
// молча переставила бы дату на публичной странице трипа.
// ★ ДАТА БЕЗ ВРЕМЕНИ ЗОНУ НЕ ПРИМЕНЯЕТ. luxon трактовал `'2026-11-01'` как полночь
// В ЗОНЕ и печатал 1 ноября в любой зоне. Наивный перевод «разобрать как UTC и
// показать в `America/Los_Angeles`» дал бы 31 октября — сутки назад. Поэтому зона
// участвует только там, где во входе есть время.
//
// Эквивалентность прежнему выводу проверена на 1008 сочетаниях (3 языка × 8 зон ×
// 42 значения, включая переходы месяца и года) — расхождений ноль. Закреплено
// `dayMonth.test.js`: там лежат ЭТАЛОНЫ, снятые с luxon до правки.

const SHORT_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export function dayMonth(value, timezone, localeTag) {
  if (!value) return '';
  const iso = String(value);
  const dateOnly = SHORT_DATE_ONLY.test(iso);
  const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = dateOnly || !timezone || timezone === 'utc' ? 'UTC' : timezone;
  let parts;
  try {
    parts = new Intl.DateTimeFormat(localeTag, { day: 'numeric', month: 'short', timeZone: zone })
      .formatToParts(d);
  } catch {
    // Незнакомая движку зона (кривые данные города) — показываем дату, а не пустоту.
    parts = new Intl.DateTimeFormat(localeTag, { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .formatToParts(d);
  }
  const pick = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${pick('day')} ${pick('month')}`;
}
