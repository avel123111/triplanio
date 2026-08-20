// TRIP-431 (Phase 2): денорм-слепок `trip_members.user_full_name` легитимен ровно
// для ОДНОГО случая — оффлайн-гостя без аккаунта (`add-offline`: user_id IS NULL).
// Все живые invite/accept/redeem/registration пути имеют либо `user_id`, либо
// `invite_email`, поэтому обязаны писать в слепок NULL (иначе он протухает при
// переименовании и раскрывает имя/email pending-участника всему трипу в обход
// `liveIdentityIds`). Инвариант закреплён CHECK-ом `tm_snapshot_only_offline`.
//
// Как Phase 1 (get-my-trip-cards-pii.test.js) — структурный гард на ПОСЛЕДНЮЮ по
// таймстампу миграцию/тело (именно оно действует после `db push`), без живой БД.
// Каждый assert краснеет на откате правки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS = ROOT + 'supabase/migrations/';
const FUNCTIONS = ROOT + 'supabase/functions/';

// Комментарии гасим ПЕРЕД разбором (иначе тест краснел бы на слове в документации).
const stripSql = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const stripTs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// Последняя по имени (=таймстампу) миграция, которая CREATE-ит функцию.
function activeDefinition(name) {
  const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const code = stripSql(readFileSync(MIGRATIONS + files[i], 'utf8'));
    if (new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\b`, 'i').test(code)) {
      return { file: files[i], code };
    }
  }
  return null;
}

test('invite_trip_member (active) never snapshots an account name into user_full_name', () => {
  const def = activeDefinition('invite_trip_member');
  assert.ok(def, 'no migration defines public.invite_trip_member');
  // Слепок из аккаунта запрещён: ни через переменную имени, ни через coalesce-фолбэк.
  assert.doesNotMatch(def.code, /user_full_name\s*=\s*coalesce/i, `${def.file}: invite re-snapshots account name`);
  assert.doesNotMatch(def.code, /\bv_uname\b/i, `${def.file}: dead name variable v_uname resurfaced`);
  // Реактивация declined→pending пишет NULL.
  assert.match(def.code, /user_full_name\s*=\s*null/i, `${def.file}: invite reactivation must null the snapshot`);
});

test('respond_trip_invite (active) accept writes NULL and drops the email fallback', () => {
  const def = activeDefinition('respond_trip_invite');
  assert.ok(def, 'no migration defines public.respond_trip_invite');
  // Email-фолбэк (клал сырой адрес аккаунта в слепок) убран совсем.
  assert.doesNotMatch(def.code, /user_full_name\s*=\s*coalesce/i, `${def.file}: accept re-adds account snapshot/email fallback`);
  assert.doesNotMatch(def.code, /select\s+full_name\s+into/i, `${def.file}: dead full_name select resurfaced`);
  assert.match(def.code, /user_full_name\s*=\s*null/i, `${def.file}: accept must null the snapshot`);
});

test('a migration backfills the snapshot and installs the offline-only CHECK (backfill first)', () => {
  const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();
  const hit = files
    .map((f) => ({ f, code: stripSql(readFileSync(MIGRATIONS + f, 'utf8')) }))
    .reverse()
    .find((x) => /tm_snapshot_only_offline/.test(x.code));
  assert.ok(hit, 'no migration adds constraint tm_snapshot_only_offline');

  const backfill = /update\s+public\.trip_members\s+set\s+user_full_name\s*=\s*null\s+where\s+user_id\s+is\s+not\s+null/i;
  const check = /check\s*\(\s*user_full_name\s+is\s+null\s+or\s+btrim\(user_full_name\)\s*=\s*''\s+or\s+user_id\s+is\s+null\s*\)/i;
  assert.match(hit.code, backfill, `${hit.f}: missing backfill of orphaned snapshots`);
  assert.match(hit.code, check, `${hit.f}: CHECK does not encode the snapshot-only-offline invariant`);
  // Бэкфилл ДО constraint — иначе осевшие данные уронили бы ALTER.
  assert.ok(hit.code.search(backfill) < hit.code.search(/add\s+constraint\s+tm_snapshot_only_offline/i),
    `${hit.f}: backfill must run before the CHECK constraint`);
});

test('redeemTripInviteLink edge writes user_full_name: null, not an account snapshot', () => {
  const raw = stripTs(readFileSync(FUNCTIONS + 'redeemTripInviteLink/index.ts', 'utf8'));
  assert.match(raw, /user_full_name:\s*null/, 'redeem no longer nulls the snapshot');
  assert.doesNotMatch(raw, /user_full_name:\s*callerName/, 'redeem re-snapshots the account name');
  assert.doesNotMatch(raw, /\bcallerName\b/, 'dead callerName snapshot resurfaced in redeem');
});

test('add-offline stays the sole legitimate writer of the user_full_name snapshot', () => {
  const tm = readFileSync(FUNCTIONS + '_shared/resources/tripMember.ts', 'utf8');
  assert.match(tm, /'add-offline'/, 'offline-guest action removed');
  // Оффлайн-гость: имя обязательно (слепок), аккаунта нет (user_id: null).
  assert.match(tm, /user_full_name:\s*\{[\s\S]*?required:\s*true/, 'offline guest no longer captures a name');
  assert.match(tm, /user_id:\s*null/, 'offline guest is no longer account-less');
});
