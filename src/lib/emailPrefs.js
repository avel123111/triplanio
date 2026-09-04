// Раскладка настроек почтовых рассылок (TRIP-512).
//
// Состояние подписки хранит Resend; сюда приезжает его ответ, и вся чистая
// логика экрана живёт здесь, чтобы её можно было проверить тестом, а не глазами.
//
// ПОЧЕМУ ПОДПИСИ НАШИ, А НЕ ИЗ ОТВЕТА. Resend отдаёт у топика `name`, но это
// одна английская строка из дашборда, а у нас три языка (правило #4). Поэтому
// имя берётся из локали ПО ID топика: id неизменяем, а `name` в дашборде правят
// когда угодно. Топик, которого нет в карте (завели новый и ещё не перевели),
// не пропадает с экрана — показывается его `name` из ответа.
//
// ПОЧЕМУ ПОРЯДОК НАШ. Resend возвращает топики в порядке создания, то есть по
// случайности. На экране порядок смысловой: от того, что человеку нужнее.

/** id топика в Resend → ключ локали. Порядок ключей = порядок на экране. */
export const TOPIC_KEYS = {
  '1a09227c-00fb-486b-b3bf-7e8e95b2ee1c': 'email_prefs.trip_reminders',
  'ef683f1f-ee74-4f98-a7a4-90d8283c0488': 'email_prefs.trip_updates',
  '401d88f5-ffc8-484d-a975-540f7a7835ea': 'email_prefs.product_updates',
  '7ab86082-c2ce-4c31-af0a-aa1c75ef0de9': 'email_prefs.marketing',
};

const ORDER = Object.keys(TOPIC_KEYS);

/**
 * Строки экрана из ответа сервера: известные топики в нашем порядке, остальные —
 * следом, в том порядке, в каком их прислали.
 * @param {Array<{id:string,name?:string,subscription?:string}>} topics
 * @returns {Array<{id:string,i18nKey:string|null,name:string,on:boolean}>}
 */
export function buildRows(topics) {
  const list = Array.isArray(topics) ? topics.filter((t) => t && t.id) : [];
  const rank = (id) => {
    const i = ORDER.indexOf(id);
    return i === -1 ? ORDER.length : i;
  };
  // Сортировка стабильна (ES2019), поэтому незнакомые топики сохраняют порядок
  // ответа сами — нести с собой исходный индекс не нужно.
  return list
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((t) => ({
      id: t.id,
      i18nKey: TOPIC_KEYS[t.id] ?? null,
      name: t.name ?? '',
      on: t.subscription !== 'opt_out',
    }));
}

/**
 * Что реально изменилось. Шлём ТОЛЬКО тронутое: отправка всех четырёх строк
 * затирала бы чужую правку, сделанную с другого устройства между загрузкой
 * экрана и нажатием «Сохранить».
 * @param {Array<{id:string,on:boolean}>} initial
 * @param {Array<{id:string,on:boolean}>} current
 * @returns {Array<{id:string,subscription:'opt_in'|'opt_out'}>}
 */
export function changedTopics(initial, current) {
  const was = new Map((initial ?? []).map((r) => [r.id, r.on]));
  return (current ?? [])
    .filter((r) => was.has(r.id) && was.get(r.id) !== r.on)
    .map((r) => ({ id: r.id, subscription: r.on ? 'opt_in' : 'opt_out' }));
}

/**
 * Есть ли что сохранять. Отдельно от `changedTopics`, потому что глобальный
 * флаг — не топик: человек мог тронуть только его.
 */
export function hasChanges(initial, current, wasUnsubscribed, isUnsubscribed) {
  return changedTopics(initial, current).length > 0 || wasUnsubscribed !== isUnsubscribed;
}
