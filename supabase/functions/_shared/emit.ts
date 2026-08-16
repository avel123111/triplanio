/**
 * notify(event, ids) — the single door for backend communication events
 * (TRIP-356 → эпик TRIP-374).
 *
 * Splits a communication event into two sinks, resolving the FACTS once:
 *   • IN-APP — the `notifications` row(s), written HERE in edge under service_role
 *     (`writeInApp` + spec in notifyRules.ts). In-app is not a delivery channel —
 *     it is a projection of the event into our OWN database, so its home is the
 *     data door (TRIP-374), not n8n. Awaited (the inbox is authoritative and must
 *     not ride a fire-and-forget webhook), fail-open (a failed insert is captured,
 *     never breaks the user's action).
 *   • EXTERNAL — email / Telegram, still delivered by n8n: the backend ANNOUNCES
 *     the fact and hands an envelope; n8n resolves language / text and delivers.
 *     Fire-and-forget in the background. Adding an EXTERNAL channel is an n8n
 *     branch, not a code change.
 *
 * This replaced the older TRIP-356 shape where n8n also wrote the in-app row (its
 * write-inapp branch) — that conflated a DB write with a delivery channel and let
 * the author name be baked into the localized string (survived anonymization).
 *
 * Contract (TRIP-417): the wire envelope is { event, env, at, id, data }, where
 * `data` = { trip, actor, member, recipients } — the FACTS as full rows, resolved
 * here from the caller's id slots (see emitResolvers.ts) so n8n reads 0 tables.
 *   • `env`  = raw SENTRY_ENVIRONMENT (development | production) — one workflow
 *     picks the target DB / link base-URL by this label (no Supabase URL needed).
 *   • the backend passes ONLY ids + the `member` snapshot for delete-then-emit
 *     events; the resolver dereferences the rest.
 * Call notify AFTER the function's own writes are committed.
 *
 * Trade-off owned in Phase 1 (§6): no `outgoing` journal / idempotency yet — if
 * the external webhook doesn't arrive that channel is lost. In-app, now awaited
 * in-request, no longer depends on the webhook arriving.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { runInBackground } from './http.ts';
import { signN8nJwt } from './n8nAuth.ts';
import { captureEdgeError } from './sentry.ts';
import { RESOLVERS, EMPTY_DATA, type EmitData } from './emitResolvers.ts';
import { buildInAppRows, EXTERNAL } from './notifyRules.ts';

// n8n receiver base for backend communication events; the event name is the
// last path segment, e.g. .../webhook/notify/invite_created (§1). One webhook
// per event in n8n — no Switch, the URL routes.
const N8N_NOTIFY_BASE = 'https://n8n-production-d1214.up.railway.app/webhook/notify';

/** Id slots the resolver dereferences. Every field optional; the backend fills
 *  only what applies. NOT sent on the wire — consumed by the resolver. */
export type EmitIds = {
  /** Trip the event is about. */
  trip_id?: string;
  /** Explicit addressee (audience for single-recipient events). */
  recipient_id?: string;
  /** Who triggered the event (for `created_by` and audience exclusion). */
  actor_id?: string;
  /** `trip_members` row id — the resolver reads the member row by it. */
  member_id?: string;
  /** Telegram chat the event addresses (trip_telegram_unlinked) — the binding
   *  row is already deleted by resolve time, so the chat id rides the id slot,
   *  not a DB read. */
  chat_id?: string;
};

/** Resolve context: the caller's service_role client + the pre-write `member`
 *  snapshot for delete-then-emit events (the row is gone by resolve time). */
export type EmitCtx = { db: SupabaseClient; snapshot?: Record<string, unknown> };

/** Build the wire envelope (TRIP-417): fixed fields + resolved `data`. */
export function buildEnvelope(event: string, data: EmitData): Record<string, unknown> {
  return {
    event,
    env: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
    at: new Date().toISOString(),
    id: crypto.randomUUID(),
    data,
  };
}

/** Развернуть id-конверт в ФАКТЫ через реестр резолверов (или EMPTY_DATA, если
 *  события нет / нет db). Общий шаг для in-app-записи и внешней доставки. */
async function resolveData(event: string, ids: EmitIds, ctx?: EmitCtx): Promise<EmitData> {
  const resolver = RESOLVERS[event];
  return ctx?.db && resolver ? await resolver(ctx.db, ids, ctx.snapshot) : EMPTY_DATA;
}

/** ВНЕШНЯЯ доставка (email/Telegram) через n8n. Fire-and-forget по контракту;
 *  сбой — в Sentry, действие пользователя не роняет. `data` уже резолвнут. */
async function postExternal(event: string, data: EmitData): Promise<void> {
  try {
    const secret = Deno.env.get('N8N_SECRET');
    if (!secret) {
      await captureEdgeError(new Error(`emit(${event}): N8N_SECRET not set`), 'emit');
      return;
    }
    const body = buildEnvelope(event, data);
    const jwt = await signN8nJwt(secret);
    const res = await fetch(`${N8N_NOTIFY_BASE}/${encodeURIComponent(event)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = `emit(${event}) -> ${res.status}`;
      console.error(msg);
      await captureEdgeError(new Error(msg), 'emit', { event, id: body.id });
    }
  } catch (e) {
    console.error(`emit(${event}) failed:`, e);
    await captureEdgeError(e, 'emit', { event });
  }
}

/**
 * ЗАПИСЬ in-app строк уведомлений — единственный дом in-app (эпик TRIP-374):
 * своя таблица, своя дверь (edge под service_role), НЕ внешний канал. Awaited
 * (в отличие от внешних) — инбокс авторитетен и не должен теряться на непришедшем
 * вебхуке; но FAIL-OPEN: сбой вставки логируется в Sentry и НЕ роняет действие
 * пользователя (мутация уже закоммичена). Спека строки — `notifyRules`.
 */
async function writeInApp(event: string, data: EmitData, db: EmitCtx['db']): Promise<void> {
  try {
    const rows = buildInAppRows(event, data);
    if (rows.length === 0) return;
    const { error } = await db.from('notifications').insert(rows);
    if (error) {
      console.error(`notify(${event}) in-app insert failed:`, error);
      await captureEdgeError(new Error(`notify(${event}) in-app insert: ${error.message}`), 'notify', { event });
    }
  } catch (e) {
    console.error(`notify(${event}) in-app write threw:`, e);
    await captureEdgeError(e, 'notify', { event });
  }
}

/**
 * Единая дверь коммуникации события: резолвит факты ОДИН раз и раздаёт в стоки —
 * durable in-app (await) + внешний канал n8n/email (fire-and-forget) ТОЛЬКО для
 * событий из `EXTERNAL`. Событие без внешнего канала (большинство) в n8n не
 * ходит вовсе — его in-app-ветка там удалена, POST дал бы 404. Полностью
 * fail-open. Пришло на смену прямым `INSERT notifications` (до TRIP-356 копия в
 * каждой функции) и n8n-ветке write-inapp: одна запись, одно место.
 */
export async function notify(event: string, ids: EmitIds = {}, ctx?: EmitCtx): Promise<void> {
  // Резолв фактов огорожен: контракт notify — ПОЛНОСТЬЮ fail-open, но резолвер
  // читает БД и мог бы бросить сетевым исключением (не просто вернуть `.error`).
  // Действие вызывателя (напр. отвязка, уже закоммиченная до notify) не должно из-за
  // этого получить 500. Не резолвнули факты → тихо выходим (оба стока пропускаем).
  let data: EmitData;
  try {
    data = await resolveData(event, ids, ctx);
  } catch (e) {
    await captureEdgeError(e, 'notify', { event });
    return;
  }
  if (ctx?.db) await writeInApp(event, data, ctx.db);
  if (EXTERNAL.has(event)) runInBackground(postExternal(event, data));
}
