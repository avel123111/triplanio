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
import { fetchSenders, liveIdentityIds, toProfile, toSender, tripProfileScope, type UserRow } from './profiles.ts';

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

// ── охват ≠ разрешение видеть живой аккаунт ──────────────────────────────────
// Быть в охвате нужно, чтобы строка ОПОЗНАВАЛАСЬ. Показывать по ней живой
// аккаунт - отдельный вопрос: приглашение содержит адрес и имя на момент
// приглашения, но не аватар и не текущий e-mail приглашённого.

Deno.test('живой аккаунт показываем только владельцу, принявшим и extraIds', () => {
  const members = [
    { user_id: 'u-active', status: 'active' },
    { user_id: 'u-pending', status: 'pending' },
    { user_id: 'u-declined', status: 'declined' },
  ];
  const live = liveIdentityIds(members, OWNER, ['bot-uuid']);
  assertEquals([...live].sort(), ['bot-uuid', 'owner-uuid', 'u-active']);
});

Deno.test('непринявший участник: только состояние личности, без полей аккаунта', () => {
  const p = toProfile(row({ id: 'u-pending', full_name: 'Илья', avatar_url: 'a.png', email: 'ilya@example.com' }), false);
  assertEquals(p.full_name, '');
  assertEquals(p.avatar_url, '');
  assertEquals(p.email, '');
  assertEquals(p.is_deleted, false);
});

Deno.test('удалённый непринявший участник всё равно опознаётся как удалённый', () => {
  // Ровно строка из прода: приглашение принято не было, аккаунт удалён.
  // Клиенту нужен ТОЛЬКО этот флаг, чтобы подписать её «Удалённый аккаунт».
  const p = toProfile(row({ deleted_at: '2026-07-22T00:00:00Z', email: 'deleted+x@deleted.invalid' }), false);
  assertEquals(p.is_deleted, true);
  assertEquals(p.email, '');
  assertEquals(p.full_name, '');
});

Deno.test('охват шире, чем право на живой аккаунт', () => {
  const members = [{ user_id: 'u-pending', status: 'pending' }];
  const scope = tripProfileScope(members, OWNER);
  const live = liveIdentityIds(members, OWNER);
  assertEquals(scope.includes('u-pending'), true);   // опознать - можно
  assertEquals(live.has('u-pending'), false);        // показать аккаунт - нельзя
});

// ── автор события (Sender) ────────────────────────────────────────────────────
// Тот же приговор удаления, что у профиля, но без e-mail: получателю уведомления
// адрес автора не показываем.

Deno.test('sender живого автора: имя + аватар, без e-mail в форме', () => {
  const s = toSender(row({ id: 'a', full_name: 'Женя', avatar_url: 'a.png', email: 'zhenya@example.com' }));
  assertEquals(s, { id: 'a', full_name: 'Женя', avatar_url: 'a.png', is_deleted: false });
  // e-mail не поле Sender вовсе — форма не может его пронести.
  assertEquals('email' in s, false);
});

Deno.test('sender удалённого автора: пусто, флаг is_deleted', () => {
  const s = toSender(row({ id: 'a', full_name: 'Женя', avatar_url: 'a.png', deleted_at: '2026-07-22T00:00:00Z' }));
  assertEquals(s, { id: 'a', full_name: '', avatar_url: '', is_deleted: true });
});

Deno.test('sender без имени/аватара не роняет форму', () => {
  const s = toSender(row({ id: 'a' }));
  assertEquals(s, { id: 'a', full_name: '', avatar_url: '', is_deleted: false });
});

Deno.test('fetchSenders: дедуп id, карта id→Sender, пустые отброшены', async () => {
  const seen: string[][] = [];
  const db = {
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          seen.push(ids);
          return Promise.resolve({
            data: [
              { id: 'a', full_name: 'Женя', avatar_url: 'a.png', deleted_at: null },
              { id: 'b', full_name: null, avatar_url: null, deleted_at: '2026-07-22T00:00:00Z' },
            ] as UserRow[],
          });
        },
      }),
    }),
  };
  const map = await fetchSenders(db, ['a', 'a', 'b', null, undefined, '']);
  assertEquals(seen, [['a', 'b']]); // дубли и пустые не доехали до запроса
  assertEquals(map['a'], { id: 'a', full_name: 'Женя', avatar_url: 'a.png', is_deleted: false });
  assertEquals(map['b'], { id: 'b', full_name: '', avatar_url: '', is_deleted: true });
});

Deno.test('fetchSenders: нет id → нет запроса, пустая карта', async () => {
  let called = false;
  const db = { from: () => { called = true; return { select: () => ({ in: () => Promise.resolve({ data: [] }) }) }; } };
  const map = await fetchSenders(db, [null, undefined, '']);
  assertEquals(called, false);
  assertEquals(map, {});
});
