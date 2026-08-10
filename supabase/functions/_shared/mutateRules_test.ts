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
  parseAction,
  REGISTRY,
  unwrapDbResult,
  validateInput,
  type ActionSpec,
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

Deno.test('★ guardRow: чужой ЛИЧНЫЙ док удалить нельзя', () => {
  const r = DOC_DELETE.guardRow!({ visibility: 'private', created_by: 'someone-else' }, ACTOR);
  assert(r && r.status === 403 && r.code === 'DOC_PRIVATE_NOT_OWNER', `ожидался 403, ${JSON.stringify(r)}`);
});

Deno.test('guardRow: СВОЙ личный док удалить можно', () => {
  assertEquals(DOC_DELETE.guardRow!({ visibility: 'private', created_by: ACTOR }, ACTOR), null);
});

Deno.test('guardRow: ОБЩИЙ док удаляет любой редактор', () => {
  assertEquals(DOC_DELETE.guardRow!({ visibility: 'shared', created_by: 'someone-else' }, ACTOR), null);
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
