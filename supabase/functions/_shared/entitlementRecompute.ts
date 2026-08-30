/**
 * Пересчёт права — ОДНА дверь: `recompute_* → откат аддонов → уведомление`.
 *
 * Кэш права выводят RPC `recompute_user_entitlement` / `recompute_trip_entitlement`
 * (single-writer, ТЗ платёжного фундамента). Раньше вызывающие складывали пару
 * «rpc + revokeLostProFeatures*» у себя (stripe-webhook и reconcileEntitlement —
 * побайтово одно и то же), а уведомление «Pro активирован» жило ещё дальше, на
 * ОДНОЙ ветке checkout.session.completed. Из-за этого право появлялось четырьмя
 * путями, а сообщал о нём один: в проде 0 уведомлений на 5 подписок.
 *
 * Здесь это сведено к правилу, которое нельзя обойти по невнимательности:
 * ПРАВО ПОЯВИЛОСЬ → ПОЛЬЗОВАТЕЛЬ ОБ ЭТОМ УЗНАЛ. Кто именно записал строку
 * покупки/подписки, роли больше не играет — новый путь начисления получает
 * уведомление даром, потому что не может пересчитать право мимо этой двери.
 *
 * ПЕРЕХОД СЧИТАЕТ БД, НЕ МЫ: RPC возвращает `true`, только если этим вызовом
 * право появилось (не-pro → pro), и делает это под блокировкой строки — иначе
 * два вебхука, приехавшие в одну секунду (наблюдалось), выдали бы по
 * уведомлению. Отсюда же идемпотентность: ретрай Stripe, переобработка
 * недошедшего события и продление перехода не создают.
 *
 * Ошибка RPC — БРОСАЕТСЯ (право не пересчиталось: в вебхуке событие не станет
 * `processed`, и Stripe ретраит). `notify` наоборот фейл-открыт по контракту
 * TRIP-374: сбой вставки уходит в Sentry и не роняет ни платёж, ни чтение.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureEdgeError } from './sentry.ts';
import { notify } from './emit.ts';
import { revokeLostProFeaturesForUser, revokeLostProFeaturesForTrip } from './revokeLostProFeatures.ts';

/** Аккаунтное право (подписка). Уведомляем самого владельца аккаунта. */
export async function recomputeUserEntitlement(
  db: SupabaseClient,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  const { data, error } = await db.rpc('recompute_user_entitlement', { p_user_id: userId });
  if (error) {
    await captureEdgeError(new Error(`recompute_user_entitlement (user ${userId}): ${error.message}`), 'entitlement');
    throw new Error('recompute_user_entitlement failed');
  }
  // Кэш осел — откатываем Pro-аддоны трипов, потерявших Pro. Self-gating +
  // best-effort (не бросает, иначе здоровую запись ретраил бы Stripe).
  await revokeLostProFeaturesForUser(db, userId);
  if (data === true) await notify('pro_activated', { recipient_id: userId }, { db });
}

/** Право трипа (разовая покупка). Адресата резолвер берёт из владельца трипа —
 *  купить Pro на трип может только он (createStripeCheckout отдаёт 403 остальным). */
export async function recomputeTripEntitlement(
  db: SupabaseClient,
  tripId: string | null | undefined,
): Promise<void> {
  if (!tripId) return;
  const { data, error } = await db.rpc('recompute_trip_entitlement', { p_trip_id: tripId });
  if (error) {
    await captureEdgeError(new Error(`recompute_trip_entitlement (trip ${tripId}): ${error.message}`), 'entitlement');
    throw new Error('recompute_trip_entitlement failed');
  }
  await revokeLostProFeaturesForTrip(db, tripId);
  if (data === true) await notify('trip_pro_activated', { trip_id: tripId }, { db });
}
