// Реестр секций трипа — ЕДИНСТВЕННЫЙ список того, из чего состоит экран трипа.
//
// До TRIP-349 этот список был объявлен ШЕСТЬ раз врозь: здесь (LENS_ITEMS +
// MGMT_ITEMS), массивом `lensIds` внутри бриджа `window.__navigate`, картой
// `SECTION_OPEN_EVENT` для аналитики, switch'ом рендера в TripView, зашитыми
// id в мобильном доке и регуляркой роута в App.jsx. Добавить секцию значило не
// забыть шесть мест, а разъехаться они могли молча — ни один гард не связывает
// пункт меню с веткой рендера.
//
// Отсюда выводятся: сайдбар, телефонный шит, мобильный док, белый список
// значений `?lens=`, событие аналитики и флаг раскладки `flush`. Рендер каждой
// секции остаётся у экрана — реестр это ДАННЫЕ, а не диспетчер компонентов:
// иначе он потянул бы за собой импорт всех линз и стал бы вторым App.jsx.
// Импорт ОТНОСИТЕЛЬНЫЙ, не через alias `@/`: реестр покрыт тестом на чистых
// функциях, а `node --test` алиас не резолвит (тот же приём, что в resolveAuthor).
import { clearsStep } from './tripStep.js';

// Поля секции:
//   id        — значение `?lens=`; `overview` в адрес не пишется (дефолт)
//   group     — 'lens' (разделы трипа) | 'manage' (управление)
//   addon     — секция видна, только если аддон трипа включён явно
//   canAccess — гейт по СТУПЕНИ доступа; ступень приезжает готовой из ответа
//               read-двери (`getTripDetails.myStep`), сравнивается `clearsStep`.
//               Принимает step ('owner'|'editor'|'participant'|null)
//   event     — имя события аналитики при открытии (TRIP-213 Ф2c)
//   flush     — секция сама владеет своим скроллом: тело без паддинга и без
//               скролла (`.trip-screen-body--flush`), поверхность в край
//   hidesDock — на секции не показывается плавающий мобильный док. Значение —
//               ПРИЧИНА, а не просто true: причины разные, и следующий, кто
//               придёт возвращать док, должен видеть, какую из них он закрывает.
//                 'composer'       — нижнюю кромку забрал композер чата
//                 'pending-layout' — раскладка под док ещё не сделана
//                                    (TRIP-349 п.2 отложен намеренно)
export const SECTIONS = [
  { id: 'overview', group: 'lens', labelKey: 'trip_menu.overview', icon: 'grid', event: 'overview_opened' },
  { id: 'timeline', group: 'lens', labelKey: 'trip_menu.timeline', icon: 'list', event: 'timeline_opened' },
  { id: 'map', group: 'lens', labelKey: 'trip_menu.map', icon: 'map', event: 'map_opened', flush: true },
  { id: 'calendar', group: 'lens', labelKey: 'trip_menu.calendar', icon: 'calendar', event: 'calendar_opened' },
  { id: 'budget', group: 'lens', labelKey: 'trip.sidebar_budget', icon: 'wallet', event: 'budget_opened', addon: 'budget' },
  { id: 'docs', group: 'lens', labelKey: 'trip_menu.documents', icon: 'file', event: 'documents_opened' },
  { id: 'chat', group: 'lens', labelKey: 'trip_menu.chat', icon: 'chat', event: 'chat_opened', addon: 'chat', flush: true, hidesDock: 'composer' },
  // Структурный редактор. Секция как любая другая — до TRIP-349 это был
  // отдельный роут со СВОЕЙ оболочкой, и именно из этого дубля выросло всё
  // остальное. Гейт тот же, что пускал в роут (зеркалит _can_edit_trip).
  { id: 'edit', group: 'manage', labelKey: 'trip.edit_structure', icon: 'edit', event: 'trip_editor_opened', canAccess: (step) => clearsStep(step, 'editor'), flush: true, hidesDock: 'pending-layout' },
  // Наблюдатель видит Настройки (read-only — чтобы выйти из трипа), но не
  // Участников (TRIP-137). Управление участниками — ступень editor.
  { id: 'members', group: 'manage', labelKey: 'trip.sidebar_members', icon: 'users', event: 'members_opened', canAccess: (step) => clearsStep(step, 'editor') },
  { id: 'settings', group: 'manage', labelKey: 'nav.settings', icon: 'settings', event: 'settings_opened' },
];

// Дефолт в адрес НЕ пишется: `?lens=overview` и голый `/trip/:id` — один экран,
// и второй его орфографии быть не должно.
export const DEFAULT_SECTION = 'overview';

// Пункты мобильного дока по СТОРОНАМ от центральной кнопки «+». Стороны
// названы структурно, а не нарезаны индексами из плоского списка: «+» физически
// стоит между ними, и арифметика вроде slice(0,2)/slice(2) молча разъезжается,
// стоит добавить четвёртый пункт.
//
// Сам состав НАЗВАН явно, а не выведен как «первые три секции»: это продуктовый
// выбор (Обзор · Хронология · Календарь), а вывод «первые три» дал бы Карту
// вместо Календаря. Реестр снимает дубль подписей и иконок, но не отнимает
// решение. Пункты дока не могут быть гейтованными - у дока нет ни трипа, ни
// роли, чтобы это проверить (пинится тестом).
export const DOCK_SECTIONS = { left: ['overview', 'timeline'], right: ['calendar'] };
export const DOCK_SECTION_IDS = [...DOCK_SECTIONS.left, ...DOCK_SECTIONS.right];

const BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

export function sectionById(id) {
  return BY_ID.get(id) || null;
}

// Доступна ли секция В ЭТОМ трипе ЭТОЙ роли. Незнакомый id недоступен всегда —
// именно это чинит `?lens=` с опечаткой (см. resolveSection).
export function isSectionAvailable(id, trip, myStep) {
  const s = BY_ID.get(id);
  if (!s) return false;
  if (s.addon && trip?.details?.addons?.[s.addon] !== true) return false;
  if (s.canAccess && !s.canAccess(myStep)) return false;
  return true;
}

// Секции группы, доступные в этом трипе этой ступени, В ПОРЯДКЕ РЕЕСТРА.
export function availableSections(trip, myStep, group = null) {
  return SECTIONS.filter((s) => (group === null || s.group === group) && isSectionAvailable(s.id, trip, myStep));
}

// Что реально показать по значению из адреса. Недоступная секция (выключенный
// аддон, роль без права) и НЕСУЩЕСТВУЮЩАЯ (`?lens=опечатка`) одинаково падают
// на дефолт. До реестра незнакомый id проходил гейт насквозь и не совпадал ни с
// одной веткой рендера — экран оставался ПУСТЫМ.
export function resolveSection(id, trip, myStep) {
  return isSectionAvailable(id, trip, myStep) ? id : DEFAULT_SECTION;
}

