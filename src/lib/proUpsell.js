// @ts-check
/**
 * Копия Pro-апселла — МАТРИЦА двух независимых осей.
 *
 * РОЛЬ отвечает на «что этот человек может сделать»: владелец платит и открывает
 * Pro для трипа, участник — нет, его путь это попросить владельца. Роль решает
 * ФУТЕР модалки, и решает жёстко: кнопка оплаты у участника — это счёт, который
 * не откроет ему ничего (платёж привязан к трипу, а не к плательщику).
 *
 * ИСТОЧНИК отвечает на «что человек спрашивает в эту секунду»: из меню он
 * спрашивает «что такое Pro», после клика в закрытую функцию — «почему это
 * закрыто». Один и тот же ответ на два разных вопроса читается как отписка.
 *
 * Оси независимы, поэтому комбинаций ЧЕТЫРЕ, а не две. До TRIP-XXX они были
 * сплющены в один проп `mode` ('upgrade' | 'info'), который кодировал РОЛЬ, а
 * источник не кодировал вовсе — и решение о режиме принималось в каждом
 * вызывателе по-своему: SettingsLens считал роль сам, TripView всегда слал
 * 'info'. Здесь предикат ОДИН, а вызыватель сообщает только факты.
 *
 * Чистый модуль без JSX и без alias-импортов: его покрывает `node --test`,
 * который alias `@/` не резолвит.
 */

/** @typedef {'owner'|'member'} ProRole */
/** @typedef {'menu'|'feature'} ProSource */

export const PRO_ROLES = /** @type {const} */ (['owner', 'member']);
export const PRO_SOURCES = /** @type {const} */ (['menu', 'feature']);

/**
 * Что показывает футер. Развилка ОДНА и зависит ТОЛЬКО от роли: участник не
 * получает кнопку оплаты ни из какого источника.
 *
 * Таблицей, а не сравнением роли со строкой: право сюда ПРИХОДИТ уже посчитанным
 * по лестнице доступа (`clearsStep(myStep, 'owner')` у вызывателей), и вторая
 * запись роли строкой развела бы два источника истины. Неизвестная роль падает
 * в 'ask-owner' — сторона без кнопки оплаты.
 * @type {Record<ProRole, 'upgrade'|'ask-owner'>}
 */
const FOOTER = { owner: 'upgrade', member: 'ask-owner' };

/**
 * @param {ProRole} role
 * @returns {'upgrade'|'ask-owner'}
 */
export function proUpsellFooter(role) {
  return FOOTER[role] || FOOTER.member;
}

/** Таблица копии по роли; `named` берётся, когда известно имя функции. */
const COPY = {
  owner: { named: 'sub.locked_feature_named', plain: 'sub.locked_heading', desc: 'locked' },
  member: { named: 'sub.trip_pro_feature_named', plain: 'sub.trip_pro_heading', desc: 'owner-note' },
};

/**
 * Заголовок и тип описания для комбинации.
 *
 * `desc` — не ключ, а ВИД описания: у участника оно составное (текст + имя
 * владельца + текст), у владельца — цельная строка. Возвращать «ключ» там, где
 * рендер разный, значило бы врать вызывателю.
 *
 * ⚠️ Тексты под источник `menu` ещё не разведены: обе колонки ведут на копию,
 * написанную под клик в закрытую функцию. Это ЗАГЛУШКА, а не решение — Pavel
 * пишет тексты отдельно, и тогда меняются ровно значения в этой таблице.
 *
 * @param {{ role: ProRole, source: ProSource, feature?: string }} p
 * @returns {{ titleKey: string, titleParams?: { feature: string }, desc: 'locked'|'owner-note' }}
 */
export function proUpsellCopy({ role, source, feature }) {
  const named = !!feature;
  const row = COPY[role] || COPY.member;
  return {
    titleKey: named ? row.named : row.plain,
    titleParams: named ? { feature } : undefined,
    desc: /** @type {'locked'|'owner-note'} */ (row.desc),
  };
}

/**
 * Роль из флага владельца — чтобы вызыватели не писали тернарник каждый свой.
 * @param {boolean} isOwner
 * @returns {ProRole}
 */
export function proRole(isOwner) {
  return isOwner ? 'owner' : 'member';
}
