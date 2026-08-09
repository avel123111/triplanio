// @ts-check
/**
 * ШОВ ЗАПИСИ — I/O-половина (TRIP-394, Ф2 эпика TRIP-374).
 *
 * Единственная дверь записи для ресурсов из `REGISTRY`. Держит клиента БД и
 * резолв личности, поэтому из `deno test` не подгружается (env на загрузке
 * `supabaseAdmin.ts`) — чистое правило живёт в `mutateRules.ts` и там же
 * тестируется. Здесь — порядок шагов и перевод отказов в канон `http.ts`.
 *
 * Контракт (ТЗ TRIP-394 §1):
 *   1. actor = JWT              нет → 401
 *   2. can(resource, action)    нет права на РЕСУРС+действие → 403 / 402
 *   3. validate(input)          кэпы/обязательность → 400
 *   4. write под service_role   (актор как ДАННЫЕ: created_by/updated_by)
 *   5. {data}
 *
 * ★ Авторизация ТОЛЬКО здесь. Под `service_role` RLS не действует — значит
 * право обязано быть проверено в TS, а скоуп строки вшивает `buildPlan`, а не
 * этот файл (см. шапку `mutateRules.ts`: IDOR закрыт по построению).
 *
 * ★★ «0 строк после записи» здесь значит НЕ то, что во фронтовом `writeRows`.
 * Там 0 строк = «RLS молча отвергла» (клиент под своей ролью). Тут клиент —
 * `service_role`, RLS выключена, поэтому 0 строк у update/delete по
 * `{id, trip_id}` = «строки с таким id в ЭТОМ трипе нет» = **404**, а не
 * «отказано». Это и есть переопределение семантики, о котором просит ревью.
 *
 * ★★★ ИНВАРИАНТ DB-ВЫЗОВОВ (TRIP-394 ②). `supabase-js` никогда не бросает —
 * всегда `{ data, error }`. Поэтому КАЖДЫЙ RPC шва идёт через `rpc()` (ниже),
 * где `error` = сбой инфраструктуры → throw → 500 INTERNAL. Интерпретировать
 * ошибку БД как бизнес-ответ (не-Pro / не-найдено) ЗАПРЕЩЕНО по построению:
 * иначе сбой выродился бы в 402/404, спрятал инцидент под `x-sentry-skip` и
 * молча сломал монетизацию. Бизнес-«нет» — только настоящее значение `data`.
 */

import { supabaseAdmin, getRequestUser } from './supabaseAdmin.ts';
import { HttpError, jsonError } from './http.ts';
import { isCallerEditor } from './tripAccess.ts';
import { buildPlan, parseAction, REGISTRY, unwrapDbResult, validateInput } from './mutateRules.ts';
import type { ActionSpec, Refusal, ResourceSpec, WritePlan } from './mutateRules.ts';

/**
 * Единственная дверь DB-вызовов шва: инвариант `unwrapDbResult` (ошибка БД →
 * throw, НЕ бизнес-ответ) держится ПО ПОСТРОЕНИЮ, а не по памяти автора на
 * каждой ветке. Тестируется на чистом `unwrapDbResult` в `mutateRules_test.ts`.
 */
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  return unwrapDbResult(await supabaseAdmin.rpc(name, args));
}

/** Ответ шва: успех несёт строку (или null для delete), отказ — статус+код. */
type MutateOk = { data: Record<string, unknown> | null };

/**
 * Требования действия (`requires`) вычисляются ЗДЕСЬ и одинаково для всех
 * ресурсов — ровно поэтому в шве нет `if` по имени действия (правило TRIP-382).
 * Новое требование добавляется одной строкой сюда, а не в каждую функцию.
 *
 * `scopeValue` — то, по чему проверяется право И скоупится строка: для трип-
 * ресурсов это `trip_id` из тела, для self-ресурсов — сам актор.
 */
async function checkRequirement(
  name: string,
  ctx: { actor: string; scopeValue: string },
): Promise<Refusal | null> {
  switch (name) {
    case 'editor':
      // Бросает TripAccessError на инфра-сбое → 5xx, НЕ ложный 403 (TRIP-208).
      return (await isCallerEditor(ctx.scopeValue, ctx.actor))
        ? null
        : { status: 403, code: 'FORBIDDEN', message: 'Forbidden' };
    case 'self':
      // Ресурс без трипа: владение = актор владеет своей же строкой.
      return ctx.scopeValue === ctx.actor
        ? null
        : { status: 403, code: 'FORBIDDEN', message: 'Forbidden' };
    case 'pro': {
      // Сбой БД брошен внутри `rpc()` → 500 INTERNAL (ретраится), как editor-ветка
      // (TripAccessError). Сюда доезжает только настоящее `data`, поэтому не-true —
      // это бизнес-«нет» (не Pro), а не спрятанный под x-sentry-skip инцидент.
      const isPro = await rpc('is_trip_pro', { p_trip_id: ctx.scopeValue });
      // Бизнес-«нет», не инцидент: помечаем sentrySkip, шов повесит x-sentry-skip.
      return isPro === true
        ? null
        : { status: 402, code: 'PRO_REQUIRED', message: 'Pro required', sentrySkip: true };
    }
    default:
      // Незнакомое требование — сбой конфигурации, а не отказ юзеру: 500.
      throw new Error(`mutate: unknown requirement "${name}"`);
  }
}

/** Достаёт строку по скоупу+id ДО записи — для `guardRow` (правило по строке). */
async function loadTargetRow(
  action: ActionSpec,
  scopeCol: string,
  scopeValue: string,
  targetId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from(action.table)
    .select('*')
    .eq('id', targetId)
    .eq(scopeCol, scopeValue)
    .limit(1);
  if (error) throw error; // инфра-сбой → 500, не ложный 404
  return data?.[0] ?? null;
}

/** Исполняет план записи под service_role. Возвращает строку (insert/update). */
async function runPlan(plan: WritePlan): Promise<Record<string, unknown> | null> {
  if (plan.op === 'insert') {
    const { data, error } = await supabaseAdmin.from(plan.table).insert(plan.values).select().single();
    if (error) throw error;
    return data;
  }
  if (plan.op === 'update') {
    let q = supabaseAdmin.from(plan.table).update(plan.values);
    for (const [col, val] of Object.entries(plan.match)) q = q.eq(col, val);
    const { data, error } = await q.select();
    if (error) throw error;
    // 0 строк под service_role = «нет такой строки в этом трипе» → 404 (см. шапку).
    if (!data?.length) throw new HttpError(404, 'Not found', 'NOT_FOUND');
    return data[0];
  }
  // delete: 0 строк — не ошибка (уже удалено; знание из writeRows expectRow:false).
  let q = supabaseAdmin.from(plan.table).delete();
  for (const [col, val] of Object.entries(plan.match)) q = q.eq(col, val);
  const { error } = await q;
  if (error) throw error;
  return null;
}

/**
 * Разбирает `trip_id`/актор в скоуп. Трип-ресурс берёт `tripId` из тела и по
 * нему же проверяет право; self-ресурс — из JWT (клиент трип не называет).
 */
function resolveScope(
  resource: ResourceSpec,
  actor: string,
  input: Record<string, unknown>,
): string | Refusal {
  if (resource.scope.from === 'actor') return actor;
  const tripId = input.tripId ?? input.trip_id;
  if (typeof tripId !== 'string' || !tripId) {
    return { status: 400, code: 'INVALID_INPUT', message: 'tripId is required' };
  }
  return tripId;
}

/**
 * Единая дверь записи. `slug` = имя функции (для разбора действия из пути).
 * Возвращает готовый `Response` по канону — вызывающая функция только
 * прокидывает `req`/`corsHeaders`, свою логику не пишет.
 */
export async function mutate(
  { req, slug, corsHeaders }: { req: Request; slug: string; corsHeaders: HeadersInit },
): Promise<Response> {
  const resource = REGISTRY[slug];
  if (!resource) throw new Error(`mutate: no resource registered for "${slug}"`);

  const actionName = parseAction(new URL(req.url).pathname, slug);
  const action = actionName ? resource.actions[actionName] : undefined;
  if (!action) return jsonError(404, 'Unknown action', 'UNKNOWN_ACTION', corsHeaders);

  const actor = await getRequestUser(req); // throws 503 on Auth outage
  if (!actor) return jsonError(401, 'Unauthorized', undefined, corsHeaders);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Request body must be valid JSON', 'INVALID_BODY', corsHeaders);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError(400, 'Request body must be a JSON object', 'INVALID_BODY', corsHeaders);
  }

  const scope = resolveScope(resource, actor.id, body);
  if (typeof scope !== 'string') return refuse(scope, corsHeaders);

  // Право на РЕСУРС+действие. Порядок требований важен: 403 (editor) идёт до
  // 402 (pro) — «не редактор» перекрывает «не Pro», и незалогиненному-в-трип
  // не сообщаем платёжную деталь.
  for (const name of action.requires) {
    const refusal = await checkRequirement(name, { actor: actor.id, scopeValue: scope });
    if (refusal) return refuse(refusal, corsHeaders);
  }

  const targetId = typeof body.id === 'string' && body.id ? body.id : null;

  // guardRow читается ТОЛЬКО по существующей строке (update/delete), на вставке
  // строки ещё нет. Загружаем строго со скоупом, поэтому промах = 404, а не
  // «нашли чужую и отказали».
  if (action.loadTarget && targetId) {
    const row = await loadTargetRow(action, resource.scope.column, scope, targetId);
    if (!row) return jsonError(404, 'Not found', 'NOT_FOUND', corsHeaders);
    const rowRefusal = action.guardRow?.(row, actor.id);
    if (rowRefusal) return refuse(rowRefusal, corsHeaders);
  }

  // Валидация. На вставке (нет id и не синглтон-по-скоупу) обязательность строгая.
  const isInsert = !targetId && action.targetBy !== 'scope';
  const validated = validateInput(action, body, { isInsert });
  if ('status' in validated) return refuse(validated, corsHeaders);

  // Self-heal строки перед записью (курсы): RPC исполнима только service_role.
  // Через ту же дверь `rpc()` — сбой БД бросится, а не проглотится (TRIP-394 ②).
  if (action.prepareRpc) {
    await rpc(action.prepareRpc, { p_trip_id: scope });
  }

  const plan = buildPlan(resource, action, {
    actor: actor.id,
    scopeValue: scope,
    targetId,
    values: validated.values,
  });
  const data = await runPlan(plan);
  return jsonResult({ data }, corsHeaders);
}

/** Отказ по канону. `sentrySkip` вешает заголовок (бизнес-«нет» не шумит). */
function refuse(r: Refusal, corsHeaders: HeadersInit): Response {
  const headers = r.sentrySkip ? { ...corsHeaders, 'x-sentry-skip': '1' } : corsHeaders;
  return jsonError(r.status, r.message, r.code, headers);
}

/** Успех: `{ data }`, дополняемый по правилу совместимости (поля не убираем). */
function jsonResult(ok: MutateOk, corsHeaders: HeadersInit): Response {
  return Response.json(ok, { headers: corsHeaders });
}
