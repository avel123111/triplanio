-- TRIP-64: снять висячие гранты с биллинговых таблиц.
--
-- Контекст: trip_subscriptions и stripe_events отдавали полный набор прав
-- (arwdDxtm, включая INSERT/UPDATE/DELETE) ролям anon и authenticated.
-- Единственным барьером оставалось отсутствие write-RLS-политики (default-deny) —
-- то есть «латентный P0»: одна добавленная write-политика превратила бы это в
-- self-grant Pro / подделку журнала вебхука.
--
-- Пишет в эти таблицы ТОЛЬКО service_role (edge-функции через supabaseAdmin):
-- stripe-webhook, reconcileEntitlement, createStripeCheckout, createBillingPortal,
-- getUserPlan. service_role сохраняет собственный грант и обходит RLS, поэтому
-- REVOKE его не затрагивает. Фронтенд к этим таблицам напрямую не обращается.

REVOKE ALL ON public.trip_subscriptions FROM anon, authenticated;
REVOKE ALL ON public.stripe_events      FROM anon, authenticated;

-- Единственная намеренная точка чтения подписок для пользователя
-- (видимость строк гейтит политика trip_subscriptions_select: user_id = auth.uid()
-- OR is_trip_participant(trip_id)). anon под этой политикой не видит ничего и
-- доступа к биллингу не имеет вовсе.
GRANT SELECT ON public.trip_subscriptions TO authenticated;
