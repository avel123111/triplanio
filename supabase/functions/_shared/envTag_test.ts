/**
 * TRIP-284 — пин чистой нормализации метки окружения. `resolveEnvTag` — без
 * доступа к env, поэтому под `deno test` без `--allow-env` (как соседние
 * `*_test.ts`). Мутация дефолта 'production' → любое другое красит второй тест.
 *
 * Запуск: deno test supabase/functions/_shared/envTag_test.ts
 */
import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { resolveEnvTag } from './envTag.ts';

Deno.test('resolveEnvTag: заданное значение проходит как есть', () => {
  assertEquals(resolveEnvTag('development'), 'development');
  assertEquals(resolveEnvTag('production'), 'production');
});

Deno.test('resolveEnvTag: пусто/не задано -> дефолт production', () => {
  assertEquals(resolveEnvTag(undefined), 'production');
  assertEquals(resolveEnvTag(null), 'production');
  assertEquals(resolveEnvTag(''), 'production');
  assertEquals(resolveEnvTag('   '), 'production');
});

Deno.test('resolveEnvTag: обрезает окружающие пробелы', () => {
  assertEquals(resolveEnvTag('  development  '), 'development');
});
