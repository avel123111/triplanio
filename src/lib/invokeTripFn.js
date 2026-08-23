// Trip-details loader (TRIP-56).
//
// The stale-token 401 recovery (refresh + retry once) now lives in the Supabase
// client's fetch layer (createAuthRetryFetch), so EVERY authorized call self-heals,
// not just this one. This is therefore a plain invoke: surface `data`, throw the
// error untouched so `loadErrorKind` / `queryGateKind` (loadStateClassify) can map
// it to the right screen. Shared by TripView and TripStructureEdit so they can't
// drift on how the trip is fetched.

import { invokeFn } from '@/lib/invokeFn';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY, TRIP_SHELL_INCLUDE, TRIP_CONTENT_INCLUDE } from '@/lib/trip-data';

export async function invokeGetTripDetails(body) {
  const { data, error } = await invokeFn('getTripDetails', { body });
  if (error) throw error;
  return data;
}

// ─── Дескрипторы запросов трипа ──────────────────────────────────────────────
//
// ★ КЛЮЧ И ФОРМА ЕГО PAYLOAD'А СОБИРАЮТСЯ В ОДНОМ МЕСТЕ, И ЭКРАНЫ ИХ НЕ НАЗЫВАЮТ.
// Правило «один ключ = одна форма» (TRIP-277) до этого держалось тем, что
// просящий был РОВНО ОДИН — TripView. Как только появился второй повод сходить за
// теми же данными (прогрев кэша из планировщика перед переходом в редактор),
// прежняя формулировка перестала работать: второй вызыватель означал бы второй
// `include` рядом с первым, то есть ровно ту регрессию, от которой правило и
// заведено.
//
// Поэтому единственность переехала с ВЫЗЫВАТЕЛЯ на ДЕСКРИПТОР: `include` и
// фетчер называются здесь и только здесь, а экран передаёт tripId и больше
// ничего. Разъехаться формам теперь негде ПО ПОСТРОЕНИЮ — это сильнее прежнего
// правила, а не слабее (пинится `trip-data-include.test.js`).
//
// ⚠️ Дескрипторы живут ЗДЕСЬ, а не в `trip-data.js`: тот модуль импортирует
// пустой на зависимости тест (`node --test` не резолвит алиас `@/`), а фетчер
// тянет за собой supabase-клиент. Тот же приём, что у реестра секций.

/** @param {string} tripId */
export const tripShellQuery = (tripId) => ({
  queryKey: TRIP_SHELL_KEY(tripId),
  queryFn: () => invokeGetTripDetails({ tripId, include: TRIP_SHELL_INCLUDE }),
});

/** @param {string} tripId */
export const tripContentQuery = (tripId) => ({
  queryKey: TRIP_CONTENT_KEY(tripId),
  queryFn: () => invokeGetTripDetails({ tripId, include: TRIP_CONTENT_INCLUDE }),
});
