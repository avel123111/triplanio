/**
 * IN-APP СПЕКА события → строка(и) `notifications` (эпик TRIP-374, возврат
 * in-app-записи в edge). Чистая, БЕЗ I/O — под `deno test`; зеркалит по имени
 * события реестр `RESOLVERS` (emitResolvers) и `AFTER_WRITE` (mutateEffects).
 *
 * Одно событие = ОДНА общая строка (тип, ключи текста, не-идентичность-params,
 * ссылки, автор), которую шов `notify` разбрасывает по получателям (`recipients`
 * уже посчитаны резолвером). Событие без in-app-канала (только email, как
 * `invite_resent`) — здесь отсутствует → `null`.
 *
 * ГЛАВНОЕ ПРАВИЛО (почему возврат in-app в edge вообще нужен): в `i18n_params`
 * едет ТОЛЬКО не-идентичность (`trip`, `role_key`). Имя автора НЕ снапшотится —
 * его резолвит чтение из `created_by` (аватар + живое имя, PII-безопасно). Так
 * закрывается утечка «имя вварено в строку и переживает анонимизацию».
 */

// Форма фактов события объявлена ЛОКАЛЬНО и структурно (совпадает с NotifyData из
// emitResolvers). Импортировать NotifyData нельзя: emitResolvers тянет
// `npm:@supabase`, и тогда `deno test` этого чистого спека падает офлайн — тот же
// приём, что у emitResolverRules/memberEffectRules (см. их заголовки).
type Row = Record<string, unknown> | null;
export type NotifyData = {
  trip: Row;
  actor: Row;
  member: Row;
  recipients: Record<string, unknown>[];
  /** Тип брони (`booking_added`): сырой код hotel|transfer|activity|service. */
  kind?: string | null;
};

/** Общая часть строки уведомления для события (без `user_id` — его добавляет
 *  `notify` на каждого получателя, и без `read`, который дефолтит в БД). */
export interface InAppSpec {
  type: string;
  i18n_title_key: string;
  i18n_message_key: string;
  i18n_params: Record<string, unknown>;
  trip_id: string | null;
  trip_member_id: string | null;
  created_by: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const roleKey = (role: unknown): string => (role === 'admin' ? 'notif.role_admin' : 'notif.role_viewer');

/** Per-kind заголовок брони — каждый литерал явен (гард C `check-i18n` их валидирует). */
const BOOKING_TITLE_KEYS: Record<string, string> = {
  hotel: 'notif.tpl_booking_added_title_hotel',
  transfer: 'notif.tpl_booking_added_title_transfer',
  activity: 'notif.tpl_booking_added_title_activity',
  service: 'notif.tpl_booking_added_title_service',
};

const tripId = (d: NotifyData): string | null => str(d.trip?.id);
const tripTitle = (d: NotifyData): string => (typeof d.trip?.title === 'string' ? d.trip.title : '');
const actorId = (d: NotifyData): string | null => str(d.actor?.id);
const memberId = (d: NotifyData): string | null => str(d.member?.id);

/** Строка приглашения (создано / связано при регистрации): тип `trip_invite`,
 *  несёт `trip_member_id` (по нему живёт UI принять/отклонить). Автор = тот, кто
 *  пригласил. */
function inviteSpec(d: NotifyData, createdBy: string | null): InAppSpec {
  return {
    type: 'trip_invite',
    i18n_title_key: 'notif.tpl_invite_title',
    i18n_message_key: 'notif.tpl_invite_msg',
    // role_key — не-идентичность (роль), фронт превратит в текст; inviter (имя)
    // НЕ кладём — резолвится из created_by на чтении.
    i18n_params: { trip: tripTitle(d), role_key: roleKey(d.member?.role) },
    trip_id: tripId(d),
    trip_member_id: memberId(d),
    created_by: createdBy,
  };
}

/** Информационная строка о действии участника (присоединился / отклонил / вышел
 *  / удалён): заголовок с именем автора (резолв на чтении), тело — название трипа. */
function memberEventSpec(
  d: NotifyData,
  type: string,
  titleKey: string,
  messageKey: string,
): InAppSpec {
  return {
    type,
    i18n_title_key: titleKey,
    i18n_message_key: messageKey,
    i18n_params: { trip: tripTitle(d) },
    trip_id: tripId(d),
    trip_member_id: null,
    created_by: actorId(d),
  };
}

/** Системная строка (подписка/оплата): автора-человека нет (created_by null →
 *  без аватара), текст без параметров, вне трипа. */
function systemSpec(type: string, titleKey: string, messageKey: string): InAppSpec {
  return {
    type,
    i18n_title_key: titleKey,
    i18n_message_key: messageKey,
    i18n_params: {},
    trip_id: null,
    trip_member_id: null,
    created_by: null,
  };
}

/**
 * Реестр по имени события. Билдер отдаёт ОБЩУЮ строку (одна на событие) либо
 * `null`, если у события нет in-app-канала. Отсутствие ключа = нет in-app.
 */
export const INAPP: Record<string, (d: NotifyData) => InAppSpec | null> = {
  // Приглашение создано — получатель приглашённый; автор = пригласивший (actor).
  invite_created: (d) => inviteSpec(d, actorId(d)),

  // Регистрация связала pending-инвайт — получатель сам новорег; автор = тот, кто
  // когда-то пригласил (member.invited_by), а не сам новорег (actor тут — он же
  // получатель, для аватара это не он).
  invite_linked: (d) => inviteSpec(d, str(d.member?.invited_by)),

  // Присоединился (accept) — получатель пригласивший; автор = присоединившийся.
  trip_member_joined: (d) =>
    memberEventSpec(d, 'trip_member_joined', 'notif.tpl_joined_title', 'notif.tpl_joined_msg'),

  // Отклонил приглашение — получатель пригласивший; автор = отклонивший.
  trip_invite_declined: (d) =>
    memberEventSpec(d, 'trip_invite_declined', 'notif.tpl_invite_declined_title', 'notif.tpl_invite_declined_msg'),

  // Вышел сам — получатели владелец+админы; автор = ушедший.
  trip_member_left: (d) =>
    memberEventSpec(d, 'trip_member_left', 'notif.tpl_member_left_title', 'notif.tpl_member_left_msg'),

  // Удалён админом — получатель удалённый; заголовок про его доступ (без имени),
  // автор = удаливший админ.
  trip_member_removed: (d) =>
    memberEventSpec(d, 'trip_member_removed', 'notif.tpl_member_removed_title', 'notif.tpl_member_removed_msg'),

  // Роль изменена — получатель участник; тело зависит от НОВОЙ роли; автор = тот,
  // кто сменил.
  trip_role_changed: (d) => ({
    type: 'trip_role_changed',
    i18n_title_key: 'notif.tpl_role_changed_title',
    i18n_message_key: d.member?.role === 'admin'
      ? 'notif.tpl_role_changed_admin_msg'
      : 'notif.tpl_role_changed_viewer_msg',
    i18n_params: { trip: tripTitle(d) },
    trip_id: tripId(d),
    trip_member_id: null,
    created_by: actorId(d),
  }),

  // Подписка — системные строки (см. systemSpec): без автора и без параметров.
  pro_activated: () => systemSpec('pro_activated', 'notif.tpl_pro_activated_title', 'notif.tpl_pro_activated_msg'),
  pro_payment_failed: () => systemSpec('pro_payment_failed', 'notif.tpl_pro_payment_failed_title', 'notif.tpl_pro_payment_failed_msg'),

  // Pro куплен на КОНКРЕТНЫЙ трип. Тоже без автора-человека (покупка, не чьё-то
  // действие → без аватара), но, в отличие от аккаунтной, строка ПРО ТРИП: несёт
  // `trip_id`, из которого рендер сам даёт ссылку «Открыть путешествие»
  // (`showLink` в notifView), и название трипа параметром текста. Поэтому не
  // `systemSpec` — тот по определению вне трипа и без параметров.
  trip_pro_activated: (d) => ({
    type: 'trip_pro_activated',
    i18n_title_key: 'notif.tpl_trip_pro_activated_title',
    i18n_message_key: 'notif.tpl_trip_pro_activated_msg',
    i18n_params: { trip: tripTitle(d) },
    trip_id: tripId(d),
    trip_member_id: null,
    created_by: null,
  }),

  // Бронь добавлена — получатели владелец+участники; автор = добавивший.
  //   • ЗАГОЛОВОК: per-kind ключ (грамматика — реюз booking_kind_* запрещён;
  //     механизм выбора ключа как у trip_role_changed по роли);
  //   • СООБЩЕНИЕ: `tpl_booking_added_msg` («{kind} в «{trip}»»), рендер сам
  //     локализует СЫРОЙ kind через словарь booking_kind_* (notifView.jsx);
  //   • edge шлёт по одной брони → count всегда 1 (batch-ветка референсна ради
  //     живости ключа: шов её не берёт, но и не даёт ключу умереть).
  booking_added: (d) => {
    const kind = str(d.kind) ?? 'hotel';
    const count = 1;
    return {
      type: 'trip_booking_added',
      i18n_title_key: BOOKING_TITLE_KEYS[kind] ?? BOOKING_TITLE_KEYS.hotel,
      i18n_message_key: count > 1 ? 'notif.tpl_booking_added_batch_msg' : 'notif.tpl_booking_added_msg',
      i18n_params: { trip: tripTitle(d), kind, count },
      trip_id: tripId(d),
      trip_member_id: null,
      created_by: actorId(d),
    };
  },

  // invite_resent — только email (в реестре отсутствует намеренно): notify по
  // нему in-app не пишет, внешняя доставка идёт как прежде.
};

/**
 * События с ВНЕШНИМ каналом (email через n8n/Resend). Только для них `notify`
 * шлёт конверт в n8n; всё остальное — edge-only in-app, БЕЗ сетевого хопа (после
 * TRIP-374 in-app пишет edge, а in-app-only ветки в n8n удалены — POST по ним
 * дал бы 404). Сегодня письма шлют ровно два события:
 *   • invite_created — приглашение (письмо приглашённому + in-app);
 *   • invite_resent  — повторная отправка приглашения (только письмо).
 * (welcome-письмо на регистрацию живёт на PG-триггере в n8n, не на этом шве.)
 * Добавится Telegram/новый канал — событие дописывается сюда.
 *   • trip_telegram_unlinked — привязка Telegram снята: прощальное сообщение в
 *     сам чат (external-only, in-app-спеки в INAPP нет намеренно — событие не
 *     проецируется в наш инбокс, адресат — Telegram-чат, а не пользователь).
 */
export const EXTERNAL: ReadonlySet<string> = new Set(['invite_created', 'invite_resent', 'trip_telegram_unlinked']);

/** Собрать готовые строки для вставки: общий spec × получатели. Получатель без
 *  `id` (офлайн/битый) отбрасывается; нет спеки или нет получателей → []. */
export function buildInAppRows(event: string, data: NotifyData): Array<InAppSpec & { user_id: string; read: boolean }> {
  const spec = INAPP[event]?.(data);
  if (!spec) return [];
  const seen = new Set<string>();
  const rows: Array<InAppSpec & { user_id: string; read: boolean }> = [];
  for (const r of data.recipients ?? []) {
    const user_id = str((r as { id?: unknown })?.id);
    if (!user_id || seen.has(user_id)) continue;
    seen.add(user_id);
    rows.push({ ...spec, user_id, read: false });
  }
  return rows;
}
