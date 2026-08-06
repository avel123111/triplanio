/**
 * CI guard — Security tier drift (TRIP-120 / TRIP-190 Ф4).
 *
 * Единственный источник истины = scripts/ci/security-tiers.mjs (манифест ярусов).
 * Инварианты RLS/грантов (I1-I5) держатся не «разово», а этим стражем:
 *
 * Две «двери» к данным: таблицы (прямой SQL, гейт = гранты+RLS) и SECURITY DEFINER
 * функции (privileged bypass RLS, гейт = EXECUTE-грант + проверка в теле). Страж
 * держит обе.
 *
 *   STATIC (без БД, PR-гейт в checks.yml, шаг 2e) — валидирует сам манифест:
 *     * каждая таблица в валидном ярусе (A/B/C/D);
 *     * anonDml=false ВЕЗДЕ (I3a — anon не пишет никуда);
 *     * authDml=true только на ярусах A и C (I3b — B/D без клиентской записи);
 *     * FUNCTIONS: publicExec ∩ authExec = ∅, authzExempt ⊆ client-вызываемых.
 *     * DOORS (TRIP-274): какую СТУПЕНЬ зовёт каждая edge-функция — сверяется с
 *       манифестом чтением её исходника. Дыра, ради которой это заведено, была
 *       не в правиле и не в политике: гранты в порядке, политики в порядке,
 *       тесты правила зелёные, а telegramStartLink спрашивал «ты участник?»
 *       там, где нужно «ты редактор?». Ни одна другая проверка такого не видит.
 *   Ловит попытку «ослабить» правило редактированием манифеста.
 *
 *   LIVE (SECURITY_TIERS_DB_URL задан, post-deploy в supabase-deploy.yml) —
 *   сверяет ЖИВУЮ БД с манифестом через psql:
 *     ТАБЛИЦЫ:
 *     * anon имеет DML на таблице  → FAIL всегда (I3a);
 *     * authenticated имеет DML там, где манифест это запрещает → FAIL (I3b + новая
 *       незаклассифицированная таблица);
 *     * таблица яруса A без роль-осведомлённой write-политики (can_edit_trip) → FAIL (I2).
 *     ФУНКЦИИ (secdef):
 *     * функция из authExec исполнима anon → FAIL (IF2);
 *     * client-вызываемая secdef не в манифесте (грабля PUBLIC EXECUTE) → FAIL (IF3);
 *     * client-вызываемая secdef без ссылки на авторизацию в теле → FAIL (IF4, кроме
 *       authzExempt) — ловит мутатор, забывший проверить права.
 *     STORAGE (бакеты):
 *     * флаг public бакета разошёлся с манифестом / публичный бакет с SELECT-политикой
 *       (анонимный листинг, TRIP-48) → FAIL;
 *     * заявленная политика отсутствует ИЛИ стоит не на том предикате, что объявлен
 *       в BUCKETS.readPredicate/writePredicate → FAIL (TRIP-274).
 *   Ловит дрейф, внесённый миграцией, сразу после накатывания.
 *
 * Модель совпадает с ассертом verify_jwt: PR-гейт статики + пост-деплой live-ассерт.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { TABLES, TIERS, FUNCTIONS, BUCKETS, DOORS, DOORS_VALUES, STEP_VALUES } from './security-tiers.mjs';

const VALID_TIERS = new Set(Object.keys(TIERS)); // A B C D
const err = (m) => { console.error(`::error::${m}`); };

// ── STATIC: манифест самосогласован ──────────────────────────────────────────
function checkStatic() {
  let fail = 0;
  for (const [t, r] of Object.entries(TABLES)) {
    if (!VALID_TIERS.has(r.tier)) { err(`манифест: '${t}' — неизвестный ярус '${r.tier}'`); fail = 1; }
    // I3a — anon не пишет никуда, без исключений.
    if (r.anonDml !== false) { err(`манифест: '${t}' — anonDml должен быть false (I3a)`); fail = 1; }
    // I3b — клиентская запись (authenticated DML) только на A и C.
    const mayAuthWrite = r.tier === 'A' || r.tier === 'C';
    if (r.authDml === true && !mayAuthWrite) { err(`манифест: '${t}' — authDml=true запрещён на ярусе ${r.tier} (I3b)`); fail = 1; }
    if (r.authDml !== true && mayAuthWrite) { err(`манифест: '${t}' — ярус ${r.tier} ожидает authDml=true`); fail = 1; }
  }
  // FUNCTIONS: списки строк; publicExec ∩ authExec = ∅; authzExempt ⊆ client-вызываемых.
  for (const k of ['publicExec', 'authExec', 'authzExempt']) {
    if (!Array.isArray(FUNCTIONS[k])) { err(`манифест FUNCTIONS.${k} должен быть массивом`); fail = 1; }
  }
  const overlap = (FUNCTIONS.publicExec || []).filter((x) => (FUNCTIONS.authExec || []).includes(x));
  if (overlap.length) { err(`манифест FUNCTIONS: ${overlap.join(', ')} в publicExec И authExec одновременно`); fail = 1; }
  const callable = new Set([...(FUNCTIONS.publicExec || []), ...(FUNCTIONS.authExec || [])]);
  for (const x of FUNCTIONS.authzExempt || []) {
    if (!callable.has(x)) { err(`манифест FUNCTIONS.authzExempt: '${x}' не client-вызываема (нет в publicExec/authExec)`); fail = 1; }
  }
  // BUCKETS: public — булев, policies — массив.
  for (const [b, r] of Object.entries(BUCKETS)) {
    if (typeof r.public !== 'boolean') { err(`манифест BUCKETS.${b}.public должен быть boolean`); fail = 1; }
    if (!Array.isArray(r.policies)) { err(`манифест BUCKETS.${b}.policies должен быть массивом`); fail = 1; }
    // TRIP-274: объявленный предикат обязан быть непустой строкой — пустая
    // прошла бы `includes()` на ЛЮБОЙ политике и выключила проверку молча.
    for (const k of ['readPredicate', 'writePredicate']) {
      if (r[k] === undefined) continue;
      if (typeof r[k] !== 'string' || !r[k].trim()) { err(`манифест BUCKETS.${b}.${k} должен быть непустой строкой`); fail = 1; }
    }
    // Приватный бакет с write-предикатом обязан объявить и read: иначе
    // «чтение ужалось до редакторов» проверять не с чем.
    if (r.writePredicate && !r.readPredicate && (r.policies || []).includes('select')) {
      err(`манифест BUCKETS.${b}: есть writePredicate и политика select, но нет readPredicate`); fail = 1;
    }
  }
  // ДВЕРИ (TRIP-274) — сверка «какую ступень зовёт функция» с манифестом.
  const sources = readEdgeSources();
  if (sources.length === 0) {
    err('манифест DOORS: не найдено ни одной edge-функции — страж запущен не из корня репо?');
    fail = 1;
  } else {
    for (const m of checkDoors(sources)) { err(m); fail = 1; }
  }

  if (!fail) console.log(`check-security-tiers [static]: манифест согласован — ${Object.keys(TABLES).length} таблиц + ${callable.size} client-вызываемых функций + ${Object.keys(BUCKETS).length} бакета + ${Object.keys(DOORS).length} дверей (из ${sources.length} edge-функций), ярусы ${[...VALID_TIERS].join('/')} — OK`);
  return fail;
}

// ── ДВЕРИ: какую ступень зовёт каждая edge-функция (TRIP-274) ────────────────
// Чистая половина, ради теста. `sources` — [{ name, code }], code = ТЕКСТ
// index.ts без комментариев (комментарии режет вызывающий: они упоминают
// соседние гейты и дали бы ложные срабатывания).
//
// Ступень, которую функция РЕАЛЬНО требует, читается из вызовов:
//   isCallerEditor(…)                → editor
//   isCallerParticipant(…)           → participant
//   clearsStep(…, 'editor'|'participant') → соответственно (форма callerStep)
//
// Карта ТОТАЛЬНАЯ: строка обязана быть у каждой функции, включая негейтовые.
// Проверяются из них только ступени; остальные значения — объявительные, см.
// DOORS_VALUES и абзац «что страж НЕ ловит» в шапке DOORS.
export function checkDoors(sources = [], doors = DOORS) {
  const errors = [];
  // Найденные ступени печатаются отсортированными во ВСЕХ сообщениях: порядок
  // множества — порядок регулярок выше, читателю ошибки он ничего не говорит.
  const found = (set) => [...set].sort().join(', ');

  for (const [name, value] of Object.entries(doors)) {
    if (!DOORS_VALUES.has(value)) {
      errors.push(`дверь '${name}': значение '${value}' не из словаря — допустимые: ${[...DOORS_VALUES].join(', ')}`);
    }
  }

  for (const { name, code } of sources) {
    // Папка функции без index.ts: readEdgeSources отдаёт её с code = null.
    // Раньше такая папка стражу не показывалась вовсе — на тотальной карте это
    // дыра того же вида, что и пропущенная строка.
    if (code == null) {
      errors.push(`дверь '${name}': в папке функции нет index.ts — страж не видит её кода; переименуй точку входа или удали папку`);
      continue;
    }

    const required = new Set();
    if (/\bisCallerEditor\s*\(/.test(code)) required.add('editor');
    if (/\bisCallerParticipant\s*\(/.test(code)) required.add('participant');
    for (const m of code.matchAll(/\bclearsStep\s*\([\s\S]*?,\s*'(editor|participant|owner)'\s*\)/g)) {
      required.add(m[1]);
    }

    const declared = doors[name];
    if (!declared) {
      // Тотальность. Раньше молчанием отвечалось «функция гейта не зовёт» — и
      // ровно так стражу был невидим checkSubscriptionStatus, единственная
      // дверь к данным трипа вообще без проверки. Теперь ЛЮБАЯ функция обязана
      // иметь строку: тогда «проверки нет осознанно» отличимо от «о функции
      // никто не подумал», а новая папка роняет сборку.
      errors.push(required.size
        ? `дверь '${name}': зовёт ступень (${found(required)}), но не заведена в DOORS — заведи строку, чтобы решение было принято явно`
        : `дверь '${name}': не заведена в DOORS — карта тотальная, объяви чем гейтится (${[...DOORS_VALUES].join(', ')})`);
      continue;
    }

    if (!STEP_VALUES.has(declared)) {
      // Объявительное значение: страж такую дверь не проверяет. Но живой гейт
      // ступени под ней — расхождение манифеста с кодом в другую сторону.
      if (required.size) {
        errors.push(`дверь '${name}': объявлена как '${declared}' (страж не проверяет), но код зовёт ступень '${found(required)}' — либо строка врёт, либо ступень появилась и её не занесли`);
      }
      continue;
    }

    if (required.size === 0) {
      // Ступень ЗАЯВЛЕНА, а гейта нет — снятая проверка, самый опасный дрейф.
      errors.push(`дверь '${name}': манифест требует ступень '${declared}', но функция не зовёт ни одного гейта — проверка снята?`);
      continue;
    }
    // Две разные ступени в одной функции — страж не может сказать, КОТОРАЯ из
    // них решает. Проверки «объявленная среди найденных» мало: достаточно
    // ослабить сам условный оператор до participant, оставив вызов editor
    // где-нибудь рядом, и страж отчитается зелёным о ровно том дрейфе, ради
    // которого заведён. Сегодня каждая дверь зовёт ровно одну ступень, поэтому
    // неоднозначность = отказ; понадобится честная дверь на две ступени —
    // разнести их по функциям или расширить манифест осознанно.
    if (required.size > 1) {
      errors.push(`дверь '${name}': зовёт РАЗНЫЕ ступени (${found(required)}) — страж не может определить, которая решает; оставь одну`);
      continue;
    }
    if (!required.has(declared)) {
      errors.push(`дверь '${name}': манифест требует '${declared}', код зовёт '${found(required)}' — гейт спрашивает не ту ступень`);
    }
  }

  // Строка манифеста, под которой нет функции: переименовали или удалили, а
  // запись осталась — манифест начал врать. Случай «функция есть, но гейта нет»
  // уже отчитан выше как «проверка снята».
  for (const name of Object.keys(doors)) {
    if (!sources.some((s) => s.name === name)) {
      errors.push(`дверь '${name}' есть в DOORS, но функции с таким именем нет — переименована или удалена?`);
    }
  }
  return errors;
}

// ── Паритет EDITOR_ROLES ↔ _can_edit_trip (TRIP-274) ────────────────────────
// Здесь сверяются ДВЕ СЕРВЕРНЫЕ половины одного правила — единственная пара,
// расхождение которой не видно ниоткуда: обе двери отдают 200, просто пускают
// разных людей. Полный список мест, где живёт роль, и почему комментарий его не
// удержит — канон в шапке `EDITOR_ROLES` (_shared/tripStep.ts).
const TRIP_STEP_FILE = 'supabase/functions/_shared/tripStep.ts';
// Тело `_can_edit_trip` (pg_get_functiondef) и `EDITOR_ROLES` в tripStep.ts:
// разные обёртки вокруг одного и того же списка литералов в квадратных скобках.
const SQL_ROLE_LIST = /\brole\s*=\s*any\s*\(\s*array\s*\[([^\]]*)\]/i;
const TS_ROLE_LIST = /\bEDITOR_ROLES\s*=\s*\[([^\]]*)\]/;

/** Роли из первого совпадения `re`, либо null — не нашлось.
 *  Литералы в SQL печатаются с ::text — приведение отбрасываем. */
function parseRoleList(re, text) {
  const m = re.exec(text || '');
  if (!m) return null;
  // Кавычка любая: SQL печатает одинарные, TS-файл переформатируют на двойные —
  // это дало бы верное падение с врущим диагнозом («список не нашёлся»).
  const roles = [...m[1].matchAll(/['"]([^'"]*)['"]/g)].map((q) => q[1]);
  return roles.length ? roles : null;
}

/**
 * Чистая половина ради теста. Возвращает список ошибок.
 *
 * Ненайденный список — ОШИБКА, а не пустое множество: сравнение пустого с
 * пустым дало бы «совпало» на функции, переписанной до неузнаваемости, то есть
 * проверка молча перестала бы проверять. Это исходный класс дефекта, ради
 * которого весь TRIP-274.
 */
export function checkEditorRoles(sqlDef, tsSource) {
  const errors = [];
  const sql = parseRoleList(SQL_ROLE_LIST, sqlDef);
  const ts = parseRoleList(TS_ROLE_LIST, tsSource);
  if (!sql) errors.push('паритет ролей: в теле _can_edit_trip не нашёлся список ролей (`role = any (array[...])`) — функцию переписали; сверять не с чем, почини разбор или сверку');
  if (!ts) errors.push('паритет ролей: в _shared/tripStep.ts не нашёлся EDITOR_ROLES — переименовали? сверять не с чем');
  if (!sql || !ts) return errors;

  // Сравниваем как МНОЖЕСТВА: порядок и повтор в списке ролей ничего не значат.
  const sqlSorted = [...new Set(sql)].sort();
  const tsSorted = [...new Set(ts)].sort();
  if (sqlSorted.join(',') !== tsSorted.join(',')) {
    errors.push(`паритет ролей разошёлся: SQL _can_edit_trip = [${sqlSorted.join(', ')}], TS EDITOR_ROLES = [${tsSorted.join(', ')}] — одно правило на двух языках, обе двери отдадут 200 и пустят разных людей`);
  }
  return errors;
}

/** Читает edge-функции с диска и режет комментарии. */
function readEdgeSources(root = 'supabase/functions') {
  if (!existsSync(root)) return [];
  const out = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith('_')) continue;
    const file = `${root}/${dir.name}/index.ts`;
    // Папка без index.ts НЕ пропускается: на тотальной карте невидимая стражу
    // функция — та же дыра, что и пропущенная строка. Отдаём с code = null,
    // решение (ошибка) принимает checkDoors.
    // Комментарии — вон: они называют соседние гейты и врали бы стражу.
    const code = existsSync(file)
      ? readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      : null;
    // Имя папки с дефисом не бывает ключом объекта — нормализуем как в DOORS.
    out.push({ name: dir.name.replace(/-/g, '_'), code });
  }
  return out;
}

// ── Предикаты storage-политик (TRIP-274) ─────────────────────────────────────
const WRITE_CMDS = ['insert', 'update', 'delete'];

// Чистая функция ради теста: вся развилка «какая политика каким предикатом
// обязана быть» проверяется на фикстурах, без живой БД. Наличие политики ловит
// проверка ниже — здесь только ТЕКСТ.
// `policies` — [{ name, pred }] из pg_policies (pred = qual + with_check).
// Возвращает массив сообщений об ошибках (пустой = всё сошлось).
// Ищем ВЫЗОВ функции, а не подстроку: `_can_read_x` не должен находиться внутри
// `_can_read_x_write(...)`. Имя обязано стоять на границе идентификатора и иметь
// открывающую скобку — так политика `public.f(name)` матчится, а однокоренной
// сосед нет. Без этого проверка «read-предикат в write-политике» даёт ЛОЖНОЕ
// срабатывание на любой паре, где одно имя — префикс другого.
const callsPredicate = (policyText, fnName) =>
  new RegExp(`(^|[^A-Za-z0-9_])${fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`).test(policyText);

export function checkBucketPredicates(policies = [], buckets = BUCKETS) {
  const predOf = new Map(policies.map((p) => [p.name, p.pred || '']));
  const errors = [];

  for (const [bucket, r] of Object.entries(buckets)) {
    const { readPredicate, writePredicate } = r;
    if (!readPredicate && !writePredicate) continue; // бакет без объявленных предикатов — только проверка наличия

    // undefined = политики нет вовсе; это ловит проверка наличия, не эта.
    const selectPred = predOf.get(`${bucket}_select`);
    if (selectPred !== undefined) {
      if (readPredicate && !callsPredicate(selectPred, readPredicate)) {
        errors.push(`storage-дрейф: политика '${bucket}_select' не ссылается на read-предикат '${readPredicate}' — чтение бакета '${bucket}' держит кто-то другой`);
      }
      // Ужесточение SELECT до write-предиката — регрессия чтения: участник
      // перестаёт видеть файлы трипа. Молчаливая, потому что политика на месте.
      if (writePredicate && callsPredicate(selectPred, writePredicate)) {
        errors.push(`storage-дрейф: политика '${bucket}_select' ссылается на write-предикат '${writePredicate}' — чтение ужалось до редакторов`);
      }
    }

    if (!writePredicate) continue;
    for (const cmd of WRITE_CMDS) {
      if (!(r.policies || []).includes(cmd)) continue;
      const cmdPred = predOf.get(`${bucket}_${cmd}`);
      if (cmdPred === undefined) continue;
      if (!callsPredicate(cmdPred, writePredicate)) {
        errors.push(`storage-дрейф: политика '${bucket}_${cmd}' не ссылается на write-предикат '${writePredicate}' — запись в бакет '${bucket}' гейтится не той ступенью`);
      }
      // Присутствия write-предиката МАЛО: политики склеиваются через OR, поэтому
      // `read(name) OR write(name)` содержит write и всё равно пускает участника.
      // Гейт обходится дизъюнкцией, а страж при этом печатает OK — ровно тот
      // класс молчаливого «политика есть, но пускает не тех», ради которого эта
      // проверка и заводилась. Поэтому read-предикат в write-политике запрещён.
      if (readPredicate && callsPredicate(cmdPred, readPredicate)) {
        errors.push(`storage-дрейф: политика '${bucket}_${cmd}' ссылается на read-предикат '${readPredicate}' — запись открыта участнику по OR-ветке, write-гейт обойдён`);
      }
    }
  }
  return errors;
}

// ── LIVE: живая БД совпадает с манифестом ─────────────────────────────────────
const LIVE_SQL = `select json_build_object(
  'grants', coalesce((select json_agg(json_build_object('t',t,'anon',anon,'auth',auth)) from (
     select c.relname t,
       coalesce(bool_or(x.grantee::regrole::text='anon' and x.privilege_type in ('INSERT','UPDATE','DELETE')),false) anon,
       coalesce(bool_or(x.grantee::regrole::text='authenticated' and x.privilege_type in ('INSERT','UPDATE','DELETE')),false) auth
     from pg_class c
     join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
     left join lateral aclexplode(c.relacl) x on true
     where c.relkind='r' group by c.relname) g), '[]'::json),
  'tierA_role', coalesce((select json_agg(distinct tablename) from pg_policies
     where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
       and (coalesce(qual,'') ilike '%can_edit_trip%' or coalesce(with_check,'') ilike '%can_edit_trip%')), '[]'::json),
  'functions', coalesce((select json_agg(json_build_object(
     'name', p.proname,
     'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
     'auth', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
     'authz', (pg_get_functiondef(p.oid) ~* '(_can_edit_trip|is_trip_participant|is_trip_creator|is_trip_owner|is_trip_pro|is_user_pro|auth\\.(uid|email|jwt|role)\\(\\))')
   )) from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' where p.prosecdef), '[]'::json),
  -- Тело _can_edit_trip ЦЕЛИКОМ: 'authz' выше — булево «есть ли упоминание
  -- авторизации», по нему список ролей не сверить. Нужен текст (TRIP-274).
  'can_edit_def', coalesce((select pg_get_functiondef(p.oid) from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
     where p.proname='_can_edit_trip' limit 1), ''),
  'buckets', coalesce((select json_agg(json_build_object('id', id, 'public', public)) from storage.buckets), '[]'::json),
  'storage_policies', coalesce((select json_agg(json_build_object(
     'name', policyname,
     -- Текст политики целиком: USING + WITH CHECK. Нужен, чтобы сверять ПРЕДИКАТ
     -- бакета, а не факт существования политики (TRIP-274).
     'pred', coalesce(qual,'') || ' ' || coalesce(with_check,'')
   )) from pg_policies where schemaname='storage' and tablename='objects'), '[]'::json)
)`;

function checkLive(dbUrl) {
  let raw;
  try {
    raw = execFileSync('psql', [dbUrl, '-tAc', LIVE_SQL], { encoding: 'utf8' }).trim();
  } catch (e) {
    err(`check-security-tiers [live]: psql не смог опросить БД: ${e.message}`);
    return 1;
  }
  const live = JSON.parse(raw);
  const grants = live.grants || [];
  const tierARole = new Set(live.tierA_role || []);
  let fail = 0;

  for (const g of grants) {
    const m = TABLES[g.t];
    // I3a — anon DML недопустим нигде.
    if (g.anon) { err(`live-дрейф: anon имеет DML на public.${g.t} (I3a — снять грант)`); fail = 1; }
    // I3b + незаклассифицированная таблица.
    if (g.auth) {
      if (!m) { err(`live-дрейф: public.${g.t} не в манифесте, но authenticated имеет DML — заведи ярус в security-tiers.mjs`); fail = 1; }
      else if (m.authDml !== true) { err(`live-дрейф: authenticated имеет DML на public.${g.t} (ярус ${m.tier} запрещает)`); fail = 1; }
    }
  }
  // I2 — таблицы яруса A обязаны иметь роль-осведомлённую write-политику.
  for (const [t, r] of Object.entries(TABLES)) {
    if (r.tier === 'A' && !tierARole.has(t)) {
      err(`live-дрейф: ярус-A таблица public.${t} без write-политики на can_edit_trip (I2)`);
      fail = 1;
    }
  }

  // ── FUNCTIONS: EXECUTE-гранты secdef-функций + tripwire авторизации ──
  const funcs = live.functions || [];
  const pub = new Set(FUNCTIONS.publicExec || []);
  const authE = new Set(FUNCTIONS.authExec || []);
  const exempt = new Set(FUNCTIONS.authzExempt || []);
  for (const f of funcs) {
    if (pub.has(f.name)) {
      // anon+auth ожидаемы; строже (anon=false) — не security-дрейф, пропускаем.
    } else if (authE.has(f.name)) {
      // IF2 — только authenticated; anon обязан быть false.
      if (f.anon) { err(`live-дрейф: secdef ${f.name} исполнима anon (authExec ожидает только authenticated)`); fail = 1; }
    } else {
      // IF3 — internal-функция не должна быть client-вызываемой (грабля PUBLIC EXECUTE).
      if (f.anon || f.auth) { err(`live-дрейф: secdef ${f.name} client-исполнима, но не в манифесте (publicExec/authExec) — заведи или REVOKE EXECUTE`); fail = 1; }
    }
    // IF4 — client-вызываемая функция обязана ссылаться на авторизацию в теле.
    if ((f.anon || f.auth) && !exempt.has(f.name) && !f.authz) {
      err(`live-дрейф: secdef ${f.name} client-исполнима без ссылки на авторизацию в теле (добавь проверку прав или внеси в FUNCTIONS.authzExempt с обоснованием)`);
      fail = 1;
    }
  }

  // ── ПАРИТЕТ РОЛЕЙ: живой _can_edit_trip против TS EDITOR_ROLES ──
  // Живой, а не из миграции: роль могли завести и мимо репо. TS-половину берём
  // с диска — edge-модуль в .mjs не импортируется (граница рантаймов, приём из
  // fileType.test.js), поэтому читаем его как ТЕКСТ.
  const tsStep = existsSync(TRIP_STEP_FILE) ? readFileSync(TRIP_STEP_FILE, 'utf8') : '';
  for (const m of checkEditorRoles(live.can_edit_def, tsStep)) { err(`live-дрейф: ${m}`); fail = 1; }

  // ── STORAGE: флаг public бакета + наличие политик + их ПРЕДИКАТ ──
  const bucketPublic = Object.fromEntries((live.buckets || []).map((b) => [b.id, b.public]));
  const storagePolicies = live.storage_policies || [];
  const spol = new Set(storagePolicies.map((p) => p.name));
  // TRIP-274 — политика может существовать и при этом пускать не ту ступень.
  for (const m of checkBucketPredicates(storagePolicies, BUCKETS)) { err(m); fail = 1; }
  for (const [name, r] of Object.entries(BUCKETS)) {
    if (!(name in bucketPublic)) { err(`storage-дрейф: бакет '${name}' из манифеста не найден в storage.buckets`); fail = 1; continue; }
    // Самый опасный дрейф: приватный бакет вдруг стал публичным (или наоборот).
    if (bucketPublic[name] !== r.public) { err(`storage-дрейф: бакет '${name}' public=${bucketPublic[name]}, манифест ожидает ${r.public}`); fail = 1; }
    for (const cmd of r.policies || []) {
      if (!spol.has(`${name}_${cmd}`)) { err(`storage-дрейф: у бакета '${name}' нет политики '${name}_${cmd}' на storage.objects`); fail = 1; }
    }
  }
  // TRIP-48 — класс «анонимный листинг публичного бакета». Проверка существованием
  // (не разбор qual): публичный бакет = ноль SELECT-политик, и ни одного публичного
  // бакета вне манифеста (иначе слепая зона, как было с share-cards/share-maps).
  for (const [id, isPublic] of Object.entries(bucketPublic)) {
    if (!isPublic) continue;
    if (!(id in BUCKETS)) { err(`storage-дрейф: публичный бакет '${id}' не заведён в манифест BUCKETS (слепая зона)`); fail = 1; }
    if (spol.has(`${id}_select`)) { err(`storage-дрейф: публичный бакет '${id}' имеет SELECT-политику '${id}_select' — анонимный листинг; публичный бакет = ноль SELECT`); fail = 1; }
  }

  if (!fail) console.log(`check-security-tiers [live]: живая БД совпадает с манифестом (${grants.length} таблиц + ${funcs.length} secdef-функций + ${Object.keys(BUCKETS).length} бакета) — OK`);
  return fail;
}

// ── main ─────────────────────────────────────────────────────────────────────
// Запуск только когда файл вызван напрямую: `checkBucketPredicates` импортирует
// тест, а на импорте страж не должен ни ходить в БД, ни звать process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbUrl = process.env.SECURITY_TIERS_DB_URL;
  let fail = checkStatic();
  if (dbUrl) fail |= checkLive(dbUrl);
  else console.log('check-security-tiers: SECURITY_TIERS_DB_URL не задан — только static-проверка манифеста (live-ассерт идёт пост-деплой).');
  process.exit(fail ? 1 : 0);
}
