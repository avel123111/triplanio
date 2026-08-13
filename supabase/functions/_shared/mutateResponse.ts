/**
 * Успешный ответ шва записи — ОДНА точка, где решается форма конверта.
 *
 * ★ ЗАЧЕМ ЭТОТ ФАЙЛ ОТДЕЛЬНО ОТ `mutate.ts`.
 * `mutate.ts` тянет `supabaseAdmin.ts`, который читает `Deno.env` ПРЯМО на
 * загрузке модуля, а `deno test` в CI идёт без `--allow-env` — значит из теста
 * `mutate.ts` не импортируется вовсе (тот же раскол, что `mutateRules.ts` ↔
 * I/O-половина). Построитель успеха живёт здесь, в модуле без env, поэтому его
 * контракт можно запинить напрямую (`mutateResponse_test.ts`).
 *
 * Контракт: тело успеха = payload записи НАПРЯМУЮ, без конверта `{ data }`.
 * Ридеры шва (`getInbox`/`getTrips`) отдают payload так же плоско, поэтому на
 * клиенте он лежит на `invokeFn.data` одинаково для чтений и записей. Конверт
 * `{ data }` был именно тем рассинхроном, из-за которого проехал баг создания
 * трипа (`/trip/[object Object]`) и своп id города в Edit — тест ниже его ловит.
 */
export function mutateSuccess(payload: unknown, corsHeaders: HeadersInit): Response {
  return Response.json(payload, { headers: corsHeaders });
}
