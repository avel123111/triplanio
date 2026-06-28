-- TRIP-32 (хвост): полный переезд платёжной идентичности в provider_customer +
-- ДРОП колонки users.stripe_customer_id.
--
-- Все читатели/писатель переведены на provider_customer (checkout / billingPortal /
-- getUserPlan / checkSubscriptionStatus / reconcileEntitlement / webhook). Колонка
-- больше нигде в коде не читается и не пишется (проверено grep по functions + src).
--
-- Финальный idempotent-бэкфилл перед дропом — гарантия, что ни один id не потерян
-- (на случай строк, дописанных в колонку между Ф1-бэкфиллом и переключением
-- писателя). DROP COLUMN каскадно убирает и индекс idx_users_stripe_customer.

INSERT INTO public.provider_customer (user_id, provider, provider_customer_id)
  SELECT id, 'stripe', stripe_customer_id
    FROM public.users
   WHERE stripe_customer_id IS NOT NULL
ON CONFLICT (provider, provider_customer_id) DO NOTHING;

ALTER TABLE public.users DROP COLUMN IF EXISTS stripe_customer_id;
