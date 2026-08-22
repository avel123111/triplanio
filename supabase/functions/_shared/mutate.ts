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
import { HttpError, jsonError, refusalResponse, runInBackground } from './http.ts';
import { captureEdgeError } from './sentry.ts';
import { isCallerEditor, isCallerOwner, isCallerParticipant } from './tripAccess.ts';
import { proRefusal } from './proGate.ts';
import { mutateSuccess } from './mutateResponse.ts';
import { buildPlan, findUnguardedRowSelf, parseAction, REGISTRY, TRIP_LIMIT_REACHED, unwrapDbResult, validateInput } from './mutateRules.ts';
import type { Actor, ActionSpec, Refusal, ResourceSpec, WritePlan } from './mutateRules.ts';
import { AFTER_WRITE } from './mutateEffects.ts';

// ИНВАРИАНТ №7 (fail-fast на загрузке): ни одно действие с `requires:[]` и записью
// не смеет быть без `loadTarget`+`guardRow` (дверь без замка). Ловит опечатку до
// первого запроса — весь seam-деплой падает, а не молча пускает запись без auth.
const rowSelfViolations = findUnguardedRowSelf();
if (rowSelfViolations.length) {
  throw new Error(`mutate: инвариант №7 нарушен:\n  ${rowSelfViolations.join('\n  ')}`);
}

/**
 * Единственная дверь DB-вызовов шва: инвариант `unwrapDbResult` (ошибка БД →
 * throw, НЕ бизнес-ответ) держится ПО ПОСТРОЕНИЮ, а не по памяти автора на
 * каждой ветке. Тестируется на чистом `unwrapDbResult` в `mutateRules_test.ts`.
 */
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  return unwrapDbResult(await supabaseAdmin.rpc(name, args));
}

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
    case 'participant':
      // Viewer ПРОХОДИТ (чат коллаборативный). Бросает TripAccessError на инфра-
      // сбое → 5xx, НЕ ложный 403 (TRIP-208). Порядок в `requires` важен: для чата
      // `['participant','pro']` — не-участник получает 403 и не узнаёт Pro-детали.
      return (await isCallerParticipant(ctx.scopeValue, ctx.actor))
        ? null
        : { status: 403, code: 'FORBIDDEN', message: 'Forbidden' };
    case 'editor':
      // Бросает TripAccessError на инфра-сбое → 5xx, НЕ ложный 403 (TRIP-208).
      return (await isCallerEditor(ctx.scopeValue, ctx.actor))
        ? null
        : { status: 403, code: 'FORBIDDEN', message: 'Forbidden' };
    case 'owner':
      // Верхняя ступень лестницы (`created_by === actor`) — гейтит удаление трипа
      // (TRIP-416). Так же, как editor/participant: инфра-сбой бросает
      // TripAccessError → 5xx, а не ложный 403; НЕсуществующий трип → false → 403
      // (не течёт существование трипа; тот же seam-паттерн, что editor/participant).
      return (await isCallerOwner(ctx.scopeValue, ctx.actor))
        ? null
        : { status: 403, code: 'FORBIDDEN', message: 'Forbidden' };
    case 'self':
      // Ресурс без трипа: владение = актор владеет своей же строкой.
      return ctx.scopeValue === ctx.actor
        ? null
        : { status: 403, code: 'FORBIDDEN', message: 'Forbidden' };
    case 'pro':
      // ОДИН источник Pro-отказа (`proRefusal`, предикат `is_trip_pro`) — тот же,
      // что зовут не-шовные функции через `requireTripPro` (TRIP-408). Сбой RPC
      // бросается внутри → 500 (не ложный 402); не-Pro → 402 PRO_REQUIRED+skip.
      return await proRefusal(supabaseAdmin, ctx.scopeValue);
    case 'trip_quota': {
      // Авторитетный гейт лимита free/Pro на ЗАПИСИ (создание трипа) — ОДИН булев
      // предикат `can_create_trip` (is_pro OR active<1), ровно как `pro`-ветка зовёт
      // `is_trip_pro`. Порог и комбинация живут в самом предикате; триггер
      // `enforce_trip_limit` (backstop) зовёт ТОТ ЖЕ предикат — не две формулы.
      // Сбой БД брошен внутри `rpc()` → 500 (как editor/pro); сюда доезжает только
      // настоящее `data` → `false` = бизнес-«нет» (лимит), не спрятанный инцидент.
      const ok = await rpc('can_create_trip', { p_uid: ctx.actor });
      return ok === true ? null : TRIP_LIMIT_REACHED;
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
  // `table` опционален (ради `op:'rpc'`), но `loadTarget` бывает только у table-DML.
  // Сузить тем же паттерном, что `buildPlan`: отсутствие = конфиг-ошибка, не no-op.
  const table = action.table;
  if (!table) throw new Error(`loadTarget requires a table for "${action.op}"`);
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('*')
    .eq('id', targetId)
    .eq(scopeCol, scopeValue)
    .limit(1);
  if (error) throw error; // инфра-сбой → 500, не ложный 404
  return data?.[0] ?? null;
}

/** Исполняет план записи под service_role. Возвращает payload записи: строку
 *  insert/update, uuid-строку (create_trip), либо null (delete/void-RPC). */
async function runPlan(plan: WritePlan): Promise<unknown> {
  // `op:'none'` — записи нет (`resend`): шов идёт сразу в `afterWrite`, данных нет.
  if (plan.op === 'none') return null;
  // `op:'rpc'` — тело действия один атомарный RPC (layover: города+сегменты+
  // recompute). Идёт через ту же дверь `rpc()`, что и `prepareRpc`, поэтому
  // инвариант «ошибка БД → throw → 500» держится по построению (TRIP-405).
  // add_layover_transfer возвращает void → шов отдаёт null.
  if (plan.op === 'rpc') {
    return await rpc(plan.name, plan.args);
  }
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
  // Машинный код на 401 — как у всех прочих edge-функций (`UNAUTHORIZED` — мёртвый
  // код, не использовать); клиент ветвится по `code`, не по тексту (TRIP-420).
  if (!actor) return jsonError(401, 'Unauthorized', 'UNAUTHENTICATED', corsHeaders);

  // Райдер #6 (TRIP-409): пустое/отсутствующее тело → `{}`. Клиент no-arg
  // действия (`inbox/read-all`) зовёт `invokeFn` без body → `req.json()` бросал →
  // 400 INVALID_BODY, «прочитать всё» не работало. Обязательные поля всё равно
  // добьёт `validateInput`; чинит read-all и любое будущее no-arg действие.
  const rawBody = await req.text();
  let body: Record<string, unknown> = {};
  if (rawBody.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonError(400, 'Request body must be valid JSON', 'INVALID_BODY', corsHeaders);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonError(400, 'Request body must be a JSON object', 'INVALID_BODY', corsHeaders);
    }
    body = parsed as Record<string, unknown>;
  }

  const actorFull: Actor = { id: actor.id, email: actor.email ?? null };
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

  // guardRow читается ТОЛЬКО по существующей строке (update/delete/rpc/none по id),
  // на вставке строки ещё нет. Загружаем строго со скоупом, поэтому промах = 404,
  // а не «нашли чужую и отказали». `loadedRow` дальше едет в `afterWrite` (teardown
  // по member). guardRow получает ПОЛНОГО актора `{id,email}` (row-self по email).
  let loadedRow: Record<string, unknown> | null = null;
  if (action.loadTarget && targetId) {
    loadedRow = await loadTargetRow(action, resource.scope.column, scope, targetId);
    if (!loadedRow) return jsonError(404, 'Not found', 'NOT_FOUND', corsHeaders);
    const rowRefusal = action.guardRow?.(loadedRow, actorFull);
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
  let data = await runPlan(plan);

  // Дискриминант исхода RPC (`data.outcome`): едет в `afterWrite` (respond решает
  // accept/decline/owner-stray) И, если действие объявило `mapOutcome`, переводится
  // в бизнес-Refusal (invite: already_member/self/owner) через СУЩЕСТВУЮЩИЙ канон
  // `refusalResponse`. Бизнес-«нет» здесь — ЗНАЧЕНИЕ data, не ошибка БД (та → 500).
  let outcome: unknown = null;
  if (plan.op === 'rpc') {
    outcome = data && typeof data === 'object' ? (data as Record<string, unknown>).outcome ?? null : null;
    if (action.mapOutcome) {
      const mapped = action.mapOutcome(data);
      if ('status' in mapped) return refuse(mapped, corsHeaders);
      data = mapped.data;
    }
  }

  // afterWrite — единственный шаг побочки (emit/teardown/mark-read), best-effort:
  // её сбой НЕ роняет действие и не пользовательская ошибка (эффекты уже совершены
  // на данных БД, откатывать нечего). Сама побочка описана в файле ресурса
  // (`mutateEffects.ts`), дверь лишь зовёт её по ключу `slug/action`.
  const effect = AFTER_WRITE[`${slug}/${actionName}`];
  if (effect) {
    try {
      await effect({ actor: actorFull, loadedRow, result: data, outcome, isInsert, scopeValue: scope, db: supabaseAdmin });
    } catch (e) {
      console.error(`mutate: afterWrite ${slug}/${actionName} failed:`, e);
      // Побочка best-effort, но её тихий сбой (teardown участника, mark-read)
      // должен быть виден в мониторинге. `emit`/`notify` уже саморепортят
      // fire-and-forget и в этот catch физически не попадают — двойного capture
      // нет. В фоне (как в `withHandler`), чтобы не добавлять задержку к ответу.
      runInBackground(captureEdgeError(e, 'mutate', { afterWrite: `${slug}/${actionName}` }));
    }
  }

  // Действие пере-разложило маршрут (запись трансфера): recompute уже случился
  // в ТОЙ ЖЕ транзакции записи (триггер `trg_recompute_transfer` на upsert/delete,
  // либо внутри RPC layover) и закоммичен. Дочитываем АВТОРИТЕТНУЮ цепочку И полный
  // набор трансферов трипа, отдаём их в ОДНОМ ответе — клиент реконсилит даты
  // городов и срез трансферов из этого ответа, без второго рефетча (тот же контракт,
  // что route-RPC, TRIP-435). Форма: `{ row, cities, transfers }` (row = записанная
  // строка / null у delete/void-rpc).
  //
  // Зачем `transfers`: одиночный трансфер клиент сворачивал из `row`, но layover
  // пишет N новых сегментов (RPC → `row:null`), которые построчный fold свернуть не
  // мог → клиент делал второй рефетч контента, и даты «доезжали» через секунду
  // (buildDraft выводит gap из трансферов, а они отставали). Возвращаем набор — клиент
  // заменяет `content.transfers` целиком, одиночный и layover идут одним путём.
  //
  // Read-АФТЕР-WRITE, поэтому НЕ через `rpc()` (тот бросил бы → 500): запись УЖЕ
  // закоммичена, и провал чисто-обогащающего дочитывания НЕ смеет превратить
  // успешную запись в 500 (клиент ретраил бы → дубль трансфера). Деградируем как
  // `afterWrite`: логируем + `null`, клиент падает на рефетч (ровно до-returnChain
  // поведение), а не теряет запись. `transfers` — тот же `select('*')`, что и
  // getTripDetails (та же форма строк, без обогащения → замена среза корректна).
  if (action.returnChain) {
    let cities: unknown = null;
    let transfers: unknown = null;
    try {
      cities = await rpc('_trip_city_chain', { p_trip: scope });
    } catch (e) {
      console.error(`mutate: returnChain chain read failed ${slug}/${actionName}:`, e);
      runInBackground(captureEdgeError(e, 'mutate', { returnChain: `${slug}/${actionName}` }));
    }
    try {
      // Тот же запрос, что read-дверь (getTripDetails): `select('*')` по `trip_id`,
      // БЕЗ order — клиент ищет трансферы по from/to id, порядок массива ему не важен,
      // а лишний `order` разъехался бы с формой read-двери (фоновый рефетч вернул бы
      // другой порядок среза). Одна форма на обе двери.
      const { data: trows, error } = await supabaseAdmin
        .from('transfers').select('*').eq('trip_id', scope);
      if (error) throw error;
      transfers = trows ?? [];
    } catch (e) {
      console.error(`mutate: returnChain transfers read failed ${slug}/${actionName}:`, e);
      runInBackground(captureEdgeError(e, 'mutate', { returnChainTransfers: `${slug}/${actionName}` }));
    }
    return mutateSuccess({ row: data ?? null, cities: cities ?? null, transfers: transfers ?? null }, corsHeaders);
  }

  return mutateSuccess(data, corsHeaders);
}

/** Отказ по канону — ОДНА логика заголовка `x-sentry-skip` живёт в
 *  `refusalResponse` (`http.ts`), общая со шва и `requireTripPro` (TRIP-408). */
function refuse(r: Refusal, corsHeaders: HeadersInit): Response {
  return refusalResponse(r, corsHeaders);
}
