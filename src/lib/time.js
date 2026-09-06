// @ts-check
import { parseNaive } from './naive-time.js';

/**
 * The trip data model treats every stored ISO datetime as a NAIVE wall-clock
 * value. Reading and writing a single moment ignores timezones on purpose:
 *
 *   - User types "24 May 13:00" in a form  → stored as "2026-05-24T13:00:00.000Z"
 *   - Stored "2026-05-24T13:00:00.000Z"    → displayed as "24 May 13:00"
 *
 * The `ianaTz` argument is kept on the formatters below for backward
 * compatibility with existing call sites but is **ignored**: what a single
 * timestamp SHOWS is the wall clock that was typed, and re-interpreting it
 * through a zone would shift the digits the user entered.
 *
 * ★ НО РАССТОЯНИЕ МЕЖДУ ДВУМЯ ТАКИМИ ЗНАЧЕНИЯМИ — ДРУГОЕ ДЕЛО. Они
 * настенные в РАЗНЫХ городах, то есть на разных шкалах, и вычитать их напрямую
 * нельзя — см. `durationMinutes` внизу файла. Именно чтение этой шапки как
 * «пояса тут не нужны вообще» и рождало очередную наивную копию длительности.
 */

// Convert datetime-local string ("yyyy-MM-dd'T'HH:mm") → ISO with trailing Z,
// preserving wall-clock digits (no UTC offset math).
export function localToUtc(localDateTime, _ianaTz) {
  if (!localDateTime) return null;
  // Normalise to "yyyy-MM-ddTHH:mm:00.000Z" - strip any tz suffix the input
  // might already carry, default seconds/ms to zero.
  const stripped = localDateTime.replace(/(Z|[+-]\d{2}:?\d{2})$/i, '');
  // Accept "yyyy-MM-ddTHH:mm" or "yyyy-MM-ddTHH:mm:ss"
  const m = stripped.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, date, hh, mm, ss] = m;
  return `${date}T${hh}:${mm}:${ss || '00'}.000Z`;
}

// Convert stored ISO → datetime-local string ("yyyy-MM-dd'T'HH:mm"),
// reading the value as naive wall-clock (ignores any tz suffix).
export function utcToLocalInput(utcIso, _ianaTz) {
  const dt = parseNaive(utcIso);
  return dt ? dt.toFormat("yyyy-LL-dd'T'HH:mm") : '';
}

/**
 * СКОЛЬКО ДЛИТСЯ ПЛЕЧО — ОДНО МЕСТО НА ВСЕ ПОВЕРХНОСТИ.
 *
 * ★ ПОЧЕМУ ЭТО ОБЯЗАНО БЫТЬ ОДНОЙ ФУНКЦИЕЙ. Хранение наивное (см. шапку файла):
 * `start_datetime` — настенное время ГОРОДА ОТПРАВЛЕНИЯ, `end_datetime` —
 * настенное время ГОРОДА ПРИБЫТИЯ. Поэтому самая естественная операция над
 * этими двумя значениями — вычесть одно из другого — даёт верный ответ везде,
 * КРОМЕ межпоясного переезда, а там врёт ровно на разницу смещений. Порту 16:05
 * → Мадрид 18:15 это 1 ч 10 мин, а не 2 ч 10 мин.
 *
 * ⚠️ ЦЕНОЙ БЫЛА НЕ ПОДПИСЬ, А ЧИСЛО НА ЭКРАНЕ. Правило чинили дважды (TRIP-106
 * и раньше) — и оба раза чинили ВЫЗЫВАЮЩЕГО, а не правило. К моменту третьей
 * поимки арифметика жила пятью копиями: две учитывали пояса, три — нет, и
 * редизайн панели трансфера (TRIP-176) написал свою с нуля, выровнявшись
 * комментарием по НЕПРАВИЛЬНОЙ копии. Ошибка невидима: «2 ч 10 мин» на рейсе
 * выглядит правдоподобно, тестов на неё не было, гарды считают классы, а не
 * арифметику — то есть регресс выглядел зелёным.
 *
 * Поэтому у длительности один дом, и он здесь: `durationMinutes` знает про
 * пояса, `formatMinutes` — про подпись, `transferDuration` — про то, ОТКУДА у
 * переезда берутся пояса (из его же city_visit-концов), чтобы вызывающему
 * нечего было забыть. Периметр держит гард 2ag `check-time-arithmetic.mjs`:
 * минутной/часовой арифметики над датами вне этого файла быть не может.
 *
 * Оба конца поясов нужны ОДНОВРЕМЕННО: знать один — то же самое, что не знать
 * ни одного, поэтому при любом пропуске честно падаем в наивную разность (она
 * верна для события внутри города и для неизвестного пояса — выдумывать смещение
 * хуже, чем показать настенную).
 *
 * @param {string|null|undefined} startIso настенное начало (пояс `fromTz`)
 * @param {string|null|undefined} endIso   настенный конец (пояс `toTz`)
 * @param {string|null} [fromTz] IANA-пояс города отправления (`CityVisit.timezone`)
 * @param {string|null} [toTz]   IANA-пояс города прибытия
 * @returns {number|null} минут, либо null — не разобрали / не положительно
 */
export function durationMinutes(startIso, endIso, fromTz, toTz) {
  let start = parseNaive(startIso);
  let end = parseNaive(endIso);
  if (!start || !end) return null;
  // Пояса решают ровно одно: на КАКОЙ шкале стоит каждый конец. Само вычитание
  // после этого одно на оба случая — и на межпоясной переезд, и на всё
  // остальное; двумя способами написанное, оно и расходилось.
  if (fromTz && toTz && fromTz !== toTz) {
    const dep = start.setZone(fromTz, { keepLocalTime: true });
    const arr = end.setZone(toTz, { keepLocalTime: true });
    if (dep.isValid && arr.isValid) { start = dep; end = arr; }
  }
  const mins = Math.round(end.diff(start, 'minutes').minutes);
  return mins > 0 ? mins : null;
}

/**
 * Подпись длительности («2ч 10м»). ОДНА семья ключей на все поверхности.
 *
 * Семей было две (`trip.dur_*` компактная и `event.dur_*` с пробелами) — и это
 * была не разница дизайна, а тот же дубль: в `es` обе давали БАЙТ В БАЙТ одну
 * строку, расходились только ru/en. Выжила компактная, потому что три из четырёх
 * мест тесные: в ленте на 390px полная форма переносит «мин» на вторую строку
 * («3 ч 55 / мин»), а в колонку панели (76px) обе влезают с запасом (69px против
 * 45px). Итог — лента и публичный трип не меняются вовсе.
 *
 * @param {number|null} mins из `durationMinutes`
 * @param {(k: string, v?: any) => string} t
 * @returns {string|null} null, если показывать нечего (вызывающий рисует по `&&`)
 */
export function formatMinutes(mins, t) {
  if (mins == null || mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return t('trip.dur_m', { m });
  if (m === 0) return t('trip.dur_h', { h });
  return t('trip.dur_hm', { h, m });
}

/**
 * Длительность ПЕРЕЕЗДА — дверь для всех его поверхностей (лента, панель,
 * публичный трип). Пояса берёт сама из концов переезда, поэтому вызывающему
 * нечего забыть: именно ручное `visits.find(...)?.timezone` у каждого экрана и
 * было тем, что забывали.
 *
 * @param {{ start_datetime?: string|null, end_datetime?: string|null }|null|undefined} transfer
 * @param {{ timezone?: string|null }|null|undefined} fromVisit city_visit отправления
 * @param {{ timezone?: string|null }|null|undefined} toVisit   city_visit прибытия
 * @param {(k: string, v?: any) => string} t
 */
export function transferDuration(transfer, fromVisit, toVisit, t) {
  return formatMinutes(
    durationMinutes(transfer?.start_datetime, transfer?.end_datetime, fromVisit?.timezone, toVisit?.timezone),
    t,
  );
}
