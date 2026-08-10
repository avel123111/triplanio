#!/usr/bin/env node
/**
 * Tests for the storage-predicate half of CI guard 2e
 * (scripts/ci/check-security-tiers.mjs, TRIP-274).
 *
 * WHY this file exists. Until TRIP-274 the guard checked that a bucket policy
 * EXISTED, never what it said. That is exactly why it stayed green while all
 * four policies of the private `trips` bucket sat on the READ predicate and a
 * viewer could put bytes into a trip folder: the policy was there, it just let
 * the wrong tier through. The fix adds predicate matching — so the matching
 * itself now needs a test, per CLAUDE.md ("a CI guard is code: it gets a test").
 *
 * Scope, stated honestly: `checkBucketPredicates` is the pure decision half and
 * is covered end to end below. The psql/JSON plumbing around it (`checkLive`)
 * still has no test — it needs a live database, and the LIVE assert runs
 * post-deploy, not on the PR. What that plumbing can get wrong is a query that
 * returns nothing; the `undefined`-guard cases below pin the behaviour that
 * would then result (silence, deferring to the existence check) so it is a
 * deliberate choice rather than an accident.
 *
 * Everything here rides on the guard staying importable without side effects.
 * That premise cannot be checked from this file — an import that calls
 * process.exit(0) kills the runner before the first test registers, and the
 * runner then prints "pass 1, fail 0" for the file. It is pinned from
 * check-security-tiers.cli.test.mjs, which never imports the guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkBucketPredicates,
  checkDoors,
  checkEditorRoles,
  checkSeamDoors,
  parseGateTokensFromSeam,
  parseResourceSpecs,
  parseSeamSlug,
} from './check-security-tiers.mjs';

// Манифест-фикстура той же формы, что BUCKETS в security-tiers.mjs.
const TRIPS = {
  trips: {
    public: false,
    policies: ['select', 'insert', 'update', 'delete'],
    readPredicate: '_can_access_trip_file',
    writePredicate: '_can_write_trip_file',
  },
};

const policy = (name, pred) => ({ name, pred });

// Как выглядит бакет ПОСЛЕ TRIP-274 — эталон.
const healthy = [
  policy('trips_select', `(bucket_id = 'trips' AND (_drafts_branch OR _can_access_trip_file(name)))`),
  policy('trips_insert', `(bucket_id = 'trips' AND (_drafts_branch OR _can_write_trip_file(name)))`),
  policy('trips_update', `(bucket_id = 'trips' AND (_drafts_branch OR _can_write_trip_file(name))) (bucket_id = 'trips' AND (_drafts_branch OR _can_write_trip_file(name)))`),
  policy('trips_delete', `(bucket_id = 'trips' AND (_drafts_branch OR _can_write_trip_file(name)))`),
];

test('здоровый бакет: ошибок нет', () => {
  assert.deepEqual(checkBucketPredicates(healthy, TRIPS), []);
});

// ── Регрессия, ради которой всё это написано ────────────────────────────────
test('ДО TRIP-274: все четыре команды на читающем предикате → падает на трёх', () => {
  const before = [
    policy('trips_select', `_can_access_trip_file(name)`),
    policy('trips_insert', `_can_access_trip_file(name)`),
    policy('trips_update', `_can_access_trip_file(name)`),
    policy('trips_delete', `_can_access_trip_file(name)`),
  ];
  const errors = checkBucketPredicates(before, TRIPS);
  // По ДВЕ жалобы на каждую write-команду: write-предиката нет И стоит read.
  assert.equal(errors.length, 6, `ожидались insert/update/delete ×2, получено: ${JSON.stringify(errors)}`);
  for (const cmd of ['insert', 'update', 'delete']) {
    const mine = errors.filter((e) => e.includes(`'trips_${cmd}'`));
    assert.equal(mine.length, 2, `trips_${cmd}: ${JSON.stringify(mine)}`);
    assert.ok(mine.some((e) => /не ссылается на write-предикат/.test(e)));
    assert.ok(mine.some((e) => /write-гейт обойдён/.test(e)));
  }
  // SELECT в этом состоянии корректен — гард не должен ругаться на чтение.
  assert.ok(!errors.some((e) => e.includes('trips_select')), 'ложное срабатывание на trips_select');
});

test('откат одной команды на читающий предикат ловится', () => {
  const drifted = healthy.map((p) => (p.name === 'trips_delete' ? policy('trips_delete', '_can_access_trip_file(name)') : p));
  const errors = checkBucketPredicates(drifted, TRIPS);
  assert.equal(errors.length, 2, JSON.stringify(errors));
  assert.ok(errors.every((e) => e.includes('trips_delete')));
});

// ── Обратная регрессия: чтение ужали до редакторов ──────────────────────────
test('SELECT на write-предикате → чтение ужалось до редакторов', () => {
  const tightened = healthy.map((p) => (p.name === 'trips_select' ? policy('trips_select', '_can_write_trip_file(name)') : p));
  const errors = checkBucketPredicates(tightened, TRIPS);
  // Две жалобы: нет read-предиката И появился write-предикат.
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => e.includes('trips_select')));
  assert.ok(errors.some((e) => /ужалось до редакторов/.test(e)));
});

// ── Обход дизъюнкцией: write-предикат на месте, но рядом ORнут read ─────────
// Нашёл ревьюер Codex на PR #678. Первая версия требовала лишь НАЛИЧИЯ
// write-предиката, поэтому `read(name) OR write(name)` проходила зелёной —
// а пускает такая политика участника, то есть дыра остаётся открытой при
// довольном страже.
test('read-предикат, ORнутый в write-политику, ловится', () => {
  const bypassed = healthy.map((p) => (p.name === 'trips_insert'
    ? policy('trips_insert', `(_can_access_trip_file(name) OR _can_write_trip_file(name))`)
    : p));
  const errors = checkBucketPredicates(bypassed, TRIPS);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /trips_insert/);
  assert.match(errors[0], /write-гейт обойдён/);
});

test('обход дизъюнкцией ловится на каждой из трёх write-команд', () => {
  for (const cmd of ['insert', 'update', 'delete']) {
    const bypassed = healthy.map((p) => (p.name === `trips_${cmd}`
      ? policy(`trips_${cmd}`, `_can_access_trip_file(name) OR _can_write_trip_file(name)`)
      : p));
    const errors = checkBucketPredicates(bypassed, TRIPS);
    assert.equal(errors.length, 1, `${cmd}: ${JSON.stringify(errors)}`);
    assert.match(errors[0], new RegExp(`trips_${cmd}`));
  }
});

// Дизъюнкт `_drafts/<uid>/` в write-политике ЗАКОННЫЙ и обязан молчать: он
// пер-юзерный, черновик обложки заливают до существования трипа.
test('ветка _drafts в write-политике не считается обходом', () => {
  assert.deepEqual(checkBucketPredicates(healthy, TRIPS), []);
});

// ── Границы ─────────────────────────────────────────────────────────────────
test('бакет без объявленных предикатов не проверяется (avatars)', () => {
  const manifest = { avatars: { public: true, policies: ['insert', 'update', 'delete'] } };
  assert.deepEqual(checkBucketPredicates([policy('avatars_insert', 'что угодно')], manifest), []);
});

test('отсутствующая политика молчит — её ловит проверка наличия, не эта', () => {
  const missing = healthy.filter((p) => p.name !== 'trips_delete');
  assert.deepEqual(checkBucketPredicates(missing, TRIPS), []);
});

test('пустой список политик не роняет и не выдумывает ошибок', () => {
  assert.deepEqual(checkBucketPredicates([], TRIPS), []);
  assert.deepEqual(checkBucketPredicates(undefined, TRIPS), []);
});

test('политика без текста предиката считается несоответствующей', () => {
  const blank = healthy.map((p) => (p.name === 'trips_insert' ? policy('trips_insert', '') : p));
  const errors = checkBucketPredicates(blank, TRIPS);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /trips_insert/);
});

test('команда, не объявленная в policies манифеста, не проверяется', () => {
  const manifest = { trips: { ...TRIPS.trips, policies: ['select', 'insert'] } };
  const drifted = healthy.map((p) => (p.name === 'trips_delete' ? policy('trips_delete', 'что-то чужое') : p));
  assert.deepEqual(checkBucketPredicates(drifted, manifest), []);
});

// Сверка идёт по ВЫЗОВУ функции, а не по подстроке. Пара, где одно имя —
// префикс другого, это и проверяет: подстрочное совпадение выдало бы
// `_can_read_x` внутри `_can_read_x_write(...)` и, с запретом read-предиката в
// write-политике, дало бы ЛОЖНОЕ падение на здоровом бакете.
test('предикат-префикс: однокоренное имя не считается вызовом', () => {
  const manifest = { b: { public: false, policies: ['select', 'insert'], readPredicate: '_can_read_x', writePredicate: '_can_read_x_write' } };
  const ok = [
    policy('b_select', '_can_read_x(name)'),
    policy('b_insert', '_can_read_x_write(name)'),
  ];
  assert.deepEqual(checkBucketPredicates(ok, manifest), []);

  const bad = [
    policy('b_select', '_can_read_x_write(name)'), // чтение ужато до редакторов
    policy('b_insert', '_can_read_x(name)'),       // запись открыта участнику
  ];
  const errors = checkBucketPredicates(bad, manifest);
  // По две точные жалобы на каждую политику: «не тот предикат» + «не тот сосед».
  assert.equal(errors.length, 4, JSON.stringify(errors));
  assert.equal(errors.filter((e) => e.includes("'b_select'")).length, 2);
  assert.equal(errors.filter((e) => e.includes("'b_insert'")).length, 2);
  assert.ok(errors.some((e) => /ужалось до редакторов/.test(e)));
  assert.ok(errors.some((e) => /write-гейт обойдён/.test(e)));
});

// Схема-квалифицированный вызов — то, как pg_policies обычно и печатает qual.
test('вызов с квалификацией схемой засчитывается', () => {
  const qualified = healthy.map((p) => policy(p.name, p.pred.replace(/_can_(access|write)_trip_file/g, 'public._can_$1_trip_file')));
  assert.deepEqual(checkBucketPredicates(qualified, TRIPS), []);
});

// ── ДВЕРИ: какую ступень зовёт функция (TRIP-274) ────────────────────────────
// Дыра, ради которой это писалось, была НЕ в правиле и НЕ в политике: правило
// верное, политика на месте, а telegramStartLink спрашивал «ты участник?» там,
// где нужно «ты редактор?». Ни гранты, ни политики, ни тесты правила такого не
// видят — видно только сверкой «дверь → ступень».
const src = (name, code) => ({ name, code });

test('здоровая дверь: манифест и код совпали', () => {
  const doors = { telegramStartLink: 'editor', getTripDetails: 'participant' };
  const sources = [
    src('telegramStartLink', 'if (!(await isCallerEditor(tripId, user.id))) return 403;'),
    src('getTripDetails', 'if (!(await isCallerParticipant(tripId, user.id))) return 403;'),
  ];
  assert.deepEqual(checkDoors(sources, doors), []);
});

test('★ ИСХОДНАЯ ДЫРА: дверь плана стоит на участии', () => {
  const doors = { telegramStartLink: 'editor' };
  const sources = [src('telegramStartLink', 'const ok = await isCallerParticipant(tripId, user.id);')];
  const errors = checkDoors(sources, doors);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /telegramStartLink/);
  assert.match(errors[0], /не ту ступень/);
});

test('форма callerStep + clearsStep читается наравне с прямым гейтом', () => {
  const doors = { getTripDetails: 'participant' };
  const sources = [src('getTripDetails',
    "if (!clearsStep(await callerStep(tripId, user.id, trip.created_by), 'participant')) return 403;")];
  assert.deepEqual(checkDoors(sources, doors), []);

  // ...и ошибается так же, как прямой гейт
  const bad = [src('getTripDetails',
    "if (!clearsStep(await callerStep(tripId, user.id, trip.created_by), 'editor')) return 403;")];
  assert.equal(checkDoors(bad, doors).length, 1);
});

test('★ снятая проверка: манифест ждёт ступень, а гейта в коде нет', () => {
  const doors = { updateTripSettings: 'editor' };
  const sources = [src('updateTripSettings', 'const { data } = await supabaseAdmin.from("trips").update(x);')];
  const errors = checkDoors(sources, doors);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /проверка снята/);
});

test('★ новая дверь без строки в манифесте роняет сборку', () => {
  const sources = [src('somethingNew', 'if (!(await isCallerEditor(t, u))) return 403;')];
  const errors = checkDoors(sources, {});
  assert.equal(errors.length, 1);
  assert.match(errors[0], /не заведена в DOORS/);
});

// ДО тотальной карты этот случай был ТИШИНОЙ — и ровно через него проскочил
// checkSubscriptionStatus: функция не звала гейта, значит стражу её не было
// видно вовсе. Теперь негейтовая дверь обязана быть ОБЪЯВЛЕНА (`token`, `n8n`,
// `owner`, `self`, `auth`, `public`) — тогда «дверь без проверки» отличима от
// «двери, о которой никто не подумал».
test('★ негейтовая дверь без строки в манифесте роняет сборку (тотальная карта)', () => {
  const sources = [src('getPublicTrip', 'if (trip.share_token !== token) return 404;')];
  const errors = checkDoors(sources, {});
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /getPublicTrip/);
  assert.match(errors[0], /не заведена в DOORS/);
});

test('негейтовая дверь с объявительной строкой — тишина', () => {
  const sources = [src('getPublicTrip', 'if (trip.share_token !== token) return 404;')];
  assert.deepEqual(checkDoors(sources, { getPublicTrip: 'token' }), []);
});

test('строка в манифесте без функции ловится (переименовали/удалили)', () => {
  const errors = checkDoors([src('a', 'isCallerEditor(x)')], { a: 'editor', призрак: 'editor' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /призрак/);
});

test('пустой вход не роняет', () => {
  assert.deepEqual(checkDoors([], {}), []);
  assert.deepEqual(checkDoors(undefined, {}), []);
});

// Нашёл ревьюер Codex на PR #684: проверки «объявленная ступень среди
// найденных» мало. Достаточно ослабить сам условный оператор до participant,
// оставив вызов editor где-нибудь рядом, и страж отчитается зелёным о ровно том
// дрейфе, ради которого заведён.
test('★ дверь, зовущая ДВЕ разные ступени, отвергается как неоднозначная', () => {
  const doors = { telegramStartLink: 'editor' };
  const sources = [src('telegramStartLink', `
    const canSee = await isCallerParticipant(tripId, user.id);
    if (!canSee) return 403;                       // ← реально решает участие
    if (rare) await isCallerEditor(tripId, user.id);  // ← а editor остался «рядом»
  `)];
  const errors = checkDoors(sources, doors);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /РАЗНЫЕ ступени/);
});

test('неоднозначность ловится и когда объявленная ступень среди найденных', () => {
  const doors = { x: 'editor' };
  const sources = [src('x', "isCallerEditor(a); clearsStep(s, 'participant');")];
  assert.equal(checkDoors(sources, doors).length, 1);
});

// ── Тотальная карта: объявительные значения и закрытый словарь ───────────────
// Половина дверей гейтится не ступенью: `owner` руками по `trips.created_by`,
// `token` владением секретом, `n8n` — Bearer N8N_SECRET. Страж их НЕ проверяет
// (он читает имена, а не поток управления), но требует объявить: невидимая
// стражу функция — это то, чем был checkSubscriptionStatus.
test('объявительное значение без гейта в коде — тишина', () => {
  const sources = [
    src('deleteTrip', 'if (trip.created_by !== user.id) return 403;'),
    src('triplanioAiReply', 'requireN8nSecret(req);'),
  ];
  assert.deepEqual(checkDoors(sources, { deleteTrip: 'owner', triplanioAiReply: 'n8n' }), []);
});

// Обратное направление: объявили «гейта тут нет», а гейт есть. Либо строка
// врёт, либо ступень появилась и её забыли занести — в обоих случаях манифест
// разошёлся с кодом, а он весь смысл в том, чтобы не расходиться.
test('★ объявительная строка при живом гейте ступени ловится', () => {
  const sources = [src('deleteTrip', "if (!clearsStep(await callerStep(t, u, c), 'participant')) return 403;")];
  const errors = checkDoors(sources, { deleteTrip: 'owner' });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /deleteTrip/);
  assert.match(errors[0], /participant/);
});

// Без закрытого словаря опечатка тихо становится «объявительным»: значение,
// которого страж не знает, он бы просто не проверял — то есть строка выглядит
// решением, а является пропуском.
test('★ неизвестное значение (опечатка) роняет сборку', () => {
  const errors = checkDoors([src('deleteTrip', 'x')], { deleteTrip: 'onwer' });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /onwer/);
  assert.match(errors[0], /допустимые/);
});

test('все объявительные значения словаря принимаются', () => {
  for (const v of ['owner', 'self', 'auth', 'token', 'n8n', 'public']) {
    assert.deepEqual(checkDoors([src('f', 'нет гейта')], { f: v }), [], `значение '${v}'`);
  }
});

// Папка без index.ts стражу не видна ВООБЩЕ — readEdgeSources её пропускает.
// На частичной карте это было терпимо, на тотальной — дыра ровно того же вида,
// что и пропущенная строка: функция есть, стража на ней нет.
test('★ папка функции без index.ts роняет сборку', () => {
  const errors = checkDoors([{ name: 'somethingNew', code: null }], { somethingNew: 'editor' });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /somethingNew/);
  assert.match(errors[0], /index\.ts/);
});

// ── Паритет EDITOR_ROLES ↔ _can_edit_trip (TRIP-274) ────────────────────────
// Одно правило на двух языках. Сегодня совпадают, и расхождение будет МОЛЧАТЬ:
// обе двери отдают 200, просто пускают разных людей. Реальный сценарий — роль
// заводят в SQL и не знают про TS: человек правит бюджет и документы (RLS
// пустила), но получает 403 на настройках и участниках (edge отказал).
// Комментарий этого не удержит: завести роль = написать НОВЫЙ файл миграции,
// комментарий туда не поедет.
const SQL_OK = `CREATE OR REPLACE FUNCTION public._can_edit_trip(p_trip uuid, p_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $function$
  select exists (select 1 from trips t where t.id = p_trip and t.created_by = p_uid)
      or exists (select 1 from trip_members m
                 where m.trip_id = p_trip and m.user_id = p_uid
                   and m.role = any (array['owner','admin'])
                   and m.status = 'active');
$function$`;
const TS_OK = `export const EDITOR_ROLES = ['owner', 'admin'];`;

test('паритет ролей: списки совпали — тишина', () => {
  assert.deepEqual(checkEditorRoles(SQL_OK, TS_OK), []);
});

test('порядок и пробелы значения не имеют', () => {
  assert.deepEqual(checkEditorRoles(SQL_OK, `export const EDITOR_ROLES = [ 'admin' ,\n  'owner' ];`), []);
});

// pg_get_functiondef печатает литералы с явным приведением типа.
test('приведение ::text в SQL-литералах не мешает', () => {
  const casted = SQL_OK.replace("array['owner','admin']", "ARRAY['owner'::text, 'admin'::text]");
  assert.deepEqual(checkEditorRoles(casted, TS_OK), []);
});

test('★ роль завели в SQL и забыли в TS → ошибка с обоими списками', () => {
  const sql = SQL_OK.replace("array['owner','admin']", "array['owner','admin','editor']");
  const errors = checkEditorRoles(sql, TS_OK);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /editor/);
  assert.match(errors[0], /owner/);
  assert.match(errors[0], /admin/);
});

test('★ расхождение в обратную сторону ловится так же', () => {
  const errors = checkEditorRoles(SQL_OK, `export const EDITOR_ROLES = ['owner', 'admin', 'editor'];`);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /editor/);
});

// Самая тихая поломка: разбор перестал находить список. Сравнение с пустым
// множеством дало бы «совпало» на функции, которую переписали до неузнаваемости.
test('★ тело функции без списка ролей → ошибка, а не молчаливое совпадение', () => {
  const rewritten = SQL_OK.replace("m.role = any (array['owner','admin'])", 'm.role_id in (select id from editor_roles)');
  const errors = checkEditorRoles(rewritten, TS_OK);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /_can_edit_trip/);
});

test('★ TS без EDITOR_ROLES → ошибка, а не молчаливое совпадение', () => {
  const errors = checkEditorRoles(SQL_OK, 'export const SOMETHING_ELSE = 1;');
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /EDITOR_ROLES/);
});

test('пустой/отсутствующий вход не молчит', () => {
  assert.equal(checkEditorRoles('', TS_OK).length, 1);
  assert.equal(checkEditorRoles(SQL_OK, '').length, 1);
  assert.equal(checkEditorRoles(null, null).length, 2);
});

// Двойные кавычки в TS: переформатирование tripStep.ts не должно давать
// ВЕРНОЕ падение с ВРУЩИМ диагнозом («EDITOR_ROLES не нашёлся» вместо разбора).
test('EDITOR_ROLES в двойных кавычках читается', () => {
  assert.deepEqual(checkEditorRoles(SQL_OK, 'export const EDITOR_ROLES = ["owner", "admin"];'), []);
});

// ── SEAM-ДВЕРИ: гейт живёт в спецификации ресурса, а не в index.ts (TRIP-394) ──
// Дверь, чей index.ts просто зовёт `mutate({ slug })`, гейта в index.ts НЕ несёт
// — её право (`requires` на каждом действии) держит спецификация ресурса
// `_shared/resources/<slug>.ts` и исполняет общий `_shared/mutate.ts`. Прежний
// страж такую дверь мог только ПРИНЯТЬ на слово (объявительное значение). Здесь
// он её ПРОВЕРЯЕТ: манифест обязан машинно совпасть с `requires` спецификации.

const seamSrc = (name, slug) =>
  ({ name, code: `Deno.serve(withHandler('${name}', (req, cors) => mutate({ req, slug: '${slug}', corsHeaders: cors })));` });

// Спецификация ресурса как ТЕКСТ (парсер читает файл, не импортирует TS).
const specText = (slug, requiresPerAction) => ({
  name: `${slug}.ts`,
  text: `export const R = { name: '${slug}', scope: { column: 'trip_id', from: 'tripId' }, actions: {\n` +
    requiresPerAction.map((req, i) =>
      `  a${i}: { op: 'upsert', table: 't', requires: [${req.map((r) => `'${r}'`).join(', ')}] },`).join('\n') +
    `\n} };`,
});

const TOKENS = new Set(['editor', 'self', 'pro']);

test('parseSeamSlug: достаёт slug из mutate({slug}), иначе null', () => {
  assert.equal(parseSeamSlug("mutate({ req, slug: 'trip-budget', corsHeaders: cors })"), 'trip-budget');
  assert.equal(parseSeamSlug('if (!(await isCallerEditor(t,u))) return 403;'), null);
});

test('parseResourceSpecs: имя ресурса + requires по каждому действию', () => {
  const specs = parseResourceSpecs([specText('trip-budget', [['editor', 'pro'], ['editor', 'pro']])]);
  const s = specs.get('trip-budget');
  assert.ok(s, 'ресурс не разобран');
  assert.deepEqual(s.requiresSets, [['editor', 'pro'], ['editor', 'pro']]);
});

test('parseGateTokensFromSeam: словарь гейтов берётся из checkRequirement шва', () => {
  const seam = "switch (name) {\n case 'editor': return x;\n case 'self': return y;\n case 'pro': { return z; }\n }";
  assert.deepEqual([...parseGateTokensFromSeam(seam)].sort(), ['editor', 'pro', 'self']);
});

test('здоровая seam-дверь: манифест-набор == requires спецификации', () => {
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: ['editor', 'pro'] };
  const specs = parseResourceSpecs([specText('trip-budget', [['editor', 'pro'], ['editor', 'pro']])]);
  assert.deepEqual(checkSeamDoors({ sources, doors, specs, gateTokens: TOKENS, expectSeam: true }), []);
});

test('★ манифест врёт про гейт (editor вместо editor+pro) → красный', () => {
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: ['editor'] };
  const specs = parseResourceSpecs([specText('trip-budget', [['editor', 'pro']])]);
  const errors = checkSeamDoors({ sources, doors, specs, gateTokens: TOKENS, expectSeam: true });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /манифест.*спецификаци/i);
});

test('★ спецификация сменила requires, манифест прежний → красный (та же сверка, другая сторона)', () => {
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: ['editor', 'pro'] };
  const specs = parseResourceSpecs([specText('trip-budget', [['editor']])]); // pro сняли из спеки
  const errors = checkSeamDoors({ sources, doors, specs, gateTokens: TOKENS, expectSeam: true });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /манифест.*спецификаци/i);
});

test('★ seam-дверь объявлена СТРОКОЙ, а не набором → красный', () => {
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: 'editor+pro' };
  const specs = parseResourceSpecs([specText('trip-budget', [['editor', 'pro']])]);
  const errors = checkSeamDoors({ sources, doors, specs, gateTokens: TOKENS, expectSeam: true });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /набор|массив/i);
});

test('★ фиктивная seam-дверь без строки в манифесте → красный', () => {
  const sources = [seamSrc('trip_widget', 'trip-widget')];
  const specs = parseResourceSpecs([specText('trip-widget', [['editor']])]);
  const errors = checkSeamDoors({ sources, doors: {}, specs, gateTokens: TOKENS, expectSeam: true });
  assert.ok(errors.some((e) => /trip_widget/.test(e) && /манифест|DOORS/i.test(e)), JSON.stringify(errors));
});

test('★ seam-дверь без спецификации ресурса → красный', () => {
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: ['editor', 'pro'] };
  const errors = checkSeamDoors({ sources, doors, specs: new Map(), gateTokens: TOKENS, expectSeam: true });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /спецификаци/i);
});

test('★ действия ресурса требуют РАЗНОЕ → красный (одной строкой не выразить)', () => {
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: ['editor', 'pro'] };
  const specs = parseResourceSpecs([specText('trip-budget', [['editor', 'pro'], ['editor']])]);
  const errors = checkSeamDoors({ sources, doors, specs, gateTokens: TOKENS, expectSeam: true });
  assert.ok(errors.some((e) => /РАЗНОЕ|неоднородн/i.test(e)), JSON.stringify(errors));
});

// Спецификация с requires НЕ литеральным массивом (переменная/константа) —
// парсер её не видит; собираем текст вручную.
const specTextRaw = (slug, actionsBody) => ({
  name: `${slug}.ts`,
  text: `export const R = { name: '${slug}', scope: { column: 'trip_id', from: 'tripId' }, actions: {\n${actionsBody}\n} };`,
});

test('★ P1 датчик слепоты: parseResourceSpecs считает НЕлитеральные requires', () => {
  const specs = parseResourceSpecs([specTextRaw('trip-budget',
    "  a0: { op: 'upsert', table: 't', requires: ['editor', 'pro'] },\n" +
    "  a1: { op: 'upsert', table: 't', requires: EDITOR_PRO },")]);
  const s = specs.get('trip-budget');
  assert.equal(s.requiresSets.length, 1, 'литеральный requires ровно один');
  assert.equal(s.nonLiteralRequires, 1, 'один requires — переменная, датчик обязан её заметить');
});

test('★ P1: seam-дверь с requires-переменной → красный (сверка не над полным набором)', () => {
  // Раньше действие с `requires: CONST` МОЛЧА выпадало, и сверка зеленела над
  // неполным набором. Теперь такой ресурс роняет прогон.
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: ['editor', 'pro'] };
  const specs = parseResourceSpecs([specTextRaw('trip-budget',
    "  a0: { op: 'upsert', table: 't', requires: ['editor', 'pro'] },\n" +
    "  a1: { op: 'upsert', table: 't', requires: EDITOR_PRO },")]);
  const errors = checkSeamDoors({ sources, doors, specs, gateTokens: TOKENS, expectSeam: true });
  assert.ok(errors.some((e) => /литеральн|P1/i.test(e)), JSON.stringify(errors));
});

test('★ P2: манифест того же состава, но ДРУГОГО порядка → красный', () => {
  // Шов исполняет requires ПО ПОРЯДКУ (editor раньше pro). `['pro','editor']` ≠
  // `['editor','pro']`: как множества равны (прежний eqSet зеленел — дыра), по
  // порядку — нет.
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: ['pro', 'editor'] };
  const specs = parseResourceSpecs([specText('trip-budget', [['editor', 'pro']])]);
  const errors = checkSeamDoors({ sources, doors, specs, gateTokens: TOKENS, expectSeam: true });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /порядк/i);
});

test('★ P2: действия одного состава, но разного ПОРЯДКА → неоднородны (красный)', () => {
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: ['editor', 'pro'] };
  const specs = parseResourceSpecs([specText('trip-budget', [['editor', 'pro'], ['pro', 'editor']])]);
  const errors = checkSeamDoors({ sources, doors, specs, gateTokens: TOKENS, expectSeam: true });
  assert.ok(errors.some((e) => /РАЗНОЕ|неоднородн/i.test(e)), JSON.stringify(errors));
});

test('★ неизвестный гейт в спецификации (шов его не реализует) → красный', () => {
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: ['editor', 'admin'] };
  const specs = parseResourceSpecs([specText('trip-budget', [['editor', 'admin']])]);
  const errors = checkSeamDoors({ sources, doors, specs, gateTokens: TOKENS, expectSeam: true });
  assert.ok(errors.some((e) => /admin/.test(e) && /неизвестн|не реализ/i.test(e)), JSON.stringify(errors));
});

test('★ ДАТЧИК СЛЕПОТЫ: ждём seam-дверь, а разбор нашёл ноль → красный', () => {
  // Сломанный парс mutate({slug}) не должен ТИХО пройти seam-сверку.
  const sources = [src('getTripDetails', 'if (!isCallerParticipant(t,u)) return 403;')];
  const errors = checkSeamDoors({ sources, doors: {}, specs: new Map(), gateTokens: TOKENS, expectSeam: true });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /ни одной seam|датчик|разбор/i);
});

test('★ не-seam функция с массивом-значением в манифесте → красный', () => {
  // Массив = seam-набор; у обычной функции его быть не должно.
  const sources = [src('updateTripSettings', 'if (!(await isCallerEditor(t,u))) return 403;')];
  const doors = { updateTripSettings: ['editor'] };
  const errors = checkSeamDoors({ sources, doors, specs: new Map(), gateTokens: TOKENS, expectSeam: false });
  assert.ok(errors.some((e) => /updateTripSettings/.test(e) && /не.*seam|не маршрут/i.test(e)), JSON.stringify(errors));
});

test('checkDoors НЕ трогает seam-двери (их код зовёт mutate, гейта в index нет)', () => {
  // Старый страж принял бы это за «проверка снята». Теперь checkDoors их пропускает.
  const sources = [seamSrc('trip_budget', 'trip-budget')];
  const doors = { trip_budget: ['editor', 'pro'] };
  assert.deepEqual(checkDoors(sources, doors), []);
});

test('обычные двери проверяются как раньше (регресс не ослаблен)', () => {
  const doors = { telegramStartLink: 'editor' };
  const sources = [src('telegramStartLink', 'const ok = await isCallerParticipant(t, u);')];
  const errors = checkDoors(sources, doors);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /не ту ступень/);
});
