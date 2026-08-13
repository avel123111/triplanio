/**
 * TRIP-408 PR#2 — тест-пин контракта успешного ответа шва записи.
 *
 * ★ ТА САМАЯ НЕДОСТАЮЩАЯ ПРОВЕРКА. Раньше шов оборачивал payload в `{ data }`,
 * а ридеры (`getInbox`/`getTrips`) отдавали payload плоско. Из-за асимметрии
 * часть вызывателей читала `invokeFn.data.data`, часть — `invokeFn.data`, и
 * ровно этот рассинхрон проехал в прод двумя багами: создание трипа уходило на
 * `/trip/[object Object]` (id = весь конверт), а в Edit свапался id города.
 * Ни один гард репозитория формы HTTP-ответа не видел. Этот пин её фиксирует:
 * успех = payload НАПРЯМУЮ, без конверта — регресс к `{ data }` красит тест.
 *
 * Модуль `mutateResponse.ts` намеренно без env (не тянет `supabaseAdmin`),
 * поэтому импортируется под `deno test` без `--allow-env` — в отличие от самого
 * `mutate.ts`. Тот же приём, что `mutateRules_test.ts`.
 *
 * Запуск: deno test supabase/functions/_shared/mutateResponse_test.ts
 */

import { assert, assertEquals } from 'jsr:@std/assert@^1.0.8';
import { mutateSuccess } from './mutateResponse.ts';

Deno.test('успех отдаёт payload-строку ПЛОСКО, без конверта { data }', async () => {
  const row = { id: 'uuid-1', title: 'Рим' };
  const res = mutateSuccess(row, { 'x-cors': '1' });
  const body = await res.json();
  assertEquals(body, row); // не { data: row }
  assert(!(body && typeof body === 'object' && 'data' in body && (body as Record<string, unknown>).data === row),
    'payload не должен лежать под ключом data — это и есть старый баг');
});

Deno.test('успех create_trip = uuid-СТРОКА, не объект-конверт', async () => {
  // create_trip отдаёт голый uuid; при обёртке `{ data: uuid }` клиент клал в
  // id весь объект → `/trip/[object Object]`.
  const res = mutateSuccess('trip-uuid-42', {});
  assertEquals(await res.json(), 'trip-uuid-42');
});

Deno.test('delete / void-RPC отдают null телом (валидный JSON)', async () => {
  const res = mutateSuccess(null, {});
  assertEquals(await res.json(), null);
});

Deno.test('cors-заголовки прокидываются в ответ', () => {
  const res = mutateSuccess({ ok: 1 }, { 'access-control-allow-origin': 'https://triplan.io' });
  assertEquals(res.headers.get('access-control-allow-origin'), 'https://triplan.io');
});
