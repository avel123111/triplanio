// @ts-check
/**
 * ★ ЧЕРНОВИК ПЛАНИРОВЩИКА — ЗАПИСЬ С ИДЕНТИФИКАТОРОМ, А НЕ СЛОТ.
 *
 * До этого черновик был ОДНИМ слотом на дверь (ключ включал `manual`/`ai`), и из
 * этого следовало всё плохое: «создать новое» физически некуда было положить —
 * планировщик писал в тот же слот и затирал начатое. Прикрыть это диалогом
 * «продолжить или заново» не вышло: у диалога нет честного ответа на вопрос
 * «какой из них», и он не покрывал вход по прямому адресу (дверью тот не
 * является, а перезагрузка от него неотличима).
 *
 * Теперь у черновика есть ИМЯ (`draftId`), а адрес говорит, какой именно правят:
 *
 *   `/new-trip`              → имени нет → планировщик заводит новое → чистый экран;
 *   `/new-trip?draft=<id>`   → правится ровно этот;
 *   F5 и «назад»             → имя в адресе, тот же черновик;
 *   удаление                 → сносится одно имя, соседние целы.
 *
 * Спрашивать стало не о чем: ни один вход ничего не перезаписывает, поэтому
 * «дверь забыли покрыть» перестало быть возможным по построению — включая двери,
 * которых ещё нет.
 *
 * ⚠️ ХРАНИЛИЩЕ — `sessionStorage`, И ЭТО ОСОЗНАННО. Черновик живёт вкладку:
 * закрыл — нет ни черновика, ни карточки. Решение Pavel (06.09.2026): переезд на
 * `localStorage` тянет за собой срок годности и разбор мультивкладки, а этого
 * ещё не решали. Идентификатор срока жизни не меняет.
 *
 * ⚠️ ДАТ У КАРТОЧКИ НЕТ, И ЭТО ТОЖЕ РЕШЕНИЕ. Узлы визарда несут `startDate` +
 * `nights`, а карточка трипа считает диапазон по `start_date`/`end_date`
 * (`trip-dates.js`). Переходник между формами — второй источник правды по
 * датам: он разъедется с визардом молча.
 */

/** Общее начало ключей одного человека — по нему же идёт перечисление. */
export const draftKeyPrefix = (userId) => `triplanio-planner-v4-${userId || 'guest'}-`;

/**
 * Ключ конкретного черновика.
 *
 * Версия `v4` — форма ключа сменилась (метод уехал из ключа в ПОЛЕ записи, имя
 * пришло на его место). Ключ ПОДНИМАЕТСЯ, а не мигрируется: черновик живёт
 * вкладку, и мапперу старой формы пришлось бы жить вечно ради вкладки,
 * открытой в обед.
 * @param {string | null | undefined} userId
 * @param {string} draftId
 * @returns {string}
 */
export const draftStorageKey = (userId, draftId) => `${draftKeyPrefix(userId)}${draftId}`;

/**
 * У записи есть СОДЕРЖИМОЕ.
 *
 * ⚠️ САМ ФАКТ ЗАПИСИ ЭТОГО НЕ ЗНАЧИТ: планировщик пишет черновик на КАЖДЫЙ заход,
 * включая пустой (`{step:'home', nodes:[]}`). Предикат по факту записи красил бы
 * «возврат к черновику» почти всегда — на этом уже обожглись на метрике
 * `resumed` (TRIP-520). Работа — это узлы маршрута либо переписка с ботом
 * (`> 1`: индекс 0 всегда засеянное приветствие); дверь берётся из ПОЛЯ записи.
 *
 * @param {{ nodes?: any[], aiMessages?: any[], method?: string } | null | undefined} saved
 * @returns {boolean}
 */
export function draftHasWork(saved) {
  if (!saved) return false;
  if (Array.isArray(saved.nodes) && saved.nodes.length > 0) return true;
  return saved.method === 'ai' && (saved.aiMessages?.length ?? 0) > 1;
}

/**
 * Запись хранилища → форма карточки.
 *
 * Города и страны НЕ считаются здесь: их считает та же пара хелперов, что у
 * настоящей карточки (`uniqueTransitCities` / `uniqueCountryCodes` по `nodes`),
 * иначе список городов у черновика разошёлся бы с правилами живых карточек.
 * Наружу едут сами `nodes`, а не готовые строки.
 *
 * Шага здесь нет намеренно: «Продолжить» называет ЧЕРНОВИК, а куда поставить
 * человека внутри него — решает восстановление в самом планировщике (оно же
 * пишет шаг в адрес). Понесла бы шаг и карточка — у решения «где мы в маршруте»
 * появился бы второй автор.
 *
 * @param {any} saved
 * @param {string} id
 * @returns {{ id: string, method: 'manual' | 'ai', title: string, savedAt: number,
 *             cover_image_url: string, nodes: any[] } | null}
 */
export function draftToCard(saved, id) {
  if (!id || !draftHasWork(saved)) return null;
  return {
    id,
    method: saved.method === 'ai' ? 'ai' : 'manual',
    title: String(saved.tripTitle || '').trim(),
    savedAt: Number(saved.savedAt) || 0,
    cover_image_url: saved.cover?.cover_image_url || '',
    nodes: Array.isArray(saved.nodes) ? saved.nodes : [],
  };
}

/**
 * ДВЕРЬ ЧЕРНОВИКА — СВОЙСТВО ЗАПИСИ, А НЕ МАРШРУТА, ПО КОТОРОМУ ПРИШЛИ.
 *
 * Маппинг «дверь → адрес» живёт здесь, потому что читателей трое (карточка
 * черновика, выбор способа создания и разбор несовпадения в самом визарде), а
 * три копии одного соответствия расходятся молча.
 *
 * ⚠️ ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. `method` визард берёт ТОЛЬКО из маршрута, а в
 * запись кладёт как своё поле. Значит `/new-trip?draft=<id-черновика-ИИ>`
 * восстановил бы всё, КРОМЕ переписки (она под гейтом `isAi`), и следующая же
 * запись сохранила бы `aiMessages: []` — переписка уничтожена беззвучно, и
 * восстанавливать нечего. Пока дверь сидела в ключе хранилища, такое было
 * невозможно по построению; с приходом имени ключ про дверь знать перестал, и
 * инвариант «запись правит только СВОЯ дверь» пришлось держать явно.
 *
 * @param {string | undefined} method
 * @returns {string}
 */
export const draftPath = (method) => (method === 'ai' ? '/plan-trip-ai' : '/new-trip');

/**
 * Адрес, по которому черновик правится: его дверь + его имя.
 * @param {string} draftId
 * @param {string | undefined} method
 * @returns {string}
 */
export const draftHref = (draftId, method) =>
  `${draftPath(method)}?draft=${encodeURIComponent(draftId)}`;

/**
 * Запись открыта ЧУЖОЙ дверью — восстанавливать и, главное, ПИСАТЬ поверх нельзя.
 * Сравнение идёт по нормализованной двери (`draftToCard` читает мусор как
 * ручную), иначе запись без поля `method` считалась бы чужой для обеих дверей.
 * @param {any} saved
 * @param {string} routeMethod
 * @returns {boolean}
 */
export function draftDoorMismatch(saved, routeMethod) {
  if (!saved) return false;
  const own = saved.method === 'ai' ? 'ai' : 'manual';
  return own !== (routeMethod === 'ai' ? 'ai' : 'manual');
}

/**
 * Разобрать сырую строку хранилища. Битый JSON = черновика нет: запись пишет
 * только наш же планировщик, поэтому «не разобралось» значит «мусор», а не отказ.
 * @param {string | null | undefined} raw
 * @returns {any}
 */
export function parseDraft(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Переданное хранилище (тесты) либо `sessionStorage`, если он вообще доступен.
 * @param {Storage} [storage]
 * @returns {Storage | null}
 */
function safeStorage(storage) {
  if (storage) return storage;
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/**
 * Все непустые черновики человека, СВЕЖИЕ СВЕРХУ.
 *
 * Перечисление идёт по ключам хранилища, а не по отдельному индексу: индекс был
 * бы вторым источником правды и расходился бы с записями молча (запись есть,
 * в индексе нет — черновик невидим). Порядок ключей у хранилища не определён,
 * поэтому сортируем по `savedAt` — иначе карточки прыгали бы местами.
 *
 * @param {string | null | undefined} userId
 * @param {Storage} [storage]
 * @returns {NonNullable<ReturnType<typeof draftToCard>>[]}
 */
export function readDrafts(userId, storage) {
  const st = safeStorage(storage);
  if (!st) return [];
  const prefix = draftKeyPrefix(userId);
  const out = [];
  try {
    for (let i = 0; i < st.length; i++) {
      const key = st.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const card = draftToCard(parseDraft(st.getItem(key)), key.slice(prefix.length));
      if (card) out.push(card);
    }
  } catch { return out; }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Стереть один черновик. Соседние не трогаются — в этом весь смысл имени.
 * @param {string | null | undefined} userId
 * @param {string} draftId
 * @param {Storage} [storage]
 */
export function removeDraft(userId, draftId, storage) {
  const st = safeStorage(storage);
  if (!st || !draftId) return;
  try { st.removeItem(draftStorageKey(userId, draftId)); } catch { /* ignore */ }
}
