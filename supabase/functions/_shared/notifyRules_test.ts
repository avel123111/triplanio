/**
 * IN-APP спека события (notifyRules) — под тест зафиксированы два инварианта,
 * которые легко потерять глазами:
 *   • `i18n_params` НЕ несёт идентичности (`name`/`inviter`) — имя резолвится из
 *     `created_by` на чтении; снапшот в строке = утечка PII при анонимизации;
 *   • `created_by` = АВТОР события (для invite_linked это пригласивший, а не сам
 *     новорег-получатель) — от него зависит и аватар, и живое имя.
 *
 * Запуск: deno test supabase/functions/_shared/notifyRules_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { buildInAppRows, EXTERNAL, INAPP, type NotifyData } from './notifyRules.ts';

const TRIP = { id: 'trip-1', title: 'Токио, весна' };

function data(over: Partial<NotifyData> = {}): NotifyData {
  return { trip: TRIP, actor: null, member: null, recipients: [], ...over };
}

// ── идентичность НЕ снапшотится ───────────────────────────────────────────────

Deno.test('invite_created: params без имени, автор = пригласивший (actor)', () => {
  const spec = INAPP.invite_created(data({
    actor: { id: 'inviter-1', full_name: 'Женя' },
    member: { id: 'mem-1', role: 'admin', invited_by: 'inviter-1', user_id: 'invitee-1' },
  }));
  assertEquals(spec, {
    type: 'trip_invite',
    i18n_title_key: 'notif.tpl_invite_title',
    i18n_message_key: 'notif.tpl_invite_msg',
    i18n_params: { trip: 'Токио, весна', role_key: 'notif.role_admin' },
    trip_id: 'trip-1',
    trip_member_id: 'mem-1',
    created_by: 'inviter-1',
  });
  // Ключевой инвариант: ни имени, ни inviter в параметрах.
  assertEquals('name' in (spec!.i18n_params), false);
  assertEquals('inviter' in (spec!.i18n_params), false);
});

Deno.test('invite_linked: автор = пригласивший (member.invited_by), НЕ получатель-actor', () => {
  const spec = INAPP.invite_linked(data({
    actor: { id: 'newreg-1' }, // сам новорег — получатель, для аватара не он
    member: { id: 'mem-2', role: 'viewer', invited_by: 'inviter-9' },
  }));
  assertEquals(spec!.created_by, 'inviter-9');
  assertEquals(spec!.i18n_params, { trip: 'Токио, весна', role_key: 'notif.role_viewer' });
  assertEquals(spec!.trip_member_id, 'mem-2');
});

// ── строки о действии участника ───────────────────────────────────────────────

Deno.test('trip_member_left: имя в тексте не снапшотим, автор = ушедший', () => {
  const spec = INAPP.trip_member_left(data({ actor: { id: 'leaver-1', full_name: 'Костя' } }));
  assertEquals(spec, {
    type: 'trip_member_left',
    i18n_title_key: 'notif.tpl_member_left_title',
    i18n_message_key: 'notif.tpl_member_left_msg',
    i18n_params: { trip: 'Токио, весна' },
    trip_id: 'trip-1',
    trip_member_id: null,
    created_by: 'leaver-1',
  });
});

Deno.test('trip_role_changed: тело зависит от НОВОЙ роли', () => {
  const admin = INAPP.trip_role_changed(data({ actor: { id: 'a' }, member: { role: 'admin' } }));
  assertEquals(admin!.i18n_message_key, 'notif.tpl_role_changed_admin_msg');
  const viewer = INAPP.trip_role_changed(data({ actor: { id: 'a' }, member: { role: 'viewer' } }));
  assertEquals(viewer!.i18n_message_key, 'notif.tpl_role_changed_viewer_msg');
});

Deno.test('pro_activated: системная строка — без автора и без параметров', () => {
  const spec = INAPP.pro_activated(data({ trip: null, recipients: [{ id: 'u1' }] }));
  assertEquals(spec!.created_by, null);
  assertEquals(spec!.i18n_params, {});
  assertEquals(spec!.trip_id, null);
});

// ── разброс по получателям ────────────────────────────────────────────────────

Deno.test('buildInAppRows: общая строка × получатели, дедуп, битые id отброшены', () => {
  const rows = buildInAppRows('trip_member_left', data({
    actor: { id: 'leaver-1' },
    recipients: [{ id: 'owner' }, { id: 'admin' }, { id: 'owner' }, { id: null }, {}],
  }));
  assertEquals(rows.map((r) => r.user_id), ['owner', 'admin']);
  assertEquals(rows.every((r) => r.read === false), true);
  assertEquals(rows[0].created_by, 'leaver-1');
  assertEquals(rows[0].type, 'trip_member_left');
});

Deno.test('buildInAppRows: событие без in-app-канала (invite_resent) → []', () => {
  assertEquals(buildInAppRows('invite_resent', data({ recipients: [{ id: 'u1' }] })), []);
});

Deno.test('buildInAppRows: нет получателей → []', () => {
  assertEquals(buildInAppRows('trip_member_left', data({ actor: { id: 'x' } })), []);
});

// ── внешний канал (email) ─────────────────────────────────────────────────────

Deno.test('EXTERNAL: письмо шлют только invite_created / invite_resent', () => {
  assertEquals(EXTERNAL.has('invite_created'), true);
  assertEquals(EXTERNAL.has('invite_resent'), true);
  // In-app-only события в n8n не ходят (их ветки удалены) — POST дал бы 404.
  for (const e of ['trip_member_joined', 'trip_invite_declined', 'trip_member_left',
    'trip_member_removed', 'trip_role_changed', 'invite_linked', 'pro_activated', 'pro_payment_failed']) {
    assertEquals(EXTERNAL.has(e), false, `${e} не должно ходить в n8n`);
  }
});
