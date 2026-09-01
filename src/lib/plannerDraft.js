// @ts-check
// Черновик планировщика: где он лежит, когда протухает и как переезжает от
// гостя к вошедшему (TRIP-505).
//
// ── ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ ───────────────────────────────────────────────────
// Правила ниже жили тремя строчками внутри `ManualPlanner` — ключ хранилища,
// чтение на монтировании и запись на каждое изменение. Пока черновик жил минуты
// в рамках одной вкладки, этого хватало. С гостевым входом он обязан пережить
// уход на регистрацию и возврат, то есть у него появились ДВА правила, каждое
// из которых ломается молча:
//   · протух он или нет — иначе человек, вернувшийся через неделю, получит
//     чужой на ощущение маршрут и не поймёт, откуда он;
//   · переехал ли он с ключа гостя на ключ вошедшего — иначе человек
//     зарегистрировался, вернулся, и его маршрута нет.
// Ни то, ни другое не видно ни глазами, ни гардом: обе стороны валидны сами по
// себе. Поэтому решение — чистая функция с тестом, а чтение хранилища — тонкая
// оболочка вокруг неё. Тот же ход, что у `postLoginPath.js`, `campaign.js` и
// `create/routeModel.js`.
//
// ── ЧТО ХРАНИМ И ГДЕ ─────────────────────────────────────────────────────────
// `localStorage`, а не `sessionStorage`, и это ОДНО правило на всех — гостя и
// вошедшего. Причина в границе, которую черновик обязан пересечь: регистрация
// по почте открывается по ссылке из письма, то есть в НОВОЙ ВКЛАДКЕ, а
// `sessionStorage` живёт вкладкой и туда не виден. Держать два хранилища ради
// двух ролей значило бы завести два источника правды в одном компоненте.
// Побочное следствие для вошедшего — черновик переживает случайное закрытие
// вкладки; это улучшение, и оно осознанное, а не побочное.
//
// Письмо, открытое на ДРУГОМ УСТРОЙСТВЕ, черновик не переживает. Принято
// осознанно: носитель через `auth.user_metadata` (как у меток кампании,
// TRIP-335) закрыл бы и эту границу, но стоит отдельной работы, а вход через
// Google — самый частый — от неё не страдает.

/**
 * Сколько живёт черновик. Флоу — одна посадка плюс, может, возврат тем же
 * вечером; дальше восстановленный полумаршрут только путает.
 */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/** Владелец черновика, пока человек не вошёл. */
export const GUEST_ID = 'guest';

/**
 * Ключ хранилища.
 *
 * `-v4-`: контракт сменился дважды сразу — хранилище (`session` → `local`) и
 * форма (появилась метка времени). Ключ поднимается, а не мигрируется: старый
 * черновик лежит в другом хранилище, читать его больше некому, и мапперу
 * пришлось бы пережить обе формы ради вкладки, открытой в обед.
 *
 * Ключ по МЕТОДУ тоже: ручной и AI-черновики не должны затекать друг в друга —
 * один и тот же компонент обслуживает оба маршрута.
 *
 * @param {string|null|undefined} userId
 * @param {string} [method]
 * @returns {string}
 */
export function draftKey(userId, method = 'manual') {
  return `triplanio-planner-v4-${method}-${userId || GUEST_ID}`;
}

/**
 * Разобрать то, что лежит в хранилище.
 *
 * ЛЮБОЙ отказ — это `null`, а не исключение: значение приходит из хранилища,
 * до которого дотягивается посторонний, и мусор там — данные, а не крах.
 * Отсутствующая метка времени считается протухшей: черновик без неё пришёл из
 * формы, которой больше нет, и «раз метки нет, значит свежий» — ровно та
 * ошибка, из-за которой протухшее выглядит как новое.
 *
 * @param {string|null|undefined} raw
 * @param {number} now Date.now()
 * @returns {{ draft: Record<string, any>, handoff: boolean } | null}
 */
export function parseDraft(raw, now) {
  if (typeof raw !== 'string' || !raw) return null;

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const { ts, handoff, ...draft } = /** @type {Record<string, any>} */ (parsed);
  if (!Number.isFinite(ts) || now - ts > DRAFT_TTL_MS) return null;
  // Часы уехали назад (сменили таймзону, поправили время) — черновик из
  // будущего не протух, он просто странный. Отдаём: выбросить работу человека
  // из-за перевода часов хуже, чем показать её.
  return { draft, handoff: handoff === true };
}

/**
 * Свернуть черновик в строку для хранилища.
 * @param {Record<string, any>} draft
 * @param {number} now
 * @param {boolean} [handoff] см. `takeHandoff`
 * @returns {string}
 */
export function serializeDraft(draft, now, handoff = false) {
  return JSON.stringify(handoff ? { ...draft, ts: now, handoff: true } : { ...draft, ts: now });
}

// ─── Оболочка над хранилищем ─────────────────────────────────────────────────
// Всё ниже — четыре строки вокруг чистых функций выше. Приватный режим и
// отключённое хранилище бросают на КАЖДОМ обращении, поэтому `try` стоит у
// каждого: черновик — удобство, и его отказ не имеет права ронять экран.

/** @param {string} key @returns {string|null} */
function get(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
/** @param {string} key @param {string} value */
function set(key, value) {
  try { localStorage.setItem(key, value); } catch { /* приватный режим — черновика не будет */ }
}
/** @param {string} key */
function del(key) {
  try { localStorage.removeItem(key); } catch { /* нечего убирать */ }
}

/**
 * Черновик этого владельца, если он есть и не протух.
 * @param {string|null|undefined} userId
 * @param {string} method
 * @param {number} now
 * @returns {Record<string, any> | null}
 */
export function readDraft(userId, method, now) {
  return parseDraft(get(draftKey(userId, method)), now)?.draft ?? null;
}

/**
 * @param {string|null|undefined} userId
 * @param {string} method
 * @param {Record<string, any>} draft
 * @param {number} now
 */
export function writeDraft(userId, method, draft, now) {
  set(draftKey(userId, method), serializeDraft(draft, now));
}

/**
 * @param {string|null|undefined} userId
 * @param {string} method
 */
export function clearDraft(userId, method) {
  del(draftKey(userId, method));
}

/**
 * Пометить гостевой черновик как ПЕРЕДАВАЕМЫЙ: человек нажал «Сохранить трип» и
 * уходит регистрироваться.
 *
 * ★ ЗАЧЕМ МЕТКА, А НЕ ПРОСТО «ЕСТЬ ГОСТЕВОЙ ЧЕРНОВИК — ЗАБРАТЬ ЕГО». Без неё
 * переезд срабатывал бы при КАЖДОМ открытии планировщика вошедшим, и брошенный
 * кем-то гостевой маршрут (общий компьютер, своя же прошлая сессия) молча
 * подставился бы человеку, который его не составлял. Метка ставится ровно в
 * одной точке — в момент осознанного ухода на регистрацию — и тратится при
 * получении.
 *
 * @param {string} method
 * @param {Record<string, any>} draft
 * @param {number} now
 */
export function markHandoff(method, draft, now) {
  set(draftKey(GUEST_ID, method), serializeDraft(draft, now, true));
}

/**
 * Забрать переданный гостевой черновик себе: прочитать, переписать под своим
 * ключом, гостевой снести.
 *
 * Возвращает черновик, если переезд состоялся, иначе `null` — вызывающий по
 * этому понимает, надо ли перерисоваться. Идемпотентна: гостевой ключ снесён,
 * поэтому повтор (StrictMode, перемонтирование) ничего не делает.
 *
 * ★ ПЕРЕДАННЫЙ ЧЕРНОВИК ПОБЕЖДАЕТ свой прежний, если он был: это тот маршрут,
 * который человек только что составил и пришёл дописывать, а под его ключом
 * могла лежать заброшенная вчера попытка.
 *
 * @param {string} userId ОБЯЗАТЕЛЕН и не `guest` — переезжать иначе некуда
 * @param {string} method
 * @param {number} now
 * @returns {Record<string, any> | null}
 */
export function takeHandoff(userId, method, now) {
  if (!userId || userId === GUEST_ID) return null;

  const guestKey = draftKey(GUEST_ID, method);
  const parsed = parseDraft(get(guestKey), now);
  // Гостевой черновик БЕЗ метки не забираем, но и не трогаем: он мог остаться
  // от человека, который просто не дошёл до конца, и это его работа.
  if (!parsed?.handoff) return null;

  writeDraft(userId, method, parsed.draft, now);
  del(guestKey);
  return parsed.draft;
}
