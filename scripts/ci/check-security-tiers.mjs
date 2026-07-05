/**
 * CI guard — Security tier drift (TRIP-120 / TRIP-190 Ф4).
 *
 * Единственный источник истины = scripts/ci/security-tiers.mjs (манифест ярусов).
 * Инварианты RLS/грантов (I1-I5) держатся не «разово», а этим стражем:
 *
 *   STATIC (без БД, PR-гейт в checks.yml, шаг 2e) — валидирует сам манифест:
 *     * каждая таблица в валидном ярусе (A/B/C/D);
 *     * anonDml=false ВЕЗДЕ (I3a — anon не пишет никуда);
 *     * authDml=true только на ярусах A и C (I3b — B/D без клиентской записи).
 *   Ловит попытку «ослабить» правило редактированием манифеста.
 *
 *   LIVE (SECURITY_TIERS_DB_URL задан, post-deploy в supabase-deploy.yml) —
 *   сверяет ЖИВУЮ БД с манифестом через psql:
 *     * anon имеет DML на таблице  → FAIL всегда (I3a);
 *     * authenticated имеет DML там, где манифест это запрещает (нет в манифесте
 *       или authDml=false) → FAIL (I3b + новая незаклассифицированная таблица);
 *     * таблица яруса A без роль-осведомлённой write-политики (can_edit_trip) → FAIL (I2).
 *   Ловит дрейф, внесённый миграцией (новая таблица с дефолтным GRANT ALL,
 *   политика без роли и т.п.) сразу после накатывания.
 *
 * Модель совпадает с ассертом verify_jwt: PR-гейт статики + пост-деплой live-ассерт.
 */
import { execFileSync } from 'node:child_process';
import { TABLES, TIERS } from './security-tiers.mjs';

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
  if (!fail) console.log(`check-security-tiers [static]: манифест согласован — ${Object.keys(TABLES).length} таблиц, ярусы ${[...VALID_TIERS].join('/')} — OK`);
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
       and (coalesce(qual,'') ilike '%can_edit_trip%' or coalesce(with_check,'') ilike '%can_edit_trip%')), '[]'::json)
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
  if (!fail) console.log(`check-security-tiers [live]: живая БД совпадает с манифестом (${grants.length} таблиц проверено) — OK`);
  return fail;
}

// ── main ─────────────────────────────────────────────────────────────────────
const dbUrl = process.env.SECURITY_TIERS_DB_URL;
let fail = checkStatic();
if (dbUrl) fail |= checkLive(dbUrl);
else console.log('check-security-tiers: SECURITY_TIERS_DB_URL не задан — только static-проверка манифеста (live-ассерт идёт пост-деплой).');
process.exit(fail ? 1 : 0);
