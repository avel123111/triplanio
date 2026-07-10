/**
 * subscriptionDedup — единый детект «у юзера уже есть энтайтлинг-подписка» для
 * пометки дубля (две вкладки / потерянный вебхук). Раньше был в двух видах:
 * функция hasOtherEntitlingSub в stripe-webhook и инлайн-переписка в
 * reconcileEntitlement с чуть другой семантикой. Сведено к одному предикату +
 * общему гарду «входящий статус сам энтайтлинговый».
 *
 * Дом здесь (а не в чистом subscriptionRow.ts): предикат ходит в БД (принимает
 * SupabaseClient) — как customer.ts.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { ENTITLING_STATUSES } from './catalog.ts';

/**
 * Есть ли у юзера ДРУГАЯ энтайтлинг-подписка, кроме exceptSubId (детект дубля).
 * exceptSubId исключает саму рассматриваемую подписку из выборки. Приватный —
 * внешние вызывающие идут через isDuplicateEntitlingSub (предикат + гард статуса).
 */
async function hasOtherEntitlingSub(
  admin: SupabaseClient,
  userId: string,
  exceptSubId: string | null,
): Promise<boolean> {
  const { data } = await admin
    .from('subscription')
    .select('provider_subscription_id')
    .eq('user_id', userId)
    .in('status', [...ENTITLING_STATUSES]);
  return (data ?? []).some((r) => r.provider_subscription_id !== exceptSubId);
}

/**
 * Помечать ли новую подписку дублем: у юзера есть ДРУГАЯ энтайтлинг-подписка И
 * входящая сама энтайтлинговая (не-энтайтлинговую входящую — incomplete/canceled —
 * дублем не метим, она права не даёт). Единая семантика для вебхука и reconcile.
 */
export async function isDuplicateEntitlingSub(
  admin: SupabaseClient,
  userId: string,
  incomingSubId: string | null,
  incomingStatus: string,
): Promise<boolean> {
  if (!(ENTITLING_STATUSES as readonly string[]).includes(incomingStatus)) return false;
  return hasOtherEntitlingSub(admin, userId, incomingSubId);
}
