/**
 * ЭФФЕКТЫ ШВА (`afterWrite`) — I/O-побочка действий, ВНЕШНЯЯ для БД: `emit` в n8n,
 * teardown Storage/Telegram, отметка уведомления прочитанным (TRIP-409, эпик
 * TRIP-374). Живёт ОТДЕЛЬНО от чистых спеков (`resources/*.ts`) НАМЕРЕННО: `emit`
 * тянет `sentry.ts`/`analytics.ts`, а те читают `Deno.env` на загрузке модуля —
 * значит файл, достижимый по импорту из `REGISTRY`, уронил бы `deno test` (он
 * идёт без `--allow-env`). Поэтому эффекты сюда, а `mutate.ts` (уже I/O) зовёт их
 * по ключу `slug/action`. Дверь остаётся тупой: диспетчер здесь, не в движке.
 *
 * Контракт: каждый эффект — BEST-EFFORT (его сбой ловит `mutate.ts` и НЕ роняет
 * действие: запись уже совершена, откатывать нечего). Имена событий/ключи payload
 * — как в переносимых standalone-функциях (n8n-роутинг не ломается, принцип №0).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Actor } from './mutateRules.ts';
import { emit } from './emit.ts';
import { purgePrivateDocsForMember } from './personalDocsTeardown.ts';
import { disconnectTripTelegram } from './telegramTeardown.ts';
import { purgeTripBucket } from './tripStoragePurge.ts';
import { emitTripReached2 } from './analytics.ts';
import { respondEffectPlan, roleChangeNotifies } from './memberEffectRules.ts';

/** Контекст побочки: актор, загруженная ДО записи строка, результат записи,
 *  дискриминант исхода RPC, скоуп (trip_id) и service_role-клиент. */
export type AfterWriteCtx = {
  actor: Actor;
  loadedRow: Record<string, unknown> | null;
  result: unknown;
  outcome: unknown;
  scopeValue: string;
  db: SupabaseClient;
};

export type AfterWrite = (ctx: AfterWriteCtx) => Promise<void>;

const asRow = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});

/**
 * Снести личные документы (строки+Storage) и привязки Telegram ушедшего/удалённого
 * участника — общий шаг `remove`(admin) и `leave`(self). Оба — best-effort (сбой
 * логируется внутри хелперов). Офлайн-участник (`user_id` null) — no-op.
 */
async function teardownMember(db: SupabaseClient, tripId: unknown, userId: unknown): Promise<void> {
  if (typeof userId !== 'string' || !userId || typeof tripId !== 'string' || !tripId) return;
  try {
    await purgePrivateDocsForMember(db, { tripId, userId });
  } catch (e) {
    console.error('afterWrite: personal docs purge failed', e);
  }
  await disconnectTripTelegram(db, { tripId, userId });
}

/**
 * Реестр побочек по ключу `slug/action`. Присутствие ключа = «у действия есть
 * afterWrite» (декларация — здесь, в файле ресурса-эффектов, не на чистом спеке).
 */
export const AFTER_WRITE: Record<string, AfterWrite> = {
  // Трип удалён владельцем (TRIP-416). Внешняя побочка, которую FK-каскад не
  // достаёт, ПОСЛЕ удаления строки — обе best-effort:
  //   1. Telegram-teardown: FK `trip_telegram_integrations.trip_id` = ON DELETE
  //      CASCADE, поэтому строки привязок каскад снял сам; вызов оставлен
  //      forward-домом под будущий шаг вызова Telegram API (снимет 0 строк — no-op).
  //   2. Storage-purge префикса `<tripId>/` в бакете `trips` (обложка включительно).
  // scopeValue = tripId (resolveScope по body.tripId).
  'trip-owner/delete': async ({ scopeValue, db }) => {
    try {
      await disconnectTripTelegram(db, { tripId: scopeValue });
    } catch (e) {
      console.error('afterWrite: trip-owner/delete telegram teardown failed', e);
    }
    try {
      await purgeTripBucket(db, scopeValue);
    } catch (e) {
      console.error('afterWrite: trip-owner/delete storage purge failed', e);
    }
  },

  // Регистрация связала pending-инвайты (TRIP-411): по каждому связанному — n8n
  // уведомляет приглашённого (получатель = сам новый юзер). Заменяет слепой
  // `INSERT notifications` из удалённого триггера `link_pending_invites`. Только
  // при created (повтор из двух вкладок уже связал на 1-м вызове). Best-effort.
  'account/register': async ({ result, actor }) => {
    const data = asRow(result);
    if (!data.created) return;
    const linked = Array.isArray(data.linked) ? data.linked : [];
    for (const inv of linked) {
      const m = asRow(inv);
      emit('invite_linked', { trip_id: m.trip_id as string, member_id: m.id as string, recipient_id: actor.id });
    }
  },

  // Приглашение создано/реактивировано (declined→pending) — n8n шлёт нотиф+email.
  'trip-member/invite': async ({ result, scopeValue, actor }) => {
    const member = asRow(result);
    emit('invite_created', { trip_id: scopeValue, actor_id: actor.id, member_id: member.id as string });
  },

  // Приглашение переслано (записи не было — re-emit по загруженной строке).
  'trip-member/resend': async ({ loadedRow, actor }) => {
    const member = asRow(loadedRow);
    emit('invite_resent', { trip_id: member.trip_id as string, actor_id: actor.id, member_id: member.id as string });
  },

  // Роль изменена — уведомляем участника ТОЛЬКО при реальной смене и для юзера с
  // аккаунтом (сравниваем старую роль из loadedRow с новой из результата UPDATE).
  'trip-member/role': async ({ loadedRow, result, actor }) => {
    const before = asRow(loadedRow);
    const after = asRow(result);
    if (roleChangeNotifies(before.role, after.role, before.user_id)) {
      emit('role_changed', {
        trip_id: before.trip_id as string,
        recipient_id: before.user_id as string,
        actor_id: actor.id,
        member_id: before.id as string,
      });
    }
  },

  // Участник удалён админом. Блок-лист УЖЕ записан атомарно в RPC. Здесь — teardown
  // (Storage/Telegram) + уведомление удалённому (только если у него был аккаунт).
  'trip-member/remove': async ({ loadedRow, actor, db }) => {
    const member = asRow(loadedRow);
    await teardownMember(db, member.trip_id, member.user_id);
    if (member.user_id) {
      emit('member_removed', { trip_id: member.trip_id as string, recipient_id: member.user_id as string, actor_id: actor.id });
    }
  },

  // Участник вышел сам — teardown + уведомление владельцу/админам (n8n резолвит
  // аудиторию по member_left). Блок-лист НЕ пишем (ушёл добровольно).
  'trip-member-self/leave': async ({ loadedRow, db }) => {
    const member = asRow(loadedRow);
    await teardownMember(db, member.trip_id, member.user_id);
    if (member.user_id) emit('member_left', { trip_id: member.trip_id as string, actor_id: member.user_id as string });
  },

  // Ответ на приглашение. По исходу RPC: accept → North-Star + уведомить пригласившего;
  // decline → уведомить пригласившего; owner_stray → только пометить прочитанным.
  // Метку read ставим всегда (приглашение отвечено — уведомление больше не висит).
  'trip-member-self/respond': async ({ loadedRow, outcome, scopeValue, actor, db }) => {
    const member = asRow(loadedRow);
    await db.from('notifications').update({ read: true })
      .eq('user_id', actor.id).eq('trip_member_id', member.id);
    const plan = respondEffectPlan(outcome);
    // North Star: сделал ли accept трип коллаборативным (владелец + 1-й участник = 2)?
    if (plan.reached2) await emitTripReached2(db, scopeValue, actor.id);
    if (plan.emit && member.invited_by) {
      emit(plan.emit, { trip_id: scopeValue, recipient_id: member.invited_by as string, actor_id: actor.id });
    }
  },
};
