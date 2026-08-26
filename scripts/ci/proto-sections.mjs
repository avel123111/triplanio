// Какие секции сравнивать в скриншот-дифе «прототип ↔ реализация».
//
// ЗАЧЕМ ОТДЕЛЬНЫМ ФАЙЛОМ. До этого список секций был КОНСТАНТОЙ ЛЕНДИНГА внутри
// харнесса. На демо и юр-страницах не находилась ни одна, каждая печатала «нет
// секции с одной из сторон», счётчик худшей секции оставался нулём — и отчёт
// заканчивался строкой «худшая секция: 0%» с кодом выхода 0. То есть инструмент
// не «не проверил»: он отрапортовал ИДЕАЛЬНЫМ СОВПАДЕНИЕМ страницу, которую не
// открывал. Приёмка Ф6.3/Ф6.6 из-за этого не делалась ни разу.
//
// Здесь чистая часть решения — она и есть то, что можно проверить тестом:
// как из разметки берётся имя секции и как складывается их пересечение.
// Браузерная половина осталась в харнессе.
//
// ПОЧЕМУ ПЕРЕСЕЧЕНИЕ, А НЕ СПИСОК. Порт зоны сделан с сохранением имён классов
// прототипа (решение TRIP-460), поэтому обе стороны называют секции одинаково —
// список выводится из самих страниц и работает на любой из шести, без правки
// харнесса под каждую новую.

/**
 * Служебные имена, которые НЕ могут быть опознавателем секции: они висят на
 * десятках секций сразу, и если такое имя окажется первым в атрибуте, ключом
 * станет оно — и разные секции склеятся в одну. Ключ, названный не целиком,
 * склеивает разные вещи в одну (тот же урок, что у ключа маркера 2p).
 */
const UTILITY = new Set([
  'section-pad', 'sheet-pane', 'wrap', 'inner', 'dark', 'light',
  'rv', 'rv-l', 'rv-r', 'in', 'centered', 'site', 'demo',
]);

/**
 * Опознаватель секции = первое СОДЕРЖАТЕЛЬНОЕ имя класса.
 * @param {string} className значение атрибута class
 * @returns {string|null} имя или null, если содержательных имён нет
 */
export function sectionKey(className) {
  if (typeof className !== 'string') return null;
  for (const name of className.split(/\s+/).filter(Boolean)) {
    if (!UTILITY.has(name)) return name;
  }
  return null;
}

/**
 * Разобрать `--sections a,b,c`. Пустая строка и отсутствие значения — «все».
 * @returns {string[]|null} null = не сужать
 */
export function parseOnly(raw) {
  if (typeof raw !== 'string') return null;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

/**
 * Разобрать `--alias dm-hero=hero,foo=bar` — «эта секция реализации называется
 * в макете иначе».
 *
 * ЗАЧЕМ. Часть секций переименована НАМЕРЕННО: `site.css` один на всю зону, и
 * демо не может звать свой первый экран `hero` — это имя уже занято лендингом.
 * Без псевдонима такая секция не попадает в пересечение и молча выпадает из
 * приёмки: отчёт печатает её в «только у макета» / «только у реализации», а
 * сравнения не происходит. Именно так первый экран демо не сравнивался ни разу.
 *
 * @returns {Map<string,string>} имя в реализации → имя в макете
 */
export function parseAliases(raw) {
  const map = new Map();
  if (typeof raw !== 'string') return map;
  for (const pair of raw.split(',')) {
    const [from, to] = pair.split('=').map((s) => (s || '').trim());
    if (from && to) map.set(from, to);
  }
  return map;
}

/**
 * Секции, которые есть С ОБЕИХ СТОРОН, в порядке прототипа (он эталон, значит
 * он и задаёт порядок отчёта). Повтор имени берётся один раз: харнесс снимает
 * секцию селектором и всё равно взял бы первую.
 *
 * @param {string[]} proto ключи секций прототипа, в порядке документа
 * @param {string[]} impl  ключи секций реализации (УЖЕ после псевдонимов)
 * @param {string[]|null} only сузить до этих имён (из `--sections`)
 * @returns {{sections: string[], onlyProto: string[], onlyImpl: string[], missing: string[]}}
 *   `onlyProto`/`onlyImpl` — что есть лишь у одной стороны (это ОТЧЁТ, а не
 *   ошибка: секцию могли намеренно не переносить). `missing` — имена из
 *   `--sections`, которых нет ни там, ни там: молча их игнорировать нельзя,
 *   опечатка в имени иначе выглядит как «эта секция в порядке».
 */
export function commonSections(proto, impl, only = null) {
  const p = [...new Set(proto.filter(Boolean))];
  const i = new Set(impl.filter(Boolean));
  let sections = p.filter((name) => i.has(name));
  const onlyProto = p.filter((name) => !i.has(name));
  const onlyImpl = [...new Set(impl.filter(Boolean))].filter((name) => !p.includes(name));

  let missing = [];
  if (only) {
    const known = new Set([...p, ...i]);
    missing = only.filter((name) => !known.has(name));
    sections = sections.filter((name) => only.includes(name));
  }
  return { sections, onlyProto, onlyImpl, missing };
}
