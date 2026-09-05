/**
 * TRIP-516 — North Star `trip_reached_2_participants` срабатывает на ПОЯВЛЕНИИ
 * ВТОРОГО человека и НЕ срабатывает при создании трипа.
 *
 * С TRIP-516 у владельца есть реальная строка `trip_members` (role='owner',
 * status='active') с момента создания, поэтому активных строк-с-аккаунтом: 1 при
 * создании, 2 после присоединения первого участника. Порог — ровно 2.
 *
 * Тестируем ЧИСТЫЙ предикат `reached2FromActiveCount` (env не читается ни на
 * импорте модуля, ни в предикате), поэтому запускается под `deno test` без
 * флагов — как `resolveEnvTag`. Запуск: deno test supabase/functions/_shared/analytics_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { reached2FromActiveCount } from './analytics.ts';

Deno.test('НЕ срабатывает при создании: владелец один → count=1', () => {
  assertEquals(reached2FromActiveCount(1), false);
});

Deno.test('срабатывает на втором человеке: владелец + участник → count=2', () => {
  assertEquals(reached2FromActiveCount(2), true);
});

Deno.test('НЕ срабатывает при третьем и далее: count=3', () => {
  assertEquals(reached2FromActiveCount(3), false);
});

Deno.test('пустой/нулевой count → не срабатывает', () => {
  assertEquals(reached2FromActiveCount(0), false);
  assertEquals(reached2FromActiveCount(null), false);
  assertEquals(reached2FromActiveCount(undefined), false);
});
