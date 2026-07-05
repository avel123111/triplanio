-- TRIP-120 гигиена — снять РУДИМЕНТАРНЫЕ authenticated EXECUTE-гранты на secdef-
-- функциях, которые клиент напрямую НЕ вызывает (least-privilege второй двери).
--
-- Проверено grep по src/ + supabase/functions/:
--   geocode_enqueue/dequeue/serve_fair — зовёт ТОЛЬКО edge `geoLocationiq` через
--     `supabaseAdmin` (service_role), не фронт. authenticated-грант рудиментарен.
--   link_pending_invites — ТРИГГЕР (`trg_link_pending_invites` AFTER INSERT ON users);
--     Postgres запускает триггер БЕЗ EXECUTE-гранта у вызывающего → грант рудиментарен
--     (прямым RPC не зовётся; TRIP-49 выдал его authenticated бланкетно).
--
-- service_role / SECURITY DEFINER / триггерный путь НЕ затронуты. После ревока страж
-- (Ф4) энфорсит эти функции как internal (anon=false AND auth=false) — см. правку
-- FUNCTIONS в scripts/ci/security-tiers.mjs (убраны из authExec/authzExempt).

revoke execute on function public.geocode_enqueue(integer)                             from authenticated;
revoke execute on function public.geocode_dequeue(bigint)                              from authenticated;
revoke execute on function public.geocode_serve_fair(bigint, numeric, numeric, numeric) from authenticated;
revoke execute on function public.link_pending_invites()                               from authenticated;
