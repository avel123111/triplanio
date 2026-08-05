/**
 * TRIP-334 — инвариант «ответ везёт профиль на КАЖДУЮ строку, которую он же
 * и везёт».
 *
 * Прод-баг ровно об этом: getTripDetails отдаёт строки trip_members ЛЮБОГО
 * статуса, а профили собирал только по status='active'. Пока у строки был свой
 * снимок имени, это было незаметно; как только anonymize_my_account его затёрла,
 * приглашённый участник с удалённым аккаунтом отрисовался голым прочерком.
 *
 * Правило вынесено в чистую функцию именно затем, чтобы его можно было
 * зафиксировать тестом: любой возврат фильтра по статусу роняет прогон.
 *
 * Запуск: deno test supabase/functions/_shared/profiles_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { toProfile, tripProfileScope, type UserRow } from './profiles.ts';

const OWNER = 'owner-uuid';

// ── охват ────────────────────────────────────────────────────────────────────

Deno.test('охват НЕ зависит от статуса участия', () => {
  const members = [
    { user_id: 'u-active', status: 'active' },
    { user_id: 'u-pending', status: 'pending' },
    { user_id: 'u-declined', status: 'declined' },
  ];
  const scope = tripProfileScope(members, OWNER).sort();
  assertEquals(scope, ['owner-uuid', 'u-active', 'u-declined', 'u-pending']);
});

Deno.test('каждая строка с user_id получает профиль (сам инвариант)', () => {
  const members = [
    { user_id: 'a', status: 'pending' },
    { user_id: 'b', status: 'active' },
    { user_id: null, status: 'offline' }, // addOfflineTripMember: опознавать нечего
  ];
  const scope = new Set(tripProfileScope(members, OWNER));
  for (const m of members) {
    if (m.user_id) assertEquals(scope.has(m.user_id), true, `нет профиля для ${m.user_id}`);
  }
});

Deno.test('владелец в охвате даже без строки trip_members', () => {
  // Владелец живёт в trips.created_by, строки участника у него нет вовсе.
  assertEquals(tripProfileScope([], OWNER), [OWNER]);
});

Deno.test('строки без user_id и пустой трип не роняют охват', () => {
  assertEquals(tripProfileScope([{ user_id: null }, {}], null), []);
  assertEquals(tripProfileScope(null, undefined), []);
});

Deno.test('дубликаты схлопываются: владелец = он же участник', () => {
  const scope = tripProfileScope([{ user_id: OWNER, status: 'active' }], OWNER);
  assertEquals(scope, [OWNER]);
});

Deno.test('extraIds пускает бота, пустые значения игнорируются', () => {
  // Бот авторствует сообщения в чате, не будучи участником ни одного трипа.
  const scope = tripProfileScope([], OWNER, ['bot-uuid', null, undefined, '']).sort();
  assertEquals(scope, ['bot-uuid', 'owner-uuid']);
});

// ── приватность ──────────────────────────────────────────────────────────────

function row(over: Partial<UserRow>): UserRow {
  return { id: 'u1', full_name: null, avatar_url: null, email: null, deleted_at: null, ...over };
}

Deno.test('удалённый аккаунт не отдаёт e-mail наружу', () => {
  const p = toProfile(row({ email: 'deleted+u1@deleted.invalid', deleted_at: '2026-07-22T00:00:00Z' }));
  assertEquals(p.email, '');
  assertEquals(p.is_deleted, true);
});

Deno.test('живой аккаунт отдаёт e-mail', () => {
  const p = toProfile(row({ email: 'p@example.com', full_name: 'Pavel' }));
  assertEquals(p.email, 'p@example.com');
  assertEquals(p.is_deleted, false);
});
