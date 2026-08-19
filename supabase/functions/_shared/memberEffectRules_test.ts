// Тесты чистых решателей побочек участников (TRIP-409). Пинят решение afterWrite
// БЕЗ загрузки I/O (emit/teardown): mutateEffects.ts env-free тестом не грузится.
import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { bookingAddedNotifies, respondEffectPlan, roleChangeNotifies } from './memberEffectRules.ts';

Deno.test('★ respond accept → North-Star + trip_member_joined пригласившему', () => {
  assertEquals(respondEffectPlan('accepted'), { reached2: true, emit: 'trip_member_joined' });
});

Deno.test('★ respond decline → БЕЗ North-Star, trip_invite_declined', () => {
  assertEquals(respondEffectPlan('declined'), { reached2: false, emit: 'trip_invite_declined' });
});

Deno.test('★ respond owner_stray → ни North-Star, ни emit (стрэй удалён)', () => {
  assertEquals(respondEffectPlan('owner_stray'), { reached2: false, emit: null });
});

Deno.test('respond неизвестный исход → безопасно ничего', () => {
  assertEquals(respondEffectPlan('???'), { reached2: false, emit: null });
});

Deno.test('★ role: уведомляем только при реальной смене И для юзера с аккаунтом', () => {
  // Сменилась + есть аккаунт → уведомляем.
  assertEquals(roleChangeNotifies('viewer', 'admin', 'user-1'), true);
  // Роль та же → молчим (лишний шум).
  assertEquals(roleChangeNotifies('admin', 'admin', 'user-1'), false);
  // Сменилась, но offline-участник (user_id пуст) → слать некуда.
  assertEquals(roleChangeNotifies('viewer', 'admin', null), false);
  assertEquals(roleChangeNotifies('viewer', 'admin', undefined), false);
});

Deno.test('★ booking: уведомляем ТОЛЬКО при создании, не при правке/док-аплоаде', () => {
  // Создание брони (insert-путь) → уведомляем. Layover тоже: create-only rpc → isInsert=true.
  assertEquals(bookingAddedNotifies(true), true);
  // Правка брони / прикрепление документа (UPDATE by id) → молчим (регресс TRIP-284).
  assertEquals(bookingAddedNotifies(false), false);
});
