/**
 * TRIP-417 / TRIP-517 — `recipientsExcept`: сведение id-списка к получателям
 * inapp-события (дедуп, отброс пустых, минус актор, порядок стабилен).
 * Выбор САМИХ строк — за I/O-половиной (`emitResolvers.ts`): `booking_added`
 * грузит всех активных участников (владелец среди них), `trip_member_left` —
 * активных owner+admin. Здесь пинится только чистое сведение.
 * Запуск: deno test supabase/functions/_shared/emitResolverRules_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { recipientsExcept } from './emitResolverRules.ts';

Deno.test('сохраняет порядок входа', () => {
  assertEquals(recipientsExcept(['owner', 'a1', 'a2'], 'leaver'), ['owner', 'a1', 'a2']);
});

Deno.test('актор исключён, даже если он в списке', () => {
  assertEquals(recipientsExcept(['owner', 'leaver', 'a2'], 'leaver'), ['owner', 'a2']);
});

Deno.test('дедуп повторов', () => {
  assertEquals(recipientsExcept(['owner', 'owner', 'a2'], 'x'), ['owner', 'a2']);
});

Deno.test('автор-владелец не уведомляет сам себя', () => {
  assertEquals(recipientsExcept(['owner', 'm1'], 'owner'), ['m1']);
});

Deno.test('пустые/не-строки отброшены', () => {
  assertEquals(recipientsExcept(['a1', undefined, '', 7], 'x'), ['a1']);
});

Deno.test('пустой вход → пустая аудитория', () => {
  assertEquals(recipientsExcept([], 'x'), []);
});
