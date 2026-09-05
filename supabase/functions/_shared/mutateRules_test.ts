/**
 * TRIP-394 Ф2 — правило записи, закреплённое машиной.
 *
 * Здесь пинится ЧИСТАЯ половина шва (`mutateRules.ts`): разбор действия из
 * пути, валидация входа и — главное — ПОСТРОЕНИЕ ПЛАНА ЗАПИСИ. I/O-половина
 * (`mutate.ts`) держит клиента БД и потому из теста не подгружается вовсе:
 * `deno test` идёт без `--allow-env`, а `_shared/supabaseAdmin.ts` читает env
 * ПРЯМО на загрузке модуля. Тот же раскол, что `tripStep.ts` ↔ `tripAccess.ts`.
 *
 * ★ ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ — один инвариант важнее остальных.
 * Сегодня строку защищает RLS: политика `_can_edit_trip(trip_id, auth.uid())`
 * привязывает строку к трипу БЕСПЛАТНО. Под `service_role` RLS не действует, и
 * `update ... where id = <id клиента>` становится IDOR: редактор трипа A правит
 * трату трипа B, передав её id. Ни один гард репозитория этого не видит —
 * дифф выглядит нормально, тесты прав зелёные, экран работает.
 * Поэтому скоуп внедряет САМ построитель плана, а не автор хендлера
 * (handoff §7.3: «проверка обязана быть невозможной забыть по конструкции»), а
 * тест `★ ни одно действие реестра не строит update/delete без скоупа`
 * проходит по ВСЕМУ реестру ресурсов — новое действие попадает под него само.
 *
 * Чего здесь НЕТ (сознательно, не выдаём за покрытие): что edge реально
 * отдаёт 403 живому viewer'у — это свойство запущенной функции, а не правила.
 *
 * Запуск: deno test supabase/functions/_shared/mutateRules_test.ts
 */

import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.8';
import {
  buildPlan,
  findUnguardedRowSelf,
  parseAction,
  REGISTRY,
  unwrapDbResult,
  validateFields,
  validateInput,
  type ActionSpec,
  type FieldSpec,
  type ResourceSpec,
} from './mutateRules.ts';

const ACTOR = 'actor-uuid';
const TRIP = 'trip-uuid';

/** Тестовый ресурс: держит формы, которых нет у бюджета, но будут у соседей. */
const SAMPLE: ResourceSpec = {
  name: 'sample',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    thing: {
      op: 'upsert',
      table: 'things',
      requires: ['editor'],
      fields: {
        title: { type: 'string', required: true, max: 300 },
        notes: { type: 'string', max: 10, nullable: true },
        amount: { type: 'number', min: 0, nullable: true },
        kind: { type: 'string', enum: ['a', 'b'] },
      },
      forcedOnInsert: { created_by: '@actor', source_kind: 'manual', source_id: null },
    },
    'thing/delete': { op: 'delete', table: 'things', requires: ['editor'] },
  },
};

// ── Инвариант DB-вызова шва (TRIP-394 ②) ─────────────────────────────────────

Deno.test('★ ошибка БД → throw (инфра-сбой, НЕ бизнес-ответ)', () => {
  // Мутация «убрать `if (result.error) throw`» роняет этот тест: без него сбой БД
  // вернул бы `data` (тут null) и выродился в 402/404 — ровно то, что ② чинит.
  const dbError = { code: '57014', message: 'statement timeout' };
  assertThrows(
    () => unwrapDbResult({ data: null, error: dbError }),
    'сбой БД обязан бросить, а не вернуть данные',
  );
});

Deno.test('★ бизнес-false — это ДАННЫЕ, а не ошибка (is_trip_pro вернул false)', () => {
  // Настоящий `data === false` (не Pro) обязан ДОЕХАТЬ до вызывающего, а не
  // слиться со сбоем: смешение этих двух и есть баг, который закрывает обёртка.
  assertEquals(unwrapDbResult({ data: false, error: null }), false);
  assertEquals(unwrapDbResult({ data: true, error: null }), true);
});

Deno.test('нет ошибки → возвращает data как есть (в т.ч. null от void-RPC)', () => {
  assertEquals(unwrapDbResult({ data: null, error: null }), null);
  assertEquals(unwrapDbResult({ data: { ok: 1 }, error: null }), { ok: 1 });
});

// ── Разбор действия из пути ──────────────────────────────────────────────────

Deno.test('действие берётся из пути ПОСЛЕ слага функции', () => {
  assertEquals(parseAction('/trip-budget/expense', 'trip-budget'), 'expense');
  assertEquals(parseAction('/functions/v1/trip-budget/expense', 'trip-budget'), 'expense');
});

Deno.test('вложенное действие сохраняется целиком', () => {
  assertEquals(parseAction('/trip-budget/expense/delete', 'trip-budget'), 'expense/delete');
});

Deno.test('слаг функции сам по себе действием НЕ является', () => {
  // Иначе вызов без действия молча попал бы в первое попавшееся.
  assertEquals(parseAction('/trip-budget', 'trip-budget'), null);
  assertEquals(parseAction('/trip-budget/', 'trip-budget'), null);
});

Deno.test('★ слаг, встретившийся в ЗНАЧЕНИИ пути, не сдвигает разбор', () => {
  // Берём ПОСЛЕДНЕЕ вхождение слага: префикс площадки может повторять имя.
  assertEquals(parseAction('/trip-budget/trip-budget/expense', 'trip-budget'), 'expense');
});

// ── Валидация входа ──────────────────────────────────────────────────────────

const thing = SAMPLE.actions.thing;

Deno.test('обязательное поле отсутствует на вставке → 400 с ИМЕНЕМ поля', () => {
  const r = validateInput(thing, {}, { isInsert: true });
  assert('status' in r, 'ожидался отказ');
  assertEquals(r.status, 400);
  assertEquals(r.code, 'INVALID_INPUT');
  assert(r.message.includes('title'), `в сообщении нет имени поля: ${r.message}`);
});

Deno.test('на ОБНОВЛЕНИИ обязательность не требуется (частичная правка)', () => {
  const r = validateInput(thing, { notes: 'x' }, { isInsert: false });
  assert(!('status' in r), 'частичная правка не должна отвергаться');
});

Deno.test('кэп длины строки = кэп CHECK в БД', () => {
  const ok = validateInput(thing, { title: 'a'.repeat(300) }, { isInsert: true });
  assert(!('status' in ok), 'ровно кэп — это ещё можно');
  const bad = validateInput(thing, { title: 'a'.repeat(301) }, { isInsert: true });
  assert('status' in bad && bad.status === 400, 'кэп+1 обязан быть отвергнут');
});

Deno.test('отрицательное число отвергается (CHECK >= 0)', () => {
  const r = validateInput(thing, { title: 't', amount: -1 }, { isInsert: true });
  assert('status' in r && r.status === 400);
});

Deno.test('значение вне enum отвергается', () => {
  const r = validateInput(thing, { title: 't', kind: 'z' }, { isInsert: true });
  assert('status' in r && r.status === 400);
});

Deno.test('null проходит только там, где поле объявлено nullable', () => {
  const ok = validateInput(thing, { title: 't', notes: null }, { isInsert: true });
  assert(!('status' in ok));
  const bad = validateInput(thing, { title: null }, { isInsert: true });
  assert('status' in bad && bad.status === 400);
});

Deno.test('★ НЕОБЪЯВЛЕННЫЙ ключ не доезжает до БД', () => {
  // Белый список — единственное, что не даёт клиенту писать служебные колонки.
  const r = validateInput(thing, { title: 't', source_kind: 'hotel', created_by: 'someone' }, {
    isInsert: true,
  });
  assert(!('status' in r), 'лишний ключ не ошибка, он просто отбрасывается');
  assertEquals(r.values, { title: 't' });
});

Deno.test('строка там, где ждали число, — отказ, а не тихое приведение', () => {
  const r = validateInput(thing, { title: 't', amount: '5' }, { isInsert: true });
  assert('status' in r && r.status === 400);
});

Deno.test('★ clearOnly: обнулить можно, ПРИСВОИТЬ нельзя', () => {
  // `budget_categories.system_key`: отвязать переименованную категорию законно,
  // а забрать себе чужой системный ключ — нет (по нему роутятся автотраты).
  const withClearOnly: ActionSpec = {
    op: 'upsert',
    table: 'things',
    requires: [],
    fields: { system_key: { type: 'string', clearOnly: true, nullable: true } },
  };
  const cleared = validateInput(withClearOnly, { system_key: null }, { isInsert: false });
  assert(!('status' in cleared), 'обнуление обязано проходить');
  assertEquals(cleared.values, { system_key: null });

  const claimed = validateInput(withClearOnly, { system_key: 'accommodation' }, {
    isInsert: false,
  });
  assert('status' in claimed && claimed.status === 400, 'присвоение обязано быть отвергнуто');
});

// ── Построение плана ─────────────────────────────────────────────────────────

Deno.test('вставка: скоуп и серверные колонки ставит СЕРВЕР', () => {
  const plan = buildPlan(SAMPLE, thing, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: null,
    values: { title: 't' },
  });
  assert(plan.op === 'insert');
  assertEquals(plan.table, 'things');
  assertEquals(plan.values, {
    title: 't',
    trip_id: TRIP,
    created_by: ACTOR,
    source_kind: 'manual',
    source_id: null,
  });
});

Deno.test('★ клиент не может подменить серверную колонку', () => {
  // Ключи не в `fields` уже отброшены валидацией; здесь пинится, что даже если
  // они дойдут до построителя, побеждает сервер.
  const plan = buildPlan(SAMPLE, thing, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: null,
    values: { title: 't', created_by: 'someone-else', trip_id: 'other-trip' } as never,
  });
  assert(plan.op === 'insert');
  assertEquals(plan.values.created_by, ACTOR);
  assertEquals(plan.values.trip_id, TRIP);
});

Deno.test('★ ОБНОВЛЕНИЕ скоупится трипом, а не только id (IDOR)', () => {
  const plan = buildPlan(SAMPLE, thing, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: 'row-1',
    values: { title: 't' },
  });
  assertEquals(plan.op, 'update');
  assert(plan.op === 'update');
  assertEquals(plan.match, { id: 'row-1', trip_id: TRIP });
});

Deno.test('★ обновление НЕ переписывает автора строки', () => {
  const plan = buildPlan(SAMPLE, thing, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: 'row-1',
    values: { title: 't' },
  });
  assert(plan.op === 'update');
  assertEquals(plan.values.created_by, undefined, 'created_by ставится только на вставке');
  assertEquals(plan.values.source_kind, undefined);
});

Deno.test('★ УДАЛЕНИЕ скоупится трипом, а не только id (IDOR)', () => {
  const plan = buildPlan(SAMPLE, SAMPLE.actions['thing/delete'], {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: 'row-1',
    values: {},
  });
  assertEquals(plan.op, 'delete');
  assert(plan.op === 'delete');
  assertEquals(plan.match, { id: 'row-1', trip_id: TRIP });
});

Deno.test('скоуп из АКТОРА (ресурс без трипа) работает тем же построителем', () => {
  const selfScoped: ResourceSpec = {
    name: 'user-place',
    scope: { column: 'user_id', from: 'actor' },
    actions: {
      place: { op: 'upsert', table: 'user_custom_visits', requires: ['self'], fields: {} },
    },
  };
  const plan = buildPlan(selfScoped, selfScoped.actions.place, {
    actor: ACTOR,
    scopeValue: ACTOR,
    targetId: 'row-1',
    values: {},
  });
  assert(plan.op === 'update');
  assertEquals(plan.match, { id: 'row-1', user_id: ACTOR });
});

Deno.test('★ синглтон адресуется СКОУПОМ, а присланный id игнорируется', () => {
  const singleton: ActionSpec = {
    op: 'upsert',
    table: 'trip_budgets',
    targetBy: 'scope',
    requires: ['editor'],
    fields: {},
  };
  const plan = buildPlan(SAMPLE, singleton, {
    actor: ACTOR,
    scopeValue: TRIP,
    // Клиент прислал чужой id — синглтон обязан его не заметить, иначе это
    // ровно тот же IDOR, только через другую дверь.
    targetId: 'someone-elses-budget-row',
    values: {},
  });
  assert(plan.op === 'update');
  assertEquals(plan.match, { trip_id: TRIP });
});

// ── op:'insert' — create-only (TRIP-399, приёмка блока 2) ────────────────────

const INSERT_ONLY: ActionSpec = {
  op: 'insert',
  table: 'things',
  requires: ['editor'],
  fields: { title: { type: 'string', required: true, max: 300 } },
  forcedOnInsert: { created_by: '@actor' },
};

Deno.test('★ op:insert ВСЕГДА вставка — присланный id не превращает её в UPDATE', () => {
  // Create-only: клиент, приславший чужой id, не должен уехать в UPDATE — иначе
  // редактор правил бы чужую SHARED-строку через её id (guardRow пускает shared
  // любому editor) = регресс TRIP-118. Ветка insert стоит ДО разбора targetId,
  // поэтому присланный id инертен.
  const plan = buildPlan(SAMPLE, INSERT_ONLY, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: 'someone-elses-row',
    values: { title: 't' },
  });
  assert(plan.op === 'insert', `op:insert обязан строить insert, получили ${plan.op}`);
  assertEquals(plan.values, { title: 't', trip_id: TRIP, created_by: ACTOR });
});

Deno.test('op:insert без id — обычная вставка со скоупом и сервер-колонками', () => {
  const plan = buildPlan(SAMPLE, INSERT_ONLY, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: null,
    values: { title: 't' },
  });
  assert(plan.op === 'insert');
  assertEquals(plan.values.created_by, ACTOR);
  assertEquals(plan.values.trip_id, TRIP);
});

// ── validate-хук поля (TRIP-399) ─────────────────────────────────────────────

const WITH_VALIDATE: ActionSpec = {
  op: 'insert',
  table: 'things',
  requires: [],
  fields: {
    link: {
      type: 'string',
      nullable: true,
      validate: (v) =>
        typeof v === 'string' && /^https?:\/\//i.test(v)
          ? null
          : { status: 400, code: 'INVALID_INPUT', message: 'link must be http(s)' },
    },
  },
};

Deno.test('★ validate-хук отвергает невалидное значение (внятный 400, не сырой 500 БД)', () => {
  // Без хука кривой URL долетел бы до DB-CHECK и вернулся 500 с текстом Postgres
  // (регресс честных ответов, TRIP-378). Хук зеркалит CHECK и отвечает 400.
  const r = validateInput(WITH_VALIDATE, { link: 'javascript:alert(1)' }, { isInsert: true });
  assert('status' in r && r.status === 400, 'кривой URL обязан отбиться 400');
});

Deno.test('validate-хук пропускает валидное значение', () => {
  const ok = validateInput(WITH_VALIDATE, { link: 'https://x.test/a' }, { isInsert: true });
  assert(!('status' in ok));
  assertEquals(ok.values, { link: 'https://x.test/a' });
});

Deno.test('validate-хук НЕ зовётся для null (nullable гасит раньше)', () => {
  // Иначе каждый хук обязан был бы вручную пропускать null — nullable уже решает.
  const ok = validateInput(WITH_VALIDATE, { link: null }, { isInsert: true });
  assert(!('status' in ok));
  assertEquals(ok.values, { link: null });
});

// ── jsonb-МАССИВ доезжает до хука (TRIP-399) ─────────────────────────────────

const WITH_ARRAY: ActionSpec = {
  op: 'insert',
  table: 'things',
  requires: [],
  fields: {
    items: {
      type: 'array',
      nullable: true,
      validate: (v) =>
        Array.isArray(v) &&
          v.every((x) => typeof (x as { file_url?: unknown })?.file_url === 'string' &&
            /^https?:\/\//i.test((x as { file_url: string }).file_url))
          ? null
          : { status: 400, code: 'INVALID_INPUT', message: 'bad items' },
    },
  },
};

const BUDGET_SETTINGS: ActionSpec = {
  op: 'upsert',
  table: 'trip_budgets',
  requires: [],
  fields: { fx_overrides: { type: 'json' } },
};

Deno.test('type:array принимает jsonb-МАССИВ (documents доезжает до хука)', () => {
  const ok = validateInput(WITH_ARRAY, { items: [{ file_url: 'https://a.test/f' }] }, {
    isInsert: true,
  });
  assert(!('status' in ok), 'массив объектов обязан пройти тип-гейт');
});

Deno.test('type:array отвергает ОБЪЕКТ (не спутать map и список)', () => {
  const r = validateInput(WITH_ARRAY, { items: {} }, { isInsert: true });
  assert('status' in r && r.status === 400);
});

Deno.test('type:array отвергает строку', () => {
  const r = validateInput(WITH_ARRAY, { items: 'nope' }, { isInsert: true });
  assert('status' in r && r.status === 400);
});

Deno.test('★ type:array — сам ТИП-ГЕЙТ отвергает объект (без validate-хука)', () => {
  // Пинит строгость типа отдельно от хука: у поля без validate объект обязан
  // отбиться самим тип-гейтом, иначе array и json неразличимы.
  const noValidate: ActionSpec = {
    op: 'insert',
    table: 'things',
    requires: [],
    fields: { xs: { type: 'array', nullable: true } },
  };
  assert('status' in validateInput(noValidate, { xs: {} }, { isInsert: true }), 'объект → 400');
  assert(!('status' in validateInput(noValidate, { xs: [1, 2] }, { isInsert: true })), 'массив → ok');
});

Deno.test('type:json принимает ОБЪЕКТ (fx_overrides)', () => {
  const ok = validateInput(BUDGET_SETTINGS, { fx_overrides: { EUR: 1.1 } }, { isInsert: false });
  assert(!('status' in ok));
});

Deno.test('★ type:json ОТВЕРГАЕТ массив (fx_overrides: [] не сбросит курсы — регресс соседнего домена)', () => {
  // Если бы json принимал массив, `fx_overrides: []` прошёл бы и молча заменил
  // map «валюта→курс» пустым массивом. Тип-гейт обязан это отбить.
  const r = validateInput(BUDGET_SETTINGS, { fx_overrides: [] }, { isInsert: false });
  assert('status' in r && r.status === 400, 'массив в json-поле обязан отбиться');
});

// ── op:insert валидируется как ВСТАВКА даже при инертном id (TRIP-399) ────────

Deno.test('★ op:insert требует обязательные поля даже когда isInsert=false (инертный id)', () => {
  // Шов считает isInsert по присланному id; op:insert его игнорирует, но
  // обязательность обязана держаться, иначе пропуск title = сырой 500 от DB.
  const r = validateInput(INSERT_ONLY, {}, { isInsert: false });
  assert('status' in r && r.status === 400, 'op:insert без title обязан вернуть 400');
  assert(r.message.includes('title'), `в сообщении нет имени поля: ${r.message}`);
});

Deno.test('upsert при isInsert=false обязательность НЕ требует (частичная правка)', () => {
  // Контроль: у обычного upsert-обновления частичная правка законна — фикс ②
  // не должен захватить update-режим.
  const r = validateInput(thing, { notes: 'x' }, { isInsert: false });
  assert(!('status' in r), 'частичная правка upsert не должна отвергаться');
});

// ── trip-document: спецификация домена (TRIP-399) ────────────────────────────

import { TRIP_DOCUMENT } from './resources/tripDocument.ts';

const DOC = TRIP_DOCUMENT.actions.doc;
const DOC_DELETE = TRIP_DOCUMENT.actions['doc/delete'];

Deno.test('★ doc — create-only: присланный id игнорируется (регресс TRIP-118)', () => {
  const plan = buildPlan(TRIP_DOCUMENT, DOC, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: 'a-shared-doc-of-another-user',
    values: { title: 't', visibility: 'private' },
  });
  assert(plan.op === 'insert', 'создание дока не должно уметь UPDATE');
  assertEquals(plan.values.created_by, ACTOR, 'created_by ставит сервер, не клиент');
  assertEquals(plan.values.trip_id, TRIP);
});

// guardRow получает ПОЛНОГО актора `{id,email}` (TRIP-409), владение — по `actor.id`.
const ACTOR_OBJ = { id: ACTOR, email: 'actor@example.com' };

Deno.test('★ guardRow: чужой ЛИЧНЫЙ док удалить нельзя', () => {
  const r = DOC_DELETE.guardRow!({ visibility: 'private', created_by: 'someone-else' }, ACTOR_OBJ);
  assert(r && r.status === 403 && r.code === 'DOC_PRIVATE_NOT_OWNER', `ожидался 403, ${JSON.stringify(r)}`);
});

Deno.test('guardRow: СВОЙ личный док удалить можно', () => {
  assertEquals(DOC_DELETE.guardRow!({ visibility: 'private', created_by: ACTOR }, ACTOR_OBJ), null);
});

Deno.test('guardRow: ОБЩИЙ док удаляет любой редактор', () => {
  assertEquals(DOC_DELETE.guardRow!({ visibility: 'shared', created_by: 'someone-else' }, ACTOR_OBJ), null);
});

Deno.test('★ link_url без http(s)-схемы отвергается (зеркало CHECK td_link_url_scheme)', () => {
  const r = validateInput(DOC, { title: 't', link_url: 'javascript:alert(1)' }, { isInsert: true });
  assert('status' in r && r.status === 400, 'javascript: обязан отбиться');
  const ok = validateInput(DOC, { title: 't', link_url: 'https://a.test/x' }, { isInsert: true });
  assert(!('status' in ok), 'валидный https обязан пройти');
});

Deno.test('★ documents[].file_url без http(s) отвергается (антивзлом TRIP-281)', () => {
  const bad = validateInput(DOC, {
    title: 't',
    documents: [{ file_url: 'https://ok.test/a' }, { file_url: 'javascript:evil' }],
  }, { isInsert: true });
  assert('status' in bad && bad.status === 400, 'кривой file_url обязан отбиться');
  const ok = validateInput(DOC, {
    title: 't',
    documents: [{ file_url: 'https://ok.test/a', file_name: 'a.pdf' }],
  }, { isInsert: true });
  assert(!('status' in ok), 'валидный массив файлов обязан пройти');
});

Deno.test('documents — ОБЪЕКТ вместо массива отвергается (type:array)', () => {
  const r = validateInput(DOC, { title: 't', documents: {} }, { isInsert: true });
  assert('status' in r && r.status === 400, 'documents: {} обязан отбиться');
});

Deno.test('title обязателен на создании, кэп 300 = CHECK', () => {
  const miss = validateInput(DOC, { visibility: 'shared' }, { isInsert: true });
  assert('status' in miss, 'без title создание отбивается');
  const over = validateInput(DOC, { title: 'x'.repeat(301) }, { isInsert: true });
  assert('status' in over && over.status === 400, 'title 301 отбивается');
});

// ── op:'rpc' — транзакция за одной дверью (TRIP-405) ─────────────────────────

/** Фрагмент колонок сегмента — общий для простого transfer И per-segment layover. */
const SEGMENT_FIELDS: Record<string, FieldSpec> = {
  transport_type: { type: 'string', enum: ['plane', 'train', 'car'] },
  price: { type: 'number', min: 0, nullable: true },
};

/**
 * RPC-действие-образец: маппит валидированный вход в `p_`-аргументы, per-segment
 * валидацию делает ТЕМ ЖЕ `validateFields`, что и простой transfer (не копия).
 */
const RPC_ACTION: ActionSpec = {
  op: 'rpc',
  rpc: 'add_layover_transfer',
  requires: ['editor'],
  fields: {
    from_city_visit_id: { type: 'uuid', required: true },
    to_city_visit_id: { type: 'uuid', required: true },
    segments: {
      type: 'array',
      required: true,
      validate: (v) => {
        if (!Array.isArray(v)) return { status: 400, code: 'INVALID_INPUT', message: 'segments must be a list' };
        for (const seg of v) {
          const r = validateFields(SEGMENT_FIELDS, seg as Record<string, unknown>, { insert: true });
          if ('status' in r) return r;
        }
        return null;
      },
    },
  },
  buildArgs: (values, ctx) => ({
    p_trip: ctx.scopeValue,
    p_from: values.from_city_visit_id,
    p_to: values.to_city_visit_id,
    p_segments: values.segments,
  }),
};

Deno.test('★ op:rpc — buildPlan строит { op:rpc, name, args } с p_actor от ШВА', () => {
  const validated = validateInput(RPC_ACTION, {
    from_city_visit_id: '11111111-1111-1111-1111-111111111111',
    to_city_visit_id: '22222222-2222-2222-2222-222222222222',
    segments: [{ transport_type: 'train', price: 10 }],
  }, { isInsert: true });
  assert(!('status' in validated), 'валидный layover обязан пройти');
  const plan = buildPlan(SAMPLE, RPC_ACTION, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: null,
    values: validated.values,
  });
  assert(plan.op === 'rpc', `ожидался rpc-план, получили ${plan.op}`);
  assertEquals(plan.name, 'add_layover_transfer');
  // p_actor инъектит движок, клиент его не называет; p_trip = скоуп.
  assertEquals(plan.args.p_actor, ACTOR);
  assertEquals(plan.args.p_trip, TRIP);
  assertEquals(plan.args.p_from, '11111111-1111-1111-1111-111111111111');
  assertEquals((plan.args.p_segments as unknown[]).length, 1);
});

Deno.test('★ op:rpc — клиент НЕ может подсунуть p_actor (движок перезапишет)', () => {
  const plan = buildPlan(SAMPLE, RPC_ACTION, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: null,
    // buildArgs берёт только объявленные values; даже если бы p_actor долетел,
    // спред `...args, p_actor: ctx.actor` ставит его ПОСЛЕДНИМ.
    values: { from_city_visit_id: 'x', to_city_visit_id: 'y', segments: [], p_actor: 'someone-else' } as never,
  });
  assert(plan.op === 'rpc');
  assertEquals(plan.args.p_actor, ACTOR);
});

Deno.test('op:rpc без rpc-имени — ошибка конфигурации (не молчаливый no-op)', () => {
  const broken: ActionSpec = { op: 'rpc', requires: ['editor'] };
  assertThrows(() => buildPlan(SAMPLE, broken, { actor: ACTOR, scopeValue: TRIP, targetId: null, values: {} }));
});

Deno.test('★ op:rpc требует обязательные поля даже при isInsert=false', () => {
  // Транзакция — всегда «вставка»: пропуск обязательного сегмента = 400, не сырой
  // 500 от DB. Тот же инвариант, что op:insert.
  const r = validateInput(RPC_ACTION, {
    from_city_visit_id: '11111111-1111-1111-1111-111111111111',
    to_city_visit_id: '22222222-2222-2222-2222-222222222222',
  }, { isInsert: false });
  assert('status' in r && r.status === 400, 'без segments layover обязан вернуть 400');
  assert(r.message.includes('segments'), `в сообщении нет имени поля: ${r.message}`);
});

Deno.test('★ op:rpc — битый сегмент отбивается per-segment валидацией (не долетает до RPC)', () => {
  const r = validateInput(RPC_ACTION, {
    from_city_visit_id: 'a', to_city_visit_id: 'b',
    segments: [{ transport_type: 'train' }, { transport_type: 'spaceship' }],
  }, { isInsert: true });
  assert('status' in r && r.status === 400, 'сегмент вне enum обязан отбиться');
});

Deno.test('validateFields — переиспользуемый над одним набором (вынесен из validateInput)', () => {
  const ok = validateFields(SEGMENT_FIELDS, { transport_type: 'car', price: 0 }, { insert: true });
  assert(!('status' in ok));
  assertEquals(ok.values, { transport_type: 'car', price: 0 });
  const bad = validateFields(SEGMENT_FIELDS, { price: -1 }, { insert: true });
  assert('status' in bad && bad.status === 400, 'price < 0 обязан отбиться');
});

// ── trip-booking: спецификация домена (TRIP-405) ─────────────────────────────

import { TRIP_BOOKING } from './resources/tripBooking.ts';

const HOTEL = TRIP_BOOKING.actions.hotel;
const SERVICE = TRIP_BOOKING.actions.service;
const LAYOVER = TRIP_BOOKING.actions['transfer-layover'];

Deno.test('★ booking upsert: правка by id скоупится трипом {id, trip_id} (IDOR)', () => {
  const plan = buildPlan(TRIP_BOOKING, HOTEL, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: 'hotel-row-1',
    values: { name: 'H', currency: 'EUR' },
  });
  assert(plan.op === 'update');
  assertEquals(plan.match, { id: 'hotel-row-1', trip_id: TRIP });
  // created_by НЕ переписывается на правке.
  assertEquals(plan.values.created_by, undefined);
});

Deno.test('★ booking create: created_by ставит СЕРВЕР, trip_id — скоуп', () => {
  const plan = buildPlan(TRIP_BOOKING, HOTEL, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: null,
    values: { city_visit_id: '11111111-1111-1111-1111-111111111111', name: 'H', currency: 'EUR' },
  });
  assert(plan.op === 'insert');
  assertEquals(plan.values.created_by, ACTOR);
  assertEquals(plan.values.trip_id, TRIP);
});

Deno.test('hotel: обязательные city_visit_id/name/currency на создании', () => {
  const miss = validateInput(HOTEL, { name: 'H', currency: 'EUR' }, { isInsert: true });
  assert('status' in miss, 'без city_visit_id создание отбивается');
  const ok = validateInput(HOTEL, {
    city_visit_id: '11111111-1111-1111-1111-111111111111', name: 'H', currency: 'EUR',
  }, { isInsert: true });
  assert(!('status' in ok), 'полный набор проходит');
});

Deno.test('★ hotel: payment_status вне enum отбивается (зеркало CHECK)', () => {
  const r = validateInput(HOTEL, {
    city_visit_id: '11111111-1111-1111-1111-111111111111', name: 'H', currency: 'EUR',
    payment_status: 'later',
  }, { isInsert: true });
  assert('status' in r && r.status === 400);
});

Deno.test('★ hotel: booking_url без http(s) и битый documents.file_url отбиваются (TRIP-281)', () => {
  const url = validateInput(HOTEL, {
    city_visit_id: '11111111-1111-1111-1111-111111111111', name: 'H', currency: 'EUR',
    booking_url: 'javascript:alert(1)',
  }, { isInsert: true });
  assert('status' in url && url.status === 400, 'javascript: booking_url обязан отбиться');
  const doc = validateInput(HOTEL, {
    city_visit_id: '11111111-1111-1111-1111-111111111111', name: 'H', currency: 'EUR',
    documents: [{ file_url: 'javascript:evil' }],
  }, { isInsert: true });
  assert('status' in doc && doc.status === 400, 'кривой file_url обязан отбиться');
});

Deno.test('★ hotel: free_cancellation НЕ boolean → 400 (строгий тип-гейт, без коэрции)', () => {
  const r = validateInput(HOTEL, {
    city_visit_id: '11111111-1111-1111-1111-111111111111', name: 'H', currency: 'EUR',
    free_cancellation: 'true',
  }, { isInsert: true });
  assert('status' in r && r.status === 400, "'true' строкой обязана отбиться");
  const ok = validateInput(HOTEL, {
    city_visit_id: '11111111-1111-1111-1111-111111111111', name: 'H', currency: 'EUR',
    free_cancellation: true, check_in_datetime: '2026-08-12T10:00:00.000Z',
  }, { isInsert: true });
  assert(!('status' in ok), 'boolean + ISO-timestamp проходят');
});

Deno.test('★ hotel: кривой timestamptz → 400, не сырой 500 БД', () => {
  const r = validateInput(HOTEL, {
    city_visit_id: '11111111-1111-1111-1111-111111111111', name: 'H', currency: 'EUR',
    check_in_datetime: 'not-a-date',
  }, { isInsert: true });
  assert('status' in r && r.status === 400);
});

Deno.test('★ service: documents живут в details, битый file_url отбивается', () => {
  const bad = validateInput(SERVICE, {
    name: 'eSIM', currency: 'EUR', kind: 'esim',
    details: { documents: [{ file_url: 'javascript:evil' }] },
  }, { isInsert: true });
  assert('status' in bad && bad.status === 400, 'кривой details.documents.file_url отбивается');
  const ok = validateInput(SERVICE, {
    name: 'eSIM', currency: 'EUR', kind: 'esim',
    details: { documents: [{ file_url: 'https://ok.test/a' }], notes: 'x' },
  }, { isInsert: true });
  assert(!('status' in ok), 'валидный details проходит');
});

Deno.test('★ service: kind вне enum отбивается', () => {
  const r = validateInput(SERVICE, { name: 'X', currency: 'EUR', kind: 'yacht' }, { isInsert: true });
  assert('status' in r && r.status === 400);
});

Deno.test('★ transfer-layover: buildPlan → rpc с p_-аргументами и p_actor от ШВА', () => {
  const validated = validateInput(LAYOVER, {
    from_city_visit_id: '11111111-1111-1111-1111-111111111111',
    to_city_visit_id: '22222222-2222-2222-2222-222222222222',
    waypoints: [{ city_name_en: 'Paris', country_code: 'FR' }],
    segments: [
      { transport_type: 'train', currency: 'EUR', day_span: 0 },
      { transport_type: 'bus', currency: 'EUR', day_span: 1 },
    ],
  }, { isInsert: true });
  assert(!('status' in validated), 'валидный layover обязан пройти');
  const plan = buildPlan(TRIP_BOOKING, LAYOVER, {
    actor: ACTOR, scopeValue: TRIP, targetId: null, values: validated.values,
  });
  assert(plan.op === 'rpc');
  assertEquals(plan.name, 'add_layover_transfer');
  assertEquals(plan.args.p_trip, TRIP);
  assertEquals(plan.args.p_actor, ACTOR);
  assertEquals(plan.args.p_from, '11111111-1111-1111-1111-111111111111');
  assertEquals((plan.args.p_segments as unknown[]).length, 2);
  assertEquals((plan.args.p_waypoints as unknown[]).length, 1);
});

Deno.test('★ transfer-layover: сегмент с transport_type вне enum отбивается per-segment', () => {
  const r = validateInput(LAYOVER, {
    from_city_visit_id: '11111111-1111-1111-1111-111111111111',
    to_city_visit_id: '22222222-2222-2222-2222-222222222222',
    waypoints: [{ city_name_en: 'Paris' }],
    segments: [{ transport_type: 'spaceship', currency: 'EUR' }],
  }, { isInsert: true });
  assert('status' in r && r.status === 400, 'битый сегмент обязан отбиться до RPC');
});

Deno.test('★ transfer-layover: без segments/waypoints → 400 (обязательны)', () => {
  const r = validateInput(LAYOVER, {
    from_city_visit_id: '11111111-1111-1111-1111-111111111111',
    to_city_visit_id: '22222222-2222-2222-2222-222222222222',
  }, { isInsert: true });
  assert('status' in r && r.status === 400);
});

// ── Сквозная проверка реестра ────────────────────────────────────────────────

Deno.test('★ ни одно действие реестра не строит update/delete без скоупа', () => {
  let checked = 0;
  for (const resource of Object.values(REGISTRY)) {
    for (const [name, action] of Object.entries(resource.actions)) {
      const plan = buildPlan(resource, action, {
        actor: ACTOR,
        scopeValue: 'scope-value',
        targetId: 'row-1',
        values: {},
      });
      if (plan.op !== 'update' && plan.op !== 'delete') continue;
      assertEquals(
        (plan.match as Record<string, unknown>)[resource.scope.column],
        'scope-value',
        `${resource.name}/${name}: адресация по id без скоупа = IDOR`,
      );
      checked++;
    }
  }
  // Датчик слепоты: пустой реестр сделал бы этот тест зелёным ни о чём.
  assert(checked > 0, 'реестр пуст — тест не проверил НИЧЕГО');
});

// ── Сквозные инварианты реестра: порядок двери и IDOR у RPC (Этап 4) ──────────
//
// Классификация требований по СТАТУСУ отказа — зеркалит `checkRequirement` в
// `mutate.ts` (I/O-половину из теста не загрузить: env читается на загрузке
// клиента). Access-гейт → 403, payment-гейт → 402. Живёт здесь, а не в
// production-модуле: инвариант — свойство ТЕСТА, а не рантайма, и трогать шов
// (auth) не нужно. Дрейф закрыт тестом полноты ниже: новое имя требования,
// не попавшее ни в один набор, красит сборку — значит его забыли и в
// `checkRequirement`, и в классификации.
const ACCESS_REQUIREMENTS = new Set(['participant', 'editor', 'owner', 'self']); // → 403
const PAYMENT_REQUIREMENTS = new Set(['pro', 'trip_quota']); // → 402

Deno.test('★ каждое требование реестра классифицировано (ловит новое имя)', () => {
  let checked = 0;
  for (const resource of Object.values(REGISTRY)) {
    for (const [name, action] of Object.entries(resource.actions)) {
      for (const req of action.requires) {
        assert(
          ACCESS_REQUIREMENTS.has(req) || PAYMENT_REQUIREMENTS.has(req),
          `${resource.name}/${name}: требование "${req}" не классифицировано — добавь в ACCESS/PAYMENT + checkRequirement`,
        );
        checked++;
      }
    }
  }
  assert(checked > 0, 'ни одного требования не проверено — тест зелёный ни о чём');
});

Deno.test('★ порядок двери: 402 (Pro/лимит) НЕ раньше 403 (доступ) во всём реестре', () => {
  // Инвариант монетизации+приватности: посторонний обязан получить 403 «нельзя»,
  // а не 402 «купи Pro». 402 раньше 403 подтвердил бы существование трипа и слил
  // Pro-детали чужому (handoff §3; канон chat `['participant','pro']`). Проверяем
  // ДАННЫЕ — порядок в `requires`; шов (`mutate.ts`) возвращает ПЕРВЫЙ отказ по
  // этому порядку, поэтому порядок в массиве и есть порядок дверей.
  let checked = 0;
  for (const resource of Object.values(REGISTRY)) {
    for (const [name, action] of Object.entries(resource.actions)) {
      const reqs = action.requires;
      const firstPayment = reqs.findIndex((r) => PAYMENT_REQUIREMENTS.has(r));
      const firstAccess = reqs.findIndex((r) => ACCESS_REQUIREMENTS.has(r));
      // Нет платного гейта ИЛИ нет гейта доступа (напр. `trip/create`
      // `['trip_quota']` — нового трипа ещё нет, течь нечему) → инвариант неприменим.
      if (firstPayment === -1 || firstAccess === -1) continue;
      assert(
        firstAccess < firstPayment,
        `${resource.name}/${name}: requires ${JSON.stringify(reqs)} — 402 (${reqs[firstPayment]}) стоит раньше 403 (${reqs[firstAccess]}); посторонний узнает Pro-детали`,
      );
      checked++;
    }
  }
  assert(checked > 0, 'ни одного действия с двумя гейтами — тест зелёный ни о чём');
});

Deno.test('★ каждое tripId-scoped rpc-действие несёт ПРОВЕРЕННЫЙ scopeValue (IDOR)', () => {
  // У table-DML скоуп внедряет `buildPlan` (тест «ни одно действие … без скоупа»).
  // У `op:'rpc'` аргументы кладёт `buildArgs` — здесь трип обязан приехать из
  // `ctx.scopeValue` (значение, которое проверил `_can_edit_trip`), а НЕ из
  // клиентского `values`. Зовём с ПУСТЫМ `values`: если бы `buildArgs` брал трип
  // из тела, аргумент был бы `undefined` и `scopeValue` в плане не появился бы →
  // тест краснеет. actor-scoped ресурсы (`trip/create`, `account`, `inbox`)
  // держатся на инъекции `p_actor`, им `scopeValue` не нужен — потому только
  // `from:'tripId'`.
  const TARGET = 'target-uuid';
  let checked = 0;
  for (const resource of Object.values(REGISTRY)) {
    if (resource.scope.from !== 'tripId') continue;
    for (const [name, action] of Object.entries(resource.actions)) {
      if (action.op !== 'rpc') continue;
      const plan = buildPlan(resource, action, {
        actor: ACTOR,
        scopeValue: TRIP,
        targetId: TARGET,
        values: {},
      });
      assert(plan.op === 'rpc');
      assertEquals(
        plan.args.p_actor,
        ACTOR,
        `${resource.name}/${name}: p_actor обязан инъектиться швом, не клиентом`,
      );
      assert(
        Object.values(plan.args).includes(TRIP),
        `${resource.name}/${name}: RPC не получил проверенный scopeValue — трип берётся из клиента? IDOR`,
      );
      checked++;
    }
  }
  assert(checked > 0, 'ни одного tripId-scoped rpc-действия — тест зелёный ни о чём');
});

// ── trip-chat / inbox: контракт RPC-аргументов (TRIP-408) ────────────────────

Deno.test('★ trip-chat/send: p_trip из скоупа, p_actor от шва, тело буквенно', () => {
  const resource = REGISTRY['trip-chat'];
  const action = resource.actions.send;
  // Порядок требований несущий: 403 (participant) раньше 402 (pro).
  assertEquals([...action.requires], ['participant', 'pro']);
  const plan = buildPlan(resource, action, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: null,
    values: { text: 'hi', clientMsgId: 'cmsg-uuid' },
  });
  assert(plan.op === 'rpc');
  assertEquals(plan.name, 'send_chat_message');
  // p_actor инъектит buildPlan (клиент актора не называет); p_trip — из скоупа.
  assertEquals(plan.args, {
    p_trip: TRIP,
    p_text: 'hi',
    p_client_msg_id: 'cmsg-uuid',
    p_actor: ACTOR,
  });
});

Deno.test('trip-chat/send: без clientMsgId → p_client_msg_id null (серверная строка)', () => {
  const resource = REGISTRY['trip-chat'];
  const plan = buildPlan(resource, resource.actions.send, {
    actor: ACTOR,
    scopeValue: TRIP,
    targetId: null,
    values: { text: 'hi' },
  });
  assert(plan.op === 'rpc');
  assertEquals((plan.args as Record<string, unknown>).p_client_msg_id, null);
});

Deno.test('trip-chat/send: текст свыше 10000 отвергается (кэп = CHECK в RPC)', () => {
  const action = REGISTRY['trip-chat'].actions.send;
  const r = validateInput(action, { text: 'x'.repeat(10001) }, { isInsert: true });
  assert('status' in r && r.status === 400, 'текст >10000 обязан отбиться 400');
});

Deno.test('★ inbox/read + read-all: p_actor от шва, p_id из тела (self-скоуп)', () => {
  const resource = REGISTRY['inbox'];
  assertEquals([...resource.actions.read.requires], ['self']);
  const read = buildPlan(resource, resource.actions.read, {
    actor: ACTOR,
    scopeValue: ACTOR,
    targetId: null,
    values: { id: 'notif-uuid' },
  });
  assert(read.op === 'rpc');
  assertEquals(read.name, 'mark_notification_read');
  assertEquals(read.args, { p_id: 'notif-uuid', p_actor: ACTOR });

  const all = buildPlan(resource, resource.actions['read-all'], {
    actor: ACTOR,
    scopeValue: ACTOR,
    targetId: null,
    values: {},
  });
  assert(all.op === 'rpc');
  assertEquals(all.name, 'mark_all_notifications_read');
  assertEquals(all.args, { p_actor: ACTOR });
});

// ── TRIP-409: домен участников — способности движка + спеки по-действию ──────

const M_ACTOR = { id: 'me-uuid', email: 'me@example.com' };

Deno.test('★ op:none (resend): buildPlan даёт план-пустышку, записи нет', () => {
  const resource = REGISTRY['trip-member'];
  const plan = buildPlan(resource, resource.actions.resend, {
    actor: M_ACTOR.id, scopeValue: TRIP, targetId: 'member-1', values: {},
  });
  assertEquals(plan, { op: 'none' });
});

Deno.test('resend: guardRow пускает только pending, иначе 400', () => {
  const resend = REGISTRY['trip-member'].actions.resend;
  assertEquals(resend.guardRow!({ status: 'pending' }, M_ACTOR), null);
  const r = resend.guardRow!({ status: 'active' }, M_ACTOR);
  assert(r && r.status === 400, `ожидался 400, ${JSON.stringify(r)}`);
});

Deno.test('★ invite: mapOutcome переводит дискриминант в Refusal/успех', () => {
  const invite = REGISTRY['trip-member'].actions.invite;
  const map = invite.mapOutcome!;
  const already = map({ outcome: 'already_member', member: null });
  assert('status' in already && already.status === 409 && already.code === 'ALREADY_MEMBER');
  const self = map({ outcome: 'self' });
  assert('status' in self && self.status === 400 && self.code === 'INVITE_SELF');
  const owner = map({ outcome: 'owner' });
  assert('status' in owner && owner.status === 400 && owner.code === 'INVITE_OWNER');
  // Успех: created/reactivated → { data: member } (не Refusal).
  const ok = map({ outcome: 'created', member: { id: 'm1' } });
  assert(!('status' in ok) && (ok as { data: unknown }).data && ((ok as { data: { id: string } }).data).id === 'm1');
  const react = map({ outcome: 'reactivated', member: { id: 'm2' } });
  assert(!('status' in react));
});

Deno.test('★ invite: buildPlan → rpc с p_trip/p_email/p_role/p_actor', () => {
  const resource = REGISTRY['trip-member'];
  const plan = buildPlan(resource, resource.actions.invite, {
    actor: M_ACTOR.id, scopeValue: TRIP, targetId: null,
    values: { email: 'a@b.co', role: 'admin' },
  });
  assert(plan.op === 'rpc');
  assertEquals(plan.name, 'invite_trip_member');
  assertEquals(plan.args, { p_trip: TRIP, p_email: 'a@b.co', p_role: 'admin', p_actor: M_ACTOR.id });
});

Deno.test('invite: email/role обязательны на вставке (rpc = строгая обязательность)', () => {
  const invite = REGISTRY['trip-member'].actions.invite;
  const r = validateInput(invite, { email: 'a@b.co' }, { isInsert: false });
  assert('status' in r && r.status === 400, 'без role — 400');
});

Deno.test('add-offline: пустое имя отвергается (validate непустоты)', () => {
  const addOffline = REGISTRY['trip-member'].actions['add-offline'];
  const blank = validateInput(addOffline, { user_full_name: '   ' }, { isInsert: true });
  assert('status' in blank && blank.status === 400, 'пробелы — 400');
  const ok = validateInput(addOffline, { user_full_name: 'Гость' }, { isInsert: true });
  assert(!('status' in ok));
});

Deno.test('role: guardRow держит владельца неизменным', () => {
  const role = REGISTRY['trip-member'].actions.role;
  const r = role.guardRow!({ role: 'owner' }, M_ACTOR);
  assert(r && r.status === 400 && r.code === 'OWNER_IMMUTABLE');
  assertEquals(role.guardRow!({ role: 'viewer' }, M_ACTOR), null);
});

Deno.test('★ remove: guardRow — не владелец и не сам; buildArgs скоупит p_trip (IDOR)', () => {
  const resource = REGISTRY['trip-member'];
  const remove = resource.actions.remove;
  assert(remove.guardRow!({ role: 'owner', user_id: 'x' }, M_ACTOR)?.code === 'OWNER_IMMUTABLE');
  assert(remove.guardRow!({ role: 'viewer', user_id: M_ACTOR.id }, M_ACTOR)?.code === 'REMOVE_SELF');
  assertEquals(remove.guardRow!({ role: 'viewer', user_id: 'other' }, M_ACTOR), null);
  const plan = buildPlan(resource, remove, {
    actor: M_ACTOR.id, scopeValue: TRIP, targetId: 'member-1', values: {},
  });
  assert(plan.op === 'rpc' && plan.name === 'remove_trip_member');
  // IDOR: скоуп трипа + id участника в теле RPC (реестровый sweep rpc НЕ покрывает).
  assertEquals(plan.args, { p_member: 'member-1', p_trip: TRIP, p_actor: M_ACTOR.id });
});

Deno.test('★ leave: guardRow row-self (только своя строка членства)', () => {
  const leave = REGISTRY['trip-member-self'].actions.leave;
  assertEquals(leave.guardRow!({ user_id: M_ACTOR.id }, M_ACTOR), null);
  const r = leave.guardRow!({ user_id: 'other' }, M_ACTOR);
  assert(r && r.status === 403);
});

// TRIP-516: владелец теперь обычная строка `trip_members` (role='owner'). Из
// СВОЕЙ поездки выйти нельзя — снос строки владельца осиротил бы владение и
// дёрнул teardown. Бэкстоп симметричен OWNER_IMMUTABLE на remove/role.
Deno.test('★ leave: владелец не может выйти из своей поездки (OWNER_IMMUTABLE)', () => {
  const leave = REGISTRY['trip-member-self'].actions.leave;
  const r = leave.guardRow!({ role: 'owner', user_id: M_ACTOR.id }, M_ACTOR);
  assert(r && r.status === 400 && r.code === 'OWNER_IMMUTABLE');
  // Обычный участник по-прежнему выходит из своей строки.
  assertEquals(leave.guardRow!({ role: 'viewer', user_id: M_ACTOR.id }, M_ACTOR), null);
});

Deno.test('★ respond: guardRow row-self по user_id ЛИБО по email (actor.email)', () => {
  const respond = REGISTRY['trip-member-self'].actions.respond;
  // Владение по user_id:
  assertEquals(respond.guardRow!({ user_id: M_ACTOR.id, invite_email: null, status: 'pending' }, M_ACTOR), null);
  // Владение по email (user_id ещё пуст — приглашён до регистрации), регистр не важен:
  assertEquals(respond.guardRow!({ user_id: null, invite_email: 'ME@Example.com', status: 'pending' }, M_ACTOR), null);
  // Чужой инвайт → 403:
  const notMine = respond.guardRow!({ user_id: 'x', invite_email: 'x@y.z', status: 'pending' }, M_ACTOR);
  assert(notMine && notMine.status === 403);
  // Уже отвечено → 409:
  const answered = respond.guardRow!({ user_id: M_ACTOR.id, status: 'active' }, M_ACTOR);
  assert(answered && answered.status === 409 && answered.code === 'ALREADY_RESPONDED');
});

Deno.test('respond: buildArgs → p_member/p_trip/p_action/p_actor', () => {
  const resource = REGISTRY['trip-member-self'];
  const plan = buildPlan(resource, resource.actions.respond, {
    actor: M_ACTOR.id, scopeValue: TRIP, targetId: 'member-1', values: { action: 'accept' },
  });
  assert(plan.op === 'rpc' && plan.name === 'respond_trip_invite');
  assertEquals(plan.args, { p_member: 'member-1', p_trip: TRIP, p_action: 'accept', p_actor: M_ACTOR.id });
});

Deno.test('invite-link/create: роль по умолчанию viewer, p_trip из скоупа', () => {
  const resource = REGISTRY['trip-invite-link'];
  const dflt = buildPlan(resource, resource.actions.create, {
    actor: M_ACTOR.id, scopeValue: TRIP, targetId: null, values: {},
  });
  assert(dflt.op === 'rpc' && dflt.name === 'create_trip_invite_link');
  assertEquals(dflt.args, { p_trip: TRIP, p_role: 'viewer', p_actor: M_ACTOR.id });
  const admin = buildPlan(resource, resource.actions.create, {
    actor: M_ACTOR.id, scopeValue: TRIP, targetId: null, values: { role: 'admin' },
  });
  assert(admin.op === 'rpc' && admin.name === 'create_trip_invite_link');
  assertEquals(admin.args.p_role, 'admin');
});

// ── Инвариант №7: requires:[] + запись ⇒ loadTarget+guardRow ──────────────────

Deno.test('★ инвариант №7: живой REGISTRY чист (нет дверей без замка)', () => {
  assertEquals(findUnguardedRowSelf(), []);
});

Deno.test('★ инвариант №7 ловит дыру: requires:[] + rpc без guardRow (красный под мутацией)', () => {
  const holed: Record<string, ResourceSpec> = {
    hole: {
      name: 'hole',
      scope: { column: 'trip_id', from: 'tripId' },
      actions: {
        // requires:[] + запись (rpc), но БЕЗ loadTarget/guardRow = дверь без замка.
        danger: { op: 'rpc', rpc: 'x', requires: [] },
      },
    },
  };
  const bad = findUnguardedRowSelf(holed);
  assert(bad.length === 1 && bad[0].includes('hole/danger'), `должен поймать дыру: ${JSON.stringify(bad)}`);
});

Deno.test('инвариант №7: op:none под requires:[] дырой НЕ считается (записи нет)', () => {
  const okReg: Record<string, ResourceSpec> = {
    ok: {
      name: 'ok', scope: { column: 'trip_id', from: 'tripId' },
      actions: { ping: { op: 'none', requires: [] } },
    },
  };
  assertEquals(findUnguardedRowSelf(okReg), []);
});

// ── TRIP-416: домен «трип» (trip-settings / trip-owner / trip-share) ─────────

Deno.test('★ TRIP-416 settings: mapOutcome переводит pro_required → 402, ok → { data: null }', () => {
  const settings = REGISTRY['trip-settings'].actions.settings;
  const map = settings.mapOutcome!;
  const pro = map({ outcome: 'pro_required' });
  assert('status' in pro && pro.status === 402 && pro.code === 'PRO_REQUIRED', 'pro_required → 402 PRO_REQUIRED');
  const ok = map({ outcome: 'ok' });
  // Успех НЕ фабрикует флаг в data — дискриминант в корне (TRIP-400).
  assert(!('status' in ok) && (ok as { data: unknown }).data === null, 'ok → { data: null }');
});

Deno.test('★ TRIP-416 settings: buildArgs делит вход на p_fields и p_details_patch', () => {
  const settings = REGISTRY['trip-settings'].actions.settings;
  const args = settings.buildArgs!(
    { fields: { title: 'T' }, main_currency: 'USD', display: { chat_widget: true } },
    { actor: ACTOR, scopeValue: TRIP, targetId: null },
  );
  assertEquals(args.p_trip, TRIP);
  assertEquals(args.p_fields, { title: 'T' });
  // addons не прислан → в патч НЕ попадает (частичный merge).
  assertEquals(args.p_details_patch, { main_currency: 'USD', display: { chat_widget: true } });
});

Deno.test('★ TRIP-416 settings: вложенный fields валидируется (title≤300)', () => {
  const spec = REGISTRY['trip-settings'].actions.settings.fields!.fields;
  const tooLong = spec.validate!({ title: 'x'.repeat(301) });
  assert(tooLong && tooLong.status === 400, 'title>300 → 400');
  assertEquals(spec.validate!({ title: 'ok', description: null }), null, 'валидные колонки → пропуск');
});

Deno.test('★ TRIP-416 owner/delete: план — удаление по СКОУПУ (targetBy:scope), гейт owner', () => {
  const resource = REGISTRY['trip-owner'];
  const del = resource.actions.delete;
  assertEquals(del.requires, ['owner']);
  const plan = buildPlan(resource, del, { actor: ACTOR, scopeValue: TRIP, targetId: 'ignored', values: {} });
  // Адресуется САМ трип (`trips` по `id`), targetId игнорируется — симметрия с upsert-by-scope.
  assertEquals(plan, { op: 'delete', table: 'trips', match: { id: TRIP } });
});

Deno.test('★ TRIP-416 share: copy mapOutcome (limit/not_found/ok) + buildArgs', () => {
  const copy = REGISTRY['trip-share'].actions.copy;
  const map = copy.mapOutcome!;
  const lim = map({ outcome: 'limit' });
  assert('status' in lim && lim.status === 402 && lim.code === 'TRIP_LIMIT_REACHED', 'limit → 402 TRIP_LIMIT_REACHED');
  const nf = map({ outcome: 'not_found' });
  assert('status' in nf && nf.status === 404, 'not_found → 404');
  const ok = map({ outcome: 'ok', tripId: 'new-1' });
  assert(!('status' in ok) && (ok as { data: { tripId?: string } }).data.tripId === 'new-1', 'ok → { data: { tripId } }');
  assertEquals(copy.buildArgs!({}, { actor: ACTOR, scopeValue: TRIP, targetId: null }), { p_source: TRIP });
});

Deno.test('★ TRIP-416 share: share buildArgs = { p_trip } (участник)', () => {
  const share = REGISTRY['trip-share'].actions.share;
  assertEquals(share.requires, ['participant']);
  assertEquals(share.buildArgs!({}, { actor: ACTOR, scopeValue: TRIP, targetId: null }), { p_trip: TRIP });
});

// ── TRIP-411: домен регистрации — register за швом (self-скоуп, op:'rpc') ─────

Deno.test('★ register: self-скоуп, buildPlan → rpc create_user_profile, p_actor от шва', () => {
  const resource = REGISTRY['account'];
  const register = resource.actions.register;
  // requires:['self'] (гомогенен с profile; инвариант №7 не применяется — гейт не пуст).
  assertEquals([...register.requires], ['self']);
  const plan = buildPlan(resource, register, {
    actor: ACTOR,
    scopeValue: ACTOR, // self-скоуп: значение = актор (scope.from:'actor')
    targetId: null,
    values: { language: 'es', marks: { utm_source: 'google' } },
  });
  assert(plan.op === 'rpc');
  assertEquals(plan.name, 'create_user_profile');
  // Клиент шлёт ТОЛЬКО language+marks; p_actor инъектит шов (id/email/имя/аватар — из auth).
  assertEquals(plan.args, { p_language: 'es', p_marks: { utm_source: 'google' }, p_actor: ACTOR });
});

Deno.test('★ register: язык/марки необязательны → p_language/p_marks = null', () => {
  const resource = REGISTRY['account'];
  const register = resource.actions.register;
  // Пустое тело законно (оба поля nullable, не required): язык мимо → дефолт в RPC.
  const validated = validateInput(register, {}, { isInsert: true });
  assert(!('status' in validated));
  const plan = buildPlan(resource, register, {
    actor: ACTOR, scopeValue: ACTOR, targetId: null, values: (validated as { values: Record<string, unknown> }).values,
  });
  assert(plan.op === 'rpc');
  assertEquals(plan.args, { p_language: null, p_marks: null, p_actor: ACTOR });
});

Deno.test('register: язык вне enum и марки не-объект отбиваются 400 (зеркало CHECK/типа)', () => {
  const register = REGISTRY['account'].actions.register;
  const badLang = validateInput(register, { language: 'de' }, { isInsert: true });
  assert('status' in badLang && badLang.status === 400, 'язык вне ru/en/es — 400');
  const badMarks = validateInput(register, { marks: ['utm_source'] }, { isInsert: true });
  assert('status' in badMarks && badMarks.status === 400, 'марки-массив (не jsonb-объект) — 400');
  const okNull = validateInput(register, { language: null, marks: null }, { isInsert: true });
  assert(!('status' in okNull), 'null законен для обоих (nullable)');
});

// ── Зеркало «бронь → трата» объявлено на КАЖДОМ действии (TRIP-484) ──────────
//
// Триггер `sync_budget_expense` висит на четырёх booking-таблицах и ведёт строку
// `budget_expenses` на INSERT/UPDATE/DELETE. Клиент об этом зеркале узнаёт ТОЛЬКО
// из ответа шва (`returnExpenses` → `expenses` в конверте): забытый флаг ничего не
// ломает на записи и молча оставляет бюджет позади — ровно тот дефект, из-за
// которого удалённая бронь висела тратой до перезагрузки. Поэтому флаг проверяется
// не глазами ревьюера, а здесь.
Deno.test('★ booking: каждое действие таблиц-зеркал объявляет returnExpenses (TRIP-484)', () => {
  const MIRRORED = new Set(['hotel_stays', 'transfers', 'activities', 'trip_services']);
  const missing: string[] = [];
  let checked = 0;
  for (const [name, action] of Object.entries(TRIP_BOOKING.actions)) {
    // Действие пишет либо в таблицу под триггером, либо транзакцией (layover —
    // те же `transfers` изнутри RPC, таблицы в спецификации нет).
    const touchesMirror = action.table ? MIRRORED.has(action.table) : action.op === 'rpc';
    if (!touchesMirror) continue;
    checked += 1;
    if (action.returnExpenses !== true) missing.push(name);
  }
  assertEquals(missing, [], `действия без returnExpenses: ${missing.join(', ')}`);
  assert(checked === 9, `ожидалось 9 действий-зеркал, посчитано ${checked}`);
});
