-- TRIP-32: нативная идемпотентность Stripe заменяет наш outbound_idempotency.
--
-- createStripeCheckout теперь шлёт СТАБИЛЬНЫЙ Stripe idempotency-ключ при
-- детерминированном теле (customer:id всегда, фикс. success/cancel URL без
-- returnPath) → две вкладки одной покупки схлопывает сам Stripe. Наша
-- БД-машинерия дедупа (90с-окно поверх outbound_idempotency) больше не нужна.
-- Greenfield (0 клиентов) → таблицу удаляем целиком.
DROP TABLE IF EXISTS public.outbound_idempotency;
