/**
 * customer — платёжная идентичность юзера у провайдера (provider_customer).
 *
 * Канон вместо колонки users.stripe_customer_id (дропнута). Один источник для
 * всех читателей (checkout / billingPortal / reconcile / getUserPlan /
 * checkSubscriptionStatus) и писателя (webhook).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Customer id юзера у провайдера (или null). */
export async function getProviderCustomerId(
  admin: SupabaseClient,
  userId: string,
  provider = 'stripe',
): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin
    .from('provider_customer')
    .select('provider_customer_id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .order('created_at', { ascending: true })
    .limit(1);
  return data && data.length > 0 ? (data[0].provider_customer_id as string) : null;
}

/** Сохранить идентичность (идемпотентно, best-effort — не критично для права). */
export async function saveProviderCustomerId(
  admin: SupabaseClient,
  userId: string | null | undefined,
  customerId: unknown,
  provider = 'stripe',
): Promise<void> {
  if (!userId || typeof customerId !== 'string' || !customerId) return;
  const { error } = await admin
    .from('provider_customer')
    .upsert({ user_id: userId, provider, provider_customer_id: customerId },
            { onConflict: 'provider,provider_customer_id', ignoreDuplicates: true });
  if (error) console.error('saveProviderCustomerId failed (non-fatal):', error.message);
}

/**
 * Customer id юзера, создавая его у провайдера при ПЕРВОМ обращении (lazy).
 * В чекаут не уходим без него: вызывающий получает гарантированный cus_….
 * Идемпотентно по двум осям:
 *  - наша БД: строка уже есть → в провайдера не ходим;
 *  - провайдер: создание со стабильным ключом → параллельные вкладки дают ОДИН
 *    cus_… (детерминизм тела чекаута для нативной идемпотентности).
 * Бросает, если создание у провайдера не удалось (намеренно — без customer в
 * Stripe не идём).
 */
export async function ensureProviderCustomerId(
  admin: SupabaseClient,
  createCustomer: (userId: string, email: string | null) => Promise<string>,
  userId: string,
  email: string | null,
  provider = 'stripe',
): Promise<string> {
  const existing = await getProviderCustomerId(admin, userId, provider);
  if (existing) return existing;
  const created = await createCustomer(userId, email);
  await saveProviderCustomerId(admin, userId, created, provider);
  // Параллельная вкладка могла записать раньше — берём канон (самую раннюю строку).
  return (await getProviderCustomerId(admin, userId, provider)) ?? created;
}
