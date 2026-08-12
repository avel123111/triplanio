/**
 * ПРАВИЛО ЗАПИСИ — чистая половина шва (TRIP-394, Ф2 эпика TRIP-374).
 *
 * Модуль намеренно держится БЕЗ I/O-импортов: `deno test` идёт без
 * `--allow-env`, а `_shared/supabaseAdmin.ts` читает переменные окружения ПРЯМО
 * на загрузке модуля — правило, лежащее рядом с клиентом БД, из теста не
 * подгрузить вовсе. Та же конвенция, что `tripStep.ts` ↔ `tripAccess.ts` и
 * `_shared/profiles.ts`. I/O-половина — `mutate.ts`.
 *
 * ★ ГЛАВНОЕ, РАДИ ЧЕГО ЭТОТ ФАЙЛ ВЫГЛЯДИТ ТАК, А НЕ КАК ПАЧКА ХЕНДЛЕРОВ.
 * До эпика строку защищала RLS: `_can_edit_trip(trip_id, auth.uid())` в
 * политике привязывал строку к трипу БЕСПЛАТНО, и `update … where id = ?` был
 * безопасен просто потому, что чужую строку политика не отдавала. Под
 * `service_role` RLS не действует, и ровно тот же код становится IDOR:
 * редактор трипа A правит трату трипа B, передав её id. Дифф при этом выглядит
 * нормально, права проверены честно, экран работает — не видит ни один гард.
 * Поэтому скоуп внедряет ПОСТРОИТЕЛЬ ПЛАНА, а не автор хендлера: хендлер
 * физически не умеет выразить незаскоупленную запись (handoff §7.3 — «проверка
 * обязана быть невозможной забыть по конструкции»). Тест
 * `★ ни одно действие реестра не строит update/delete без скоупа` идёт по
 * ВСЕМУ `REGISTRY`, поэтому новое действие попадает под инвариант само.
 *
 * ★★ ПОЧЕМУ СПЕЦИФИКАЦИЯ — ДАННЫЕ, А НЕ КОД. Правило эпика: «право
 * проверяется на РЕСУРСЕ; `if` по имени действия в общем шве = неверная
 * гранулярность» (TRIP-382). Действие объявляет СПИСОК требований (`requires`),
 * шов вычисляет их одинаково для всех — поэтому второй домен (`trip-document`)
 * добавляется файлом спецификации и строкой в `REGISTRY`, не трогая шов. Это и
 * есть приёмка блока 2.
 */

/**
 * Инвариант шва по построению: `supabase-js` НИКОГДА не бросает — он всегда
 * отдаёт `{ data, error }`. Значит любой DB-вызов шва обязан пройти через ЭТУ
 * дверь: `error` = сбой инфраструктуры → throw → 500 INTERNAL (ретраится, летит
 * в Sentry). Трактовать `error` как бизнес-ответ (не-Pro / не-найдено) запрещено:
 * иначе сбой БД вырождается в 402/404, инцидент прячется, а деньги-дорожка молча
 * ломается (TRIP-394 ②). Бизнес-«нет» — это ТОЛЬКО настоящее значение `data`
 * (напр. `is_trip_pro` вернул `false`), которое читает уже вызывающий.
 *
 * Живёт здесь, в тестируемой половине: I/O-обёртка `rpc()` в `mutate.ts` из
 * `deno test` не подгружается (env на загрузке клиента), а этот инвариант обязан
 * быть виден красным под мутацией — см. `mutateRules_test.ts`.
 */
export function unwrapDbResult<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}

/** Отказ, который шов отдаёт клиенту. `sentrySkip` — бизнес-«нет», не инцидент. */
export type Refusal = {
  status: number;
  code: string;
  message: string;
  sentrySkip?: boolean;
};

/** Объявление колонки, которую МОЖЕТ прислать клиент. Кэпы зеркалят CHECK в БД. */
export type FieldSpec = {
  /**
   * `json` = jsonb-ОБЪЕКТ (map, напр. `fx_overrides` «валюта→курс»); `array` =
   * jsonb-МАССИВ (напр. `documents`). Разведены НАМЕРЕННО: если бы `json` принимал
   * и массив, `fx_overrides: []` прошёл бы и МОЛЧА сбросил курсы (массив вместо
   * map) — регресс соседнего домена. Тип-гейт держит форму строго.
   */
  type: 'string' | 'number' | 'boolean' | 'uuid' | 'date' | 'json' | 'array';
  /** Обязательна на ВСТАВКЕ. На обновлении частичная правка законна. */
  required?: boolean;
  /** Кэп длины строки — тот же, что в CHECK (иначе БД отдаст 500 вместо 400). */
  max?: number;
  /** Пол числа — тот же, что в CHECK `>= 0`. */
  min?: number;
  enum?: readonly string[];
  nullable?: boolean;
  /**
   * Клиент может ТОЛЬКО ОБНУЛИТЬ колонку, но не задать ей значение.
   * Заведено под `budget_categories.system_key`: отвязать переименованную
   * категорию от системного ключа — законный ход клиента (TRIP-230), а вот
   * ПРИСВОИТЬ себе чужой системный ключ нельзя: `sync_budget_expense` роутит по
   * нему автотраты, и две категории с одним ключом развели бы их случайно.
   */
  clearOnly?: boolean;
  /**
   * Кастомная проверка формата ПОСЛЕ встроенных (тип/кэп/enum), ДАННЫМИ домена, а
   * не кодом шва (TRIP-399, приёмка блока 2). Движок лишь ЗОВЁТ хук — regex для
   * `link_url` и обход `documents[].file_url` живут в спецификации ресурса, шов
   * их не знает. Заведено под CHECK, которых нельзя выразить `type/max/min/enum`:
   * без него нарушение долетает до DB-CHECK и возвращается сырым 500 вместо
   * внятного 400 (регресс честных ответов, TRIP-378). Для `null` НЕ зовётся —
   * это уже решает `nullable`. Универсально: любое поле с форматом.
   */
  validate?: (value: unknown) => Refusal | null;
};

export type ActionSpec = {
  /**
   * `upsert` = вставка без id / обновление по id. `insert` = ТОЛЬКО вставка
   * (create-only): присланный id игнорируется, никакого UPDATE — append-only
   * ресурс (`trip_documents`: редактирования дока с клиента нет, а upsert с
   * чужим id правил бы чужую SHARED-строку, регресс TRIP-118). `delete` =
   * удаление по id. `rpc` = тело действия — ОДИН атомарный RPC (>1 записи в
   * транзакции: layover пишет waypoint-города + сегменты + recompute). Ветвь
   * даёт те же авторизацию/кэпы/контракт ошибок/актор, что и table-DML;
   * пустые RPC-обёртки «для симметрии» запрещены (TRIP-405). Универсально:
   * любой append-only ресурс берёт `insert`, любая транзакция — `rpc`.
   */
  op: 'upsert' | 'insert' | 'delete' | 'rpc';
  /** Таблица DML. Необязательна ТОЛЬКО для `op:'rpc'` (пишет сам RPC). */
  table?: string;
  /** Имя атомарного RPC. Только `op:'rpc'`. */
  rpc?: string;
  /**
   * Только `op:'rpc'`. ЧИСТОЕ отображение уже провалидированного входа (через
   * `fields`/`validate`, в т.ч. per-segment `TRANSFER_FIELDS`) в аргументы RPC —
   * без `p_actor`, его инъектит `buildPlan` (клиент актора не называет). Инфалибл:
   * валидация к этому моменту прошла, здесь только маппинг имён колонок в
   * `p_`-аргументы.
   */
  buildArgs?: (
    values: Record<string, unknown>,
    ctx: { actor: string; scopeValue: string },
  ) => Record<string, unknown>;
  /** Имена требований; вычисляет их шов (`mutate.ts`), а не эта половина. */
  requires: readonly string[];
  /**
   * Чем адресуется строка. `'id'` (умолчание) — обычная сущность;
   * `'scope'` — синглтон на скоуп (строка бюджета трипа), id не нужен и не
   * принимается.
   */
  targetBy?: 'id' | 'scope';
  /** Белый список колонок клиента. Всё, чего здесь нет, до БД не доезжает. */
  fields?: Record<string, FieldSpec>;
  /**
   * Колонки, которые ставит СЕРВЕР и только на вставке. `'@actor'` подставляет
   * пользователя из JWT. На обновлении не применяются: перезапись `created_by`
   * переписала бы авторство строки актором правки.
   */
  forcedOnInsert?: Record<string, unknown>;
  /**
   * RPC «строка обязана существовать», зовётся ДО записи. Для синглтона это
   * дешевле и честнее, чем городить вставку в TS: `ensure_trip_budget` уже
   * делает ровно это (и сеет категории) и уже зовётся триггером создания трипа.
   */
  prepareRpc?: string;
  /** Действию нужна существующая строка — прочитать её ДО записи (для `guardRow`). */
  loadTarget?: boolean;
  /**
   * Правило, читаемое ТОЛЬКО по существующей строке: «эта трата не ручная»,
   * «эта категория системная». Право на ресурс к этому моменту уже проверено.
   */
  guardRow?: (row: Record<string, unknown>, actor: string) => Refusal | null;
};

export type ResourceSpec = {
  name: string;
  /**
   * Чем адресуется владение строкой. `from: 'tripId'` — значение приходит из
   * тела запроса и по нему же проверяется право; `from: 'actor'` — из JWT
   * (ресурсы без трипа, напр. `user-place`).
   */
  scope: { column: string; from: 'tripId' | 'actor' };
  actions: Record<string, ActionSpec>;
};

export type WritePlan =
  | { op: 'insert'; table: string; values: Record<string, unknown> }
  | { op: 'update'; table: string; values: Record<string, unknown>; match: Record<string, unknown> }
  | { op: 'delete'; table: string; match: Record<string, unknown> }
  | { op: 'rpc'; name: string; args: Record<string, unknown> };

/** Подстановка актора в объявленные сервером колонки. */
const ACTOR_TOKEN = '@actor';

/**
 * Действие = то, что стоит в пути ПОСЛЕ слага функции.
 *
 * Берётся ПОСЛЕДНЕЕ вхождение слага: путь площадки может нести его дважды
 * (`/functions/v1/trip-budget/…`), и поиск первого вхождения сработал бы в
 * одном развёртывании и промахнулся в другом. Пустой хвост = действия нет:
 * вызов без действия обязан получить явный отказ, а не попасть молча в первое
 * попавшееся действие ресурса.
 */
export function parseAction(pathname: string, slug: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  const at = parts.lastIndexOf(slug);
  if (at === -1) return null;
  const tail = parts.slice(at + 1);
  return tail.length ? tail.join('/') : null;
}

function typeOk(spec: FieldSpec, value: unknown): boolean {
  switch (spec.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      // Строгий тип-гейт: `free_cancellation`/`day_change` — boolean-колонки БД.
      // Приведение `'true'`/`1` ЗАПРЕЩЕНО (как число не спутать со строкой): кривой
      // тип → 400, а не молчаливая коэрция к неверному значению.
      return typeof value === 'boolean';
    case 'uuid':
      return typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case 'json':
      // jsonb-ОБЪЕКТ (map): НЕ массив. `fx_overrides: []` обязан отбиться, иначе
      // массив молча заменил бы map «валюта→курс» и сбросил курсы (TRIP-399).
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      // jsonb-МАССИВ (`documents`). Элементы проверяет `validate`-хук поля.
      return Array.isArray(value);
  }
}

const bad = (message: string): Refusal => ({ status: 400, code: 'INVALID_INPUT', message });

/**
 * Вход действия: выбирает семантику обязательности (вставка/транзакция строгая,
 * частичная правка — нет) и делегирует проверку `validateFields`. Возвращает
 * ОЧИЩЕННЫЕ значения либо отказ 400.
 *
 * Кэпы дублируют CHECK в БД НАМЕРЕННО и в одну сторону: без них нарушение
 * приезжает пользователю как 500 с текстом Postgres, а не как внятное «слишком
 * длинно». БД остаётся истиной (handoff Р4 §0 — в БД целостность), edge — тем,
 * кто отвечает по-человечески.
 */
export function validateInput(
  action: ActionSpec,
  input: Record<string, unknown>,
  { isInsert }: { isInsert: boolean },
): { values: Record<string, unknown> } | Refusal {
  // `op:'insert'`/`op:'rpc'` — ВСЕГДА вставка (create-only / транзакция без id),
  // поэтому обязательность строгая независимо от `isInsert` из шва: `mutate.ts`
  // считает `isInsert` по присланному id, а хостовый клиент мог прислать инертный
  // id — тогда пропущенное обязательное поле проскочило бы к DB NOT NULL и
  // вернулось сырым 500 вместо 400 (TRIP-399). id остаётся инертным (его
  // игнорирует `buildPlan`).
  const insert = isInsert || action.op === 'insert' || action.op === 'rpc';
  return validateFields(action.fields ?? {}, input, { insert });
}

/**
 * Белый список + кэпы над ОДНИМ набором полей. Вынесен из `validateInput`, чтобы
 * `op:'rpc'` мог провалидировать вложенные объекты (каждый сегмент layover —
 * `TRANSFER_FIELDS`) ТЕМ ЖЕ движком, а не копией правил (TRIP-405). Возвращает
 * очищенные значения либо отказ 400.
 */
export function validateFields(
  fields: Record<string, FieldSpec>,
  input: Record<string, unknown>,
  { insert }: { insert: boolean },
): { values: Record<string, unknown> } | Refusal {
  const values: Record<string, unknown> = {};

  for (const [name, spec] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(input, name)) {
      if (insert && spec.required) return bad(`Field "${name}" is required`);
      continue;
    }
    const value = input[name];
    if (value === null) {
      if (!spec.nullable) return bad(`Field "${name}" must not be null`);
      values[name] = null;
      continue;
    }
    if (spec.clearOnly) return bad(`Field "${name}" can only be cleared`);
    if (!typeOk(spec, value)) return bad(`Field "${name}" must be a valid ${spec.type}`);
    if (spec.max != null && typeof value === 'string' && value.length > spec.max) {
      return bad(`Field "${name}" must be at most ${spec.max} characters`);
    }
    if (spec.min != null && typeof value === 'number' && value < spec.min) {
      return bad(`Field "${name}" must be at least ${spec.min}`);
    }
    if (spec.enum && !spec.enum.includes(value as string)) {
      return bad(`Field "${name}" must be one of: ${spec.enum.join(', ')}`);
    }
    // Доменная проверка формата — ПОСЛЕ встроенных, только на не-null значении.
    if (spec.validate) {
      const refusal = spec.validate(value);
      if (refusal) return refusal;
    }
    values[name] = value;
  }
  return { values };
}

/**
 * ПЛАН ЗАПИСИ. Единственный производитель записей в шве — поэтому скоуп здесь
 * не «не забыт», а невыразим иначе (см. шапку файла).
 */
export function buildPlan(
  resource: ResourceSpec,
  action: ActionSpec,
  ctx: {
    actor: string;
    scopeValue: string;
    targetId: string | null;
    values: Record<string, unknown>;
  },
): WritePlan {
  // `op:'rpc'` — тело действия транзакция, а не строка: аргументы даёт чистый
  // `buildArgs` (валидация уже прошла), `p_actor` инъектит ШОВ, а не клиент —
  // ровно как `forcedOnInsert:{created_by:'@actor'}` у table-DML.
  if (action.op === 'rpc') {
    if (!action.rpc) throw new Error(`${resource.name}: op:'rpc' requires an rpc name`);
    const args = action.buildArgs
      ? action.buildArgs(ctx.values, { actor: ctx.actor, scopeValue: ctx.scopeValue })
      : {};
    return { op: 'rpc', name: action.rpc, args: { ...args, p_actor: ctx.actor } };
  }

  const scopeCol = resource.scope.column;
  const table = action.table;
  if (!table) throw new Error(`${resource.name}: ${action.op} requires a table`);
  const scoped = { [scopeCol]: ctx.scopeValue };

  if (action.op === 'delete') {
    if (!ctx.targetId) throw new Error(`${resource.name}: delete requires a target id`);
    return { op: 'delete', table, match: { id: ctx.targetId, ...scoped } };
  }

  // Обновление доступно ТОЛЬКО `upsert`. `op:'insert'` (create-only) проходит
  // мимо обеих update-веток — присланный id инертен, всегда вставка (TRIP-399).
  if (action.op === 'upsert') {
    // Синглтон на скоуп: строку гарантирует `prepareRpc`, адресует её сам скоуп.
    if (action.targetBy === 'scope') {
      return { op: 'update', table, values: { ...ctx.values }, match: { ...scoped } };
    }
    if (ctx.targetId) {
      // Значения БЕЗ `forcedOnInsert`: `created_by` — авторство, а не актор правки.
      return {
        op: 'update',
        table,
        values: { ...ctx.values },
        match: { id: ctx.targetId, ...scoped },
      };
    }
  }

  const forced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(action.forcedOnInsert ?? {})) {
    forced[key] = value === ACTOR_TOKEN ? ctx.actor : value;
  }
  // Порядок намеренный: серверные колонки идут ПОСЛЕДНИМИ и побеждают клиента.
  return { op: 'insert', table, values: { ...ctx.values, ...scoped, ...forced } };
}

import { TRIP_BUDGET } from './resources/tripBudget.ts';
import { TRIP_DOCUMENT } from './resources/tripDocument.ts';
import { TRIP_BOOKING } from './resources/tripBooking.ts';
import { ACCOUNT } from './resources/account.ts';
import { USER_PLACE } from './resources/userPlace.ts';

/**
 * Все ресурсы записи. Реестр существует не ради диспетчеризации (её делает сама
 * функция), а ради СКВОЗНОГО инварианта: тест идёт по нему целиком, поэтому
 * новый ресурс проверяется на IDOR-скоуп без единой новой строки в тесте.
 */
export const REGISTRY: Record<string, ResourceSpec> = {
  [TRIP_BUDGET.name]: TRIP_BUDGET,
  [TRIP_DOCUMENT.name]: TRIP_DOCUMENT,
  [TRIP_BOOKING.name]: TRIP_BOOKING,
  [ACCOUNT.name]: ACCOUNT,
  [USER_PLACE.name]: USER_PLACE,
};
