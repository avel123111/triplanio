/**
 * Pro-гейт трипа — ОДИН производитель отказа «нет, нужен Pro» (TRIP-408).
 *
 * До этого правило «is_trip_pro → 402 PRO_REQUIRED» жило четырьмя инлайн-копиями
 * (шов `mutate.ts`, `updateTripSettings`, `callTriplanioAi`, `parseBookingWithAi`),
 * с разными статусами (402/403/200) и разной обвязкой `x-sentry-skip`. Теперь их
 * источник один:
 *   - `proRefusal(admin, tripId)` — предикат `is_trip_pro` → `Refusal | null`
 *     (для шва: `checkRequirement('pro')` кладёт отказ в общий конвейер);
 *   - `requireTripPro(admin, tripId, cors)` — тот же отказ, но уже `Response`
 *     через `refusalResponse` (для не-шовных функций).
 *
 * ★ ИНВАРИАНТ (как у ветки `pro` шва до выноса): ошибка RPC — это НЕ «не Pro».
 * `unwrapDbResult` бросает на `error` → 500 INTERNAL (ретраится, летит в Sentry),
 * и до сравнения доезжает только настоящее `data`. Иначе сбой БД выродился бы в
 * ложный 402, спрятался под `x-sentry-skip` и молча сломал монетизацию (TRIP-394 ②).
 *
 * `is_trip_pro` — единый предикат Pro (`is_pro_trip OR is_user_pro`, миграция
 * 0055): новую формулу Pro здесь не заводим.
 */

import { unwrapDbResult } from './mutateRules.ts';
import type { Refusal } from './mutateRules.ts';
import { refusalResponse } from './http.ts';

/** Минимальная структурная форма клиента БД: только `rpc`, что нужно гейту.
 *  `PromiseLike`, не `Promise`: `supabase-js` возвращает thenable-билдер (есть
 *  `.then`, но не полный Promise), и он структурно подходит под `PromiseLike`. */
type Admin = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * ЕДИНСТВЕННАЯ форма отказа «нет, нужен Pro» — 402 + `sentrySkip` (бизнес-«нет»
 * не шумит в Sentry). Отсюда её берёт и `proRefusal` (гейт по `is_trip_pro`), и
 * addon-условные ветки (`callTriplanioAi`/`updateTripSettings`: трип Pro, но
 * конкретный Pro-аддон выключен) — чтобы литерал 402/PRO_REQUIRED/skip не
 * размножался (анти-дубль инвариант TRIP-408). Отдаётся в `refusalResponse`.
 */
export const PRO_REQUIRED: Refusal = {
  status: 402,
  code: 'PRO_REQUIRED',
  message: 'Pro required',
  sentrySkip: true,
};

/**
 * `null` — трип Pro (пропускаем). Иначе — `PRO_REQUIRED`. Бросает на сбое RPC
 * (→ 500), не на «не Pro».
 */
export async function proRefusal(admin: Admin, tripId: string): Promise<Refusal | null> {
  const isPro = unwrapDbResult(await admin.rpc('is_trip_pro', { p_trip_id: tripId }));
  return isPro === true ? null : PRO_REQUIRED;
}

/**
 * Для НЕ-шовных функций: `proRefusal` + `refusalResponse`. `null` — трип Pro,
 * вызывающий продолжает; иначе — готовый 402-ответ с `x-sentry-skip`.
 */
export async function requireTripPro(
  admin: Admin,
  tripId: string,
  corsHeaders: HeadersInit,
): Promise<Response | null> {
  const refusal = await proRefusal(admin, tripId);
  return refusal ? refusalResponse(refusal, corsHeaders) : null;
}
