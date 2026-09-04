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

/**
 * ЕДИНСТВЕННЫЙ конструктор бизнес-отказа спецификаций ресурсов — одна сигнатура
 * `forbid(status, code, message)` на все домены (свод 4 локальных копий, TRIP-419).
 * Раньше каждый ресурс держал СВОЙ `forbid`: половина 2-арг (403 захардкожен),
 * половина 3-арг. Гард 2v читал код по фиксированной позиции аргумента и МОЛЧА
 * промахивался мимо той конвенции, что не совпала (`ALREADY_MEMBER` и ещё пять
 * member-кодов эмитились мимо реестра при зелёном гарде). Один экспорт = одна
 * позиция кода (arg1), которую гард знает точно.
 *
 * `code` — контрактный `UPPER_SNAKE` (см. `errorCodes.ts`); `status` явный, т.к.
 * отказы домена не все 403 (409 «уже участник», 400 self/owner, 402 Pro).
 * Живёт в ЧИСТОМ модуле рядом с `Refusal`/`bad` — резолвится замыканиями
 * (`guardRow`/`mapOutcome`/`validate`), не на загрузке, поэтому циклический
 * value-импорт из ресурсов безопасен.
 */
export const forbid = (status: number, code: string, message: string): Refusal => ({
  status,
  code,
  message,
});

/**
 * ЕДИНСТВЕННАЯ форма отказа «нет, нужен Pro» — 402 + `sentrySkip` (бизнес-«нет»
 * не шумит в Sentry). Живёт в ЧИСТОМ модуле, чтобы её мог взять и I/O-гейт
 * (`proGate.ts` ре-экспортит для `proRefusal`/не-шовных функций), и `mapOutcome`
 * ресурса-спеки (`tripSettings.ts`) — БЕЗ импорта `proGate.ts` (тот тянет
 * `http.ts`→`sentry.ts`, а `deno test` идёт без `--allow-env`). Один литерал
 * 402/PRO_REQUIRED/skip на все рантаймы отказа (анти-дубль TRIP-408). */
export const PRO_REQUIRED: Refusal = {
  status: 402,
  code: 'PRO_REQUIRED',
  message: 'Pro required',
  sentrySkip: true,
};

/**
 * ЕДИНСТВЕННАЯ форма отказа «лимит трипов исчерпан» — 402 + `sentrySkip` (штатный
 * бизнес-«нет», вход в апселл, не инцидент). Живёт тут по той же причине, что
 * `PRO_REQUIRED`: её берёт и I/O-гейт (`checkRequirement('trip_quota')`), и
 * `mapOutcome` ресурса (`tripShare.copy`) — БЕЗ дубля литерала 402/кода/skip. */
export const TRIP_LIMIT_REACHED: Refusal = {
  status: 402,
  code: 'TRIP_LIMIT_REACHED',
  message: 'Trip limit reached',
  sentrySkip: true,
};

/**
 * Актор запроса, каким его знает шов из JWT: id + email. `guardRow` получает его
 * ЦЕЛИКОМ (не только id), чтобы row-self-проверку можно было выразить по email
 * (`respond` владеет инвайтом либо по `user_id`, либо по `invite_email`) —
 * авторизация по строке остаётся в edge, не уезжает в SQL (принцип эпика TRIP-374).
 */
export type Actor = { id: string; email: string | null };

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
   *
   * `none` = действие БЕЗ записи в БД: только побочка (`afterWrite`). Шов
   * проходит авторизацию/`guardRow`, но пропускает `runPlan`. Заведено под
   * `resend` (чистое re-emit уведомления, данных нет) — модель «действие-только-
   * побочка». Не «пустая RPC-обёртка» (TRIP-405): RPC писал бы транзакцию, а
   * здесь записи нет ВООБЩЕ. Универсально: любое будущее notify-only действие.
   */
  op: 'upsert' | 'insert' | 'delete' | 'rpc' | 'none';
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
    ctx: { actor: string; scopeValue: string; targetId: string | null },
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
   * «эта категория системная», «инвайт принадлежит мне (`user_id`/`invite_email`)».
   * Право на ресурс (гейт `requires`) к этому моменту уже проверено; когда
   * `requires:[]`, `guardRow` — ЕДИНСТВЕННАЯ авторизация действия (row-self-дверь),
   * поэтому её обязательность форсит инвариант №7 (`assertGuardedRegistry`).
   * Получает ПОЛНОГО актора `{id, email}`, а не только id (row-self по email).
   */
  guardRow?: (row: Record<string, unknown>, actor: Actor) => Refusal | null;
  /**
   * Только `op:'rpc'`. Переводит ДИСКРИМИНИРОВАННЫЙ результат RPC (`data.outcome`)
   * в ответ шва: либо бизнес-`Refusal` (409/400 — «уже участник»/self/owner), либо
   * `{ data }` = успех с полезной нагрузкой. Бизнес-«нет» здесь — это ЗНАЧЕНИЕ
   * `data`, а НЕ ошибка БД (инвариант `unwrapDbResult`: `unique_violation` дал бы
   * 500). Чистая функция (как `buildArgs`) — пинится тестом без загрузки клиента.
   */
  mapOutcome?: (data: unknown) => Refusal | { data: unknown };
  /**
   * Действие пере-раскладывает даты всего трипа (запись трансфера: `day_span`
   * города двигает через триггер `trg_recompute_transfer` / RPC layover). Тогда
   * шов после записи прикладывает к ответу АВТОРИТЕТНУЮ цепочку `city_visits`
   * (`_trip_city_chain(scope)`) — как это делают route-RPC (add_city/reorder,
   * TRIP-435): клиент реконсилит даты из ОДНОГО ответа (`reconcileCityChain`), а не
   * отдельным рефетчем. Форма ответа таких действий = `{ row, cities }` (см.
   * `mutate.ts`). Ставится ТОЛЬКО на ресурсах, чья запись реально трогает маршрут
   * (transfer); листья (hotel/activity/service) дат не двигают → флага нет.
   */
  returnChain?: boolean;
  /**
   * Запись действия ЗЕРКАЛИТСЯ триггером БД в траты бюджета (`sync_budget_expense`
   * на 4 booking-таблицах: INSERT/UPDATE/DELETE ведут строку `budget_expenses` с
   * `source_kind`/`source_id`). Зеркало считает БД — единственный писатель, — а
   * клиент про него не знает вовсе: срез `budgetExpenses` жил в кэше до рефетча, и
   * удалённая бронь оставалась тратой, а созданная не появлялась (TRIP-484). Тогда
   * шов после записи дочитывает АВТОРИТЕТНЫЙ набор трат трипа и прикладывает его к
   * ответу — ровно как `returnChain` прикладывает пересчитанные города: клиент
   * заменяет срез из ОДНОГО ответа, не повторяя на себе логику триггера.
   *
   * Форма ответа с любым из двух флагов = конверт `{ row, cities, transfers, expenses }`
   * (незапрошенные части — `null`; см. `mutate.ts`). Ставится на ВСЕ действия, чья
   * таблица под триггером зеркала.
   */
  returnExpenses?: boolean;
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
  | { op: 'rpc'; name: string; args: Record<string, unknown> }
  // `none` — записи нет: `runPlan` не вызывается, шов идёт сразу в `afterWrite`.
  | { op: 'none' };

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

/**
 * UUID-предикат шва — ОДИН источник паттерна: `typeOk` для `type:'uuid'` и
 * валидатор массива uuid (`tripRoute.uuidArray`) сверяются с ним же.
 *
 * Сам предикат переехал в `_shared/uuid.ts` и реэкспортируется отсюда: он нужен
 * и функциям, которые в нашу БД не пишут вовсе, а тащить в них весь реестр
 * ресурсов ради одной регулярки — цена холодного старта (TRIP-513). Импортёры
 * шва не тронуты: имя доступно там же, где было.
 */
// ⚠️ ИМПОРТ + РЕЭКСПОРТ, а не `export … from`. Чистый `export { x } from '…'`
// делает имя видимым СНАРУЖИ, но НЕ вносит его в область видимости этого модуля,
// а `typeOk` ниже зовёт `isUuid` у себя. Ошибка не ловится ни `npm run
// typecheck` (tsc идёт по `jsconfig.json`, то есть по `src/**` — edge-функции в
// него не входят), ни eslint, ни тестами: её видит только джоба «Deno typecheck
// (edge functions)», то есть уже в CI (TRIP-513, разбор упавшего деплоя).
import { isUuid } from './uuid.ts';
export { isUuid };

function typeOk(spec: FieldSpec, value: unknown): boolean {
  switch (spec.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      // Строгий тип-гейт: `free_cancellation` — boolean-колонка БД.
      // Приведение `'true'`/`1` ЗАПРЕЩЕНО (как число не спутать со строкой): кривой
      // тип → 400, а не молчаливая коэрция к неверному значению.
      return typeof value === 'boolean';
    case 'uuid':
      return isUuid(value);
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

export const bad = (message: string): Refusal => ({ status: 400, code: 'INVALID_INPUT', message });

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
 * Валидатор jsonb-МАССИВА ОБЪЕКТОВ: каждый элемент проходит ТЕМ ЖЕ движком
 * (`validateFields`, insert-семантика), что и одиночная запись, — не копия правил
 * (TRIP-405). Возвращает хук для `FieldSpec.validate`. Переиспользуют booking
 * (waypoints/segments) и trip.create (cities) — один разбор массива на все.
 */
export function validateEach(fields: Record<string, FieldSpec>, label: string) {
  return (value: unknown): Refusal | null => {
    if (!Array.isArray(value)) return bad(`Field "${label}" must be a list`);
    for (const item of value) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return bad(`Each ${label} entry must be an object`);
      }
      const r = validateFields(fields, item as Record<string, unknown>, { insert: true });
      if ('status' in r) return r;
    }
    return null;
  };
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
  // `op:'none'` — записи нет (`resend`): плана-записи не существует, шов пропустит
  // `runPlan` и пойдёт сразу в `afterWrite`. Sweep-тест реестра это пропускает
  // (план не update/delete), скоуп проверять не на чем.
  if (action.op === 'none') return { op: 'none' };

  // `op:'rpc'` — тело действия транзакция, а не строка: аргументы даёт чистый
  // `buildArgs` (валидация уже прошла), `p_actor` инъектит ШОВ, а не клиент —
  // ровно как `forcedOnInsert:{created_by:'@actor'}` у table-DML.
  if (action.op === 'rpc') {
    if (!action.rpc) throw new Error(`${resource.name}: op:'rpc' requires an rpc name`);
    const args = action.buildArgs
      ? action.buildArgs(ctx.values, { actor: ctx.actor, scopeValue: ctx.scopeValue, targetId: ctx.targetId })
      : {};
    return { op: 'rpc', name: action.rpc, args: { ...args, p_actor: ctx.actor } };
  }

  const scopeCol = resource.scope.column;
  const table = action.table;
  if (!table) throw new Error(`${resource.name}: ${action.op} requires a table`);
  const scoped = { [scopeCol]: ctx.scopeValue };

  if (action.op === 'delete') {
    // Синглтон на скоуп: строку адресует сам скоуп (`trips` по `id`), id не нужен
    // и не принимается — симметрия с upsert+`targetBy:'scope'` ниже. Любой
    // «удали строку-по-скоупу» (trip-owner/delete: удаление самого трипа, TRIP-416).
    if (action.targetBy === 'scope') return { op: 'delete', table, match: { ...scoped } };
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

/**
 * Зеркало CHECK семейства `*_link_url` / `*_documents_urls` (`^https?://`) —
 * ОБЩИЙ дом рядом с `bad`/валидаторами, а не копия в каждом ресурсе. `javascript:`
 * в ссылке = stored XSS (TRIP-281); БД держит CHECK, шов зеркалит его внятным 400.
 * Реюзают `trip-document` (link_url + documents) и `trip-booking` (booking_url +
 * documents/details). Зовутся только внутри `validate`-замыканий (request-time),
 * поэтому цикл `mutateRules ⇄ resources` безопасен (как `forbid`/`validateEach`).
 */
export const HTTP_URL = /^https?:\/\//i;

/**
 * `documents` — jsonb-МАССИВ объектов файла. CHECK `*_documents_urls` требует
 * `$[*].file_url` matchить `^https?://` (иначе `javascript:`-ссылка = stored XSS,
 * TRIP-281). Зеркалим поэлементно; прочие поля объекта БД не проверяет.
 */
export function validateDocuments(value: unknown): Refusal | null {
  if (!Array.isArray(value)) return bad('Field "documents" must be a list');
  for (const item of value) {
    const url = (item as { file_url?: unknown })?.file_url;
    if (typeof url !== 'string' || !HTTP_URL.test(url)) {
      return bad('Every document file_url must be an http(s) URL');
    }
  }
  return null;
}

import { TRIP_BUDGET } from './resources/tripBudget.ts';
import { TRIP_DOCUMENT } from './resources/tripDocument.ts';
import { TRIP_BOOKING } from './resources/tripBooking.ts';
import { TRIP_ROUTE } from './resources/tripRoute.ts';
import { TRIP } from './resources/trip.ts';
import { ACCOUNT } from './resources/account.ts';
import { USER_PLACE } from './resources/userPlace.ts';
import { TRIP_CHAT } from './resources/tripChat.ts';
import { INBOX } from './resources/inbox.ts';
import { TRIP_MEMBER } from './resources/tripMember.ts';
import { TRIP_MEMBER_SELF } from './resources/tripMemberSelf.ts';
import { TRIP_INVITE_LINK } from './resources/tripInviteLink.ts';
import { TRIP_SETTINGS } from './resources/tripSettings.ts';
import { TRIP_OWNER } from './resources/tripOwner.ts';
import { TRIP_SHARE } from './resources/tripShare.ts';

/**
 * Все ресурсы записи. Реестр существует не ради диспетчеризации (её делает сама
 * функция), а ради СКВОЗНОГО инварианта: тест идёт по нему целиком, поэтому
 * новый ресурс проверяется на IDOR-скоуп без единой новой строки в тесте.
 */
export const REGISTRY: Record<string, ResourceSpec> = {
  [TRIP_BUDGET.name]: TRIP_BUDGET,
  [TRIP_DOCUMENT.name]: TRIP_DOCUMENT,
  [TRIP_BOOKING.name]: TRIP_BOOKING,
  [TRIP_ROUTE.name]: TRIP_ROUTE,
  [TRIP.name]: TRIP,
  [ACCOUNT.name]: ACCOUNT,
  [USER_PLACE.name]: USER_PLACE,
  [TRIP_CHAT.name]: TRIP_CHAT,
  [INBOX.name]: INBOX,
  [TRIP_MEMBER.name]: TRIP_MEMBER,
  [TRIP_MEMBER_SELF.name]: TRIP_MEMBER_SELF,
  [TRIP_INVITE_LINK.name]: TRIP_INVITE_LINK,
  [TRIP_SETTINGS.name]: TRIP_SETTINGS,
  [TRIP_OWNER.name]: TRIP_OWNER,
  [TRIP_SHARE.name]: TRIP_SHARE,
};

/**
 * ИНВАРИАНТ №7 (foot-gun-гард). Действие с ПУСТЫМ гейтом `requires:[]` (row-self-
 * дверь: авторизация — только по строке через `guardRow`) и с ЗАПИСЬЮ
 * (`delete`/`update`/`upsert`/`rpc`) ОБЯЗАНО иметь `loadTarget:true` + `guardRow`.
 * Иначе опечатка (забыли `guardRow`) = запись без какой-либо авторизации — а
 * гарды скоупа ловят IDOR («чужой id»), не «дверь без замка». `op:'none'` не
 * пишет → под инвариант не попадает. Возвращает список нарушений (пустой = чисто);
 * пинится тестом по ВСЕМУ REGISTRY, поэтому новый ресурс проверяется сам, и
 * зовётся швом на загрузке (`mutate.ts`) как рантайм-ремень.
 */
export function findUnguardedRowSelf(
  registry: Record<string, ResourceSpec> = REGISTRY,
): string[] {
  const bad: string[] = [];
  for (const resource of Object.values(registry)) {
    for (const [name, action] of Object.entries(resource.actions)) {
      const writes = action.op === 'delete' || action.op === 'upsert' || action.op === 'rpc';
      if (action.requires.length === 0 && writes && !(action.loadTarget && action.guardRow)) {
        bad.push(
          `${resource.name}/${name}: requires:[] + запись (${action.op}) без loadTarget+guardRow = дверь без замка (инвариант №7)`,
        );
      }
    }
  }
  return bad;
}
