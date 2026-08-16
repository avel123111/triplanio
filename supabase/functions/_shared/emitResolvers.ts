/**
 * РЕЗОЛВЕРЫ `emit` (TRIP-417) — разворачивают id-конверт события в ФАКТЫ-объекты
 * `{ trip, actor, member, recipients }` для одного n8n-воркфлоу на обе среды: все
 * чтения БД уезжают сюда, n8n перестаёт ходить в БД за сущностями (резолв текста
 * и каналов остаётся в n8n).
 *
 * Живёт в I/O-слое (рядом с `emit`), НЕ в чистых спеках `resources/*`: резолвер
 * читает БД и достижим по импорту из `emit.ts` (тот тянет `sentry`/`analytics`,
 * читающие `Deno.env` на загрузке) — в чистом реестре это уронило бы env-free
 * `deno test`. Выбор аудитории вынесен в `emitResolverRules.ts` (чистое, под тест);
 * здесь — только `select`.
 *
 * Реестр `RESOLVERS` ключуется по имени события — зеркально `AFTER_WRITE`
 * (`mutateEffects.ts`). Полные строки (`select('*')`) — паритет с текущим n8n
 * `Get *` (тот тоже брал строку целиком); подрезка PII, если понадобится, —
 * отдельным списком колонок, форму контракта не меняет.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { EmitIds } from './emit.ts';
import { memberLeftRecipientIds } from './emitResolverRules.ts';

export type Row = Record<string, unknown> | null;
export type EmitData = {
  trip: Row;
  actor: Row;
  member: Row;
  recipients: Record<string, unknown>[];
  /** Telegram-чат отвязки (только `trip_telegram_unlinked`): адресат внешней
   *  доставки — сам чат, не пользователь, поэтому едет полем конверта, а не в
   *  `recipients`. Остальные события его не заполняют. */
  chat_id?: string | null;
};

/** Пустой конверт — когда резолвера нет (неизвестное событие) или нет `db`. */
export const EMPTY_DATA: EmitData = { trip: null, actor: null, member: null, recipients: [] };

type Snapshot = Record<string, unknown> | undefined;
type Resolver = (db: SupabaseClient, ids: EmitIds, snapshot: Snapshot) => Promise<EmitData>;

// ── лоадеры полных строк ──────────────────────────────────────────────────────

async function loadTrip(db: SupabaseClient, id: unknown): Promise<Row> {
  if (typeof id !== 'string' || !id) return null;
  const { data } = await db.from('trips').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

async function loadUser(db: SupabaseClient, id: unknown): Promise<Row> {
  if (typeof id !== 'string' || !id) return null;
  const { data } = await db.from('users').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

/** Аудитория целиком: дедуп, отбрасывает пустые/не-строки, `[]` если никого. */
async function loadUsers(db: SupabaseClient, ids: unknown[]): Promise<Record<string, unknown>[]> {
  const uniq = [...new Set(ids.filter((x): x is string => typeof x === 'string' && !!x))];
  if (!uniq.length) return [];
  const { data } = await db.from('users').select('*').in('id', uniq);
  return data ?? [];
}

async function loadMemberById(db: SupabaseClient, id: unknown): Promise<Row> {
  if (typeof id !== 'string' || !id) return null;
  const { data } = await db.from('trip_members').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

async function loadMemberByTripUser(db: SupabaseClient, tripId: unknown, userId: unknown): Promise<Row> {
  if (typeof tripId !== 'string' || !tripId || typeof userId !== 'string' || !userId) return null;
  const { data } = await db.from('trip_members').select('*')
    .eq('trip_id', tripId).eq('user_id', userId).maybeSingle();
  return data ?? null;
}

async function loadActiveAdminIds(db: SupabaseClient, tripId: unknown): Promise<unknown[]> {
  if (typeof tripId !== 'string' || !tripId) return [];
  const { data } = await db.from('trip_members').select('user_id')
    .eq('trip_id', tripId).eq('role', 'admin').eq('status', 'active');
  return (data ?? []).map((r) => (r as { user_id: unknown }).user_id);
}

/**
 * Строка членства для события. Для `remove`/`leave` строка уже удалена → ТОЛЬКО
 * из снимка (`snapshot`); для живых событий — снимок, иначе дочитывается по
 * `member_id`, иначе по (`trip_id`, `actor_id`) — случай redeem-accept без ctx.
 */
async function resolveMember(db: SupabaseClient, ids: EmitIds, snapshot: Snapshot): Promise<Row> {
  if (snapshot) return snapshot;
  if (ids.member_id) return loadMemberById(db, ids.member_id);
  return loadMemberByTripUser(db, ids.trip_id, ids.actor_id);
}

// ── общие формы ───────────────────────────────────────────────────────────────

/** trip + actor + member (снимок/дочитка), получатели считает вызывающий. */
async function tripActorMember(db: SupabaseClient, ids: EmitIds, snapshot: Snapshot) {
  const [trip, actor, member] = await Promise.all([
    loadTrip(db, ids.trip_id),
    loadUser(db, ids.actor_id),
    resolveMember(db, ids, snapshot),
  ]);
  return { trip, actor, member };
}

/** Приглашение отвечено (accept/decline) — оба варианта (respond через снимок и
 *  standalone redeem без него) сводятся к одному резолверу: адресат = `recipient_id`. */
const respondResolver: Resolver = async (db, ids, snapshot) => {
  const [core, recipients] = await Promise.all([
    tripActorMember(db, ids, snapshot),
    loadUsers(db, [ids.recipient_id]),
  ]);
  return { ...core, recipients };
};

/** Событие подписки — сущностей трипа нет, только адресат-получатель. */
const proResolver: Resolver = async (db, ids) => ({
  trip: null,
  actor: null,
  member: null,
  recipients: await loadUsers(db, [ids.recipient_id]),
});

// ── реестр по имени события (зеркально AFTER_WRITE) ───────────────────────────

export const RESOLVERS: Record<string, Resolver> = {
  // Приглашение создано/реактивировано — адресат = приглашённый (если с аккаунтом);
  // email всё равно уйдёт по member.invite_email.
  invite_created: async (db, ids, snapshot) => {
    const core = await tripActorMember(db, ids, snapshot);
    return { ...core, recipients: await loadUsers(db, [core.member?.user_id]) };
  },

  // Регистрация связала pending-инвайт (TRIP-411) — адресат = сам новорег
  // (recipient_id = actor_id). Снимка нет: member дочитывается по member_id.
  invite_linked: async (db, ids, snapshot) => {
    const core = await tripActorMember(db, ids, snapshot);
    return { ...core, recipients: await loadUsers(db, [ids.recipient_id]) };
  },

  // Приглашение переслано — inapp-адресатов нет, только повтор email (по member).
  invite_resent: async (db, ids, snapshot) => {
    const core = await tripActorMember(db, ids, snapshot);
    return { ...core, recipients: [] };
  },

  // Роль изменена — адресат = сам участник.
  trip_role_changed: async (db, ids, snapshot) => {
    const core = await tripActorMember(db, ids, snapshot);
    return { ...core, recipients: await loadUsers(db, [ids.recipient_id]) };
  },

  // Участник удалён админом — адресат = удалённый (member из снимка до delete).
  trip_member_removed: async (db, ids, snapshot) => {
    const core = await tripActorMember(db, ids, snapshot);
    return { ...core, recipients: await loadUsers(db, [ids.recipient_id]) };
  },

  // Участник вышел сам — адресаты = владелец + активные админы, без ушедшего.
  trip_member_left: async (db, ids, snapshot) => {
    const [core, adminIds] = await Promise.all([
      tripActorMember(db, ids, snapshot),
      loadActiveAdminIds(db, ids.trip_id),
    ]);
    const recipients = await loadUsers(
      db,
      memberLeftRecipientIds(core.trip?.created_by, adminIds, ids.actor_id),
    );
    return { ...core, recipients };
  },

  trip_member_joined: respondResolver,
  trip_invite_declined: respondResolver,
  pro_activated: proResolver,
  pro_payment_failed: proResolver,

  // Telegram-привязка снята (ручная отвязка / потеря Pro / выход-удаление
  // участника / выключение аддона telegram_assistant). Адресат — сам чат
  // (`chat_id` из id-слота: строка привязки к этому моменту уже удалена).
  // Трип читаем ради названия/ссылки в тексте; получателей-пользователей нет
  // (external-only, in-app-строку не пишем — нет спеки в notifyRules).
  trip_telegram_unlinked: async (db, ids) => ({
    trip: await loadTrip(db, ids.trip_id),
    actor: null,
    member: null,
    recipients: [],
    chat_id: typeof ids.chat_id === 'string' && ids.chat_id ? ids.chat_id : null,
  }),
};
