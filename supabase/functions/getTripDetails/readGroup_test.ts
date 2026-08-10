/**
 * TRIP-399 — сбой include-группы обязан ПРОБРАСЫВАТЬСЯ, а не выдаваться за пусто.
 *
 * Запуск: deno test supabase/functions/getTripDetails/readGroup_test.ts
 */
import { assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.8';
import { readGroup } from './readGroup.ts';

Deno.test('★ сбой под-запроса БРОСАЕТ (не выдаёт пустой ответ за «данных нет»)', () => {
  // Мутация «убрать throw» роняет тест: без него упавший SELECT документов
  // отдал бы [] и экран нарисовал бы «пусто» вместо «ошибка загрузки».
  assertThrows(
    () => readGroup({ data: null, error: { code: '57014', message: 'statement timeout' } }),
    'сбой группы обязан бросить, а не вернуть []',
  );
});

Deno.test('пустой успешный ответ = [] (это НЕ ошибка)', () => {
  assertEquals(readGroup({ data: [], error: null }), []);
  assertEquals(readGroup({ data: null, error: null }), []);
});

Deno.test('данные проходят как есть', () => {
  assertEquals(readGroup({ data: [{ id: 1 }], error: null }), [{ id: 1 }]);
});
