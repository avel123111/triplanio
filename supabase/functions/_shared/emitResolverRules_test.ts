/**
 * TRIP-417 — аудитория `member_left`: владелец + активные админы, без ушедшего.
 * Запуск: deno test supabase/functions/_shared/emitResolverRules_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { memberLeftRecipientIds } from './emitResolverRules.ts';

Deno.test('владелец первым + активные админы', () => {
  assertEquals(memberLeftRecipientIds('owner', ['a1', 'a2'], 'leaver'), ['owner', 'a1', 'a2']);
});

Deno.test('ушедший исключён, даже если он в списке админов', () => {
  assertEquals(memberLeftRecipientIds('owner', ['leaver', 'a2'], 'leaver'), ['owner', 'a2']);
});

Deno.test('дедуп: владелец не повторяется из списка админов', () => {
  assertEquals(memberLeftRecipientIds('owner', ['owner', 'a2'], 'x'), ['owner', 'a2']);
});

Deno.test('пустые/не-строки отброшены', () => {
  assertEquals(memberLeftRecipientIds(null, ['a1', undefined, '', 7], 'x'), ['a1']);
});

Deno.test('нет владельца и админов → пустая аудитория', () => {
  assertEquals(memberLeftRecipientIds(null, [], 'x'), []);
});
