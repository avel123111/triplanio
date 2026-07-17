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
 *   Ловит дрейф, внесённый миграцией, сразу после накатывания.
 *
 * Модель совпадает с ассертом verify_jwt: PR-гейт статики + пост-деплой live-ассерт.
 */
import { execFileSync } from 'node:child_process';
import { TABLES, TIERS, FUNCTIONS, BUCKETS } from './security-tiers.mjs';

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
  }
  if (!fail) console.log(`check-security-tiers [static]: манифест согласован — ${Object.keys(TABLES).length} таблиц + ${callable.size} client-вызываемых функций + ${Object.keys(BUCKETS).length} бакета, ярусы ${[...VALID_TIERS].join('/')} — OK`);
  return fail;
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
  'buckets', coalesce((select json_agg(json_build_object('id', id, 'public', public)) from storage.buckets), '[]'::json),
  'storage_policies', coalesce((select json_agg(policyname) from pg_policies where schemaname='storage' and tablename='objects'), '[]'::json)
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

  // ── STORAGE: флаг public бакета + наличие политик storage.objects ──
  const bucketPublic = Object.fromEntries((live.buckets || []).map((b) => [b.id, b.public]));
  const spol = new Set(live.storage_policies || []);
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
const dbUrl = process.env.SECURITY_TIERS_DB_URL;
let fail = checkStatic();
if (dbUrl) fail |= checkLive(dbUrl);
else console.log('check-security-tiers: SECURITY_TIERS_DB_URL не задан — только static-проверка манифеста (live-ассерт идёт пост-деплой).');
process.exit(fail ? 1 : 0);
