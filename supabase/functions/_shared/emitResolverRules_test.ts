/**
 * TRIP-417 — аудитория `trip_member_left`: владелец + активные админы, без ушедшего.
 * TRIP-284 — аудитория `booking_added`: владелец + активные участники, без автора.
 * Запуск: deno test supabase/functions/_shared/emitResolverRules_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { bookingAddedRecipientIds, memberLeftRecipientIds } from './emitResolverRules.ts';

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

// ── booking_added: владелец + активные участники, без автора ───────────────────

Deno.test('booking: владелец первым + активные участники', () => {
  assertEquals(bookingAddedRecipientIds('owner', ['m1', 'm2'], 'actor'), ['owner', 'm1', 'm2']);
});

Deno.test('booking: автор исключён, даже если он в участниках', () => {
  assertEquals(bookingAddedRecipientIds('owner', ['actor', 'm2'], 'actor'), ['owner', 'm2']);
});

Deno.test('booking: автор-владелец не уведомляет сам себя', () => {
  assertEquals(bookingAddedRecipientIds('owner', ['m1'], 'owner'), ['m1']);
});

Deno.test('booking: дедуп владельца из списка участников', () => {
  assertEquals(bookingAddedRecipientIds('owner', ['owner', 'm2'], 'x'), ['owner', 'm2']);
});

Deno.test('booking: пустые/не-строки отброшены', () => {
  assertEquals(bookingAddedRecipientIds(null, ['m1', undefined, '', 7], 'x'), ['m1']);
});
