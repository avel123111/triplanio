-- TRIP-425 (Ф4 волна 3, эпик TRIP-374) — ЗАКРЫТЬ ДВЕРИ В БД у ролей юзера.
--
-- Финал эпика «единая дверь»: у ролей anon/authenticated не остаётся НИЧЕГО сверх
-- минимального набора исключений §1 хендоффа. edge ходит под service_role (гранты
-- роли юзера ему не нужны); фронт в БД напрямую не пишет и не читает, кроме:
--   • realtime-чат (SELECT chats/chat_messages/chat_reads);
--   • отметка «прочитано» (upsert chat_reads) и трекинг кликов (insert partner_clicks);
--   • публичный газеттир (3 RPC, EXECUTE не тут);
--   • байты Storage (гейт-предикаты _can_*_trip_file, EXECUTE не тут).
--
-- Предусловие сверено read-only на dev И prod (идентичны) ДО миграции:
--   • у anon/authenticated на 24 контент-таблицах — REFERENCES/TRIGGER/TRUNCATE
--     (мусор baseline GRANT ALL, из браузера недоступны в принципе) + мёртвые
--     SELECT на trips/trip_members/trip_telegram_integrations/cities/fx_rates/
--     subscription/purchase/provider_customer (0 прямых .from() в src/**, чтение
--     идёт через edge под service_role — getTripDetails/getTrips/getMe/getUserPlan);
--   • колоночных ACL нет (табличный REVOKE снимет всё); грантов на псевдороль
--     PUBLIC на таблицы нет;
--   • 5 функций розданы anon/authenticated/PUBLIC, но не зовёт НИ ОДНА из
--     src/**, functions/**, RLS-политик и тел функций (сверено pg_policy +
--     pg_get_functiondef): create_group_chat_for_trip (INVOKER, мутирующая),
--     get_pending_reminders/reminder_true_instant (INVOKER, зовёт только edge
--     getPendingReminders под service_role), tg_reminders_undelivered_watchdog
--     (INVOKER, cron/watchdog), get_trip_owner_profiles (DEFINER — привилегированная,
--     близнец get_trip_participant_profiles дропнут TRIP-403, эту забыли).
--   → REVOKE приложение не ломает.
--
-- ⚠ БИЛЛИНГ (правило 13): subscription/purchase/provider_customer SELECT снимается
--   на подтверждённом «0 клиентских чтений» — Pro-статус едет из users через
--   getMe/getUserPlan (service_role). Изменение под security-review в этом PR.

-- ── 1. Снять ВСЁ у ролей юзера на 24 контент-таблицах ────────────────────────────
-- service_role НЕ трогаем (шов пишет под ним). REVOKE идемпотентен для anon там,
-- где у него грантов нет (subscription/purchase/provider_customer — только authenticated).
REVOKE ALL ON TABLE
  public.activities, public.budget_categories, public.budget_expenses,
  public.chat_messages, public.chat_reads, public.chats, public.cities,
  public.city_visits, public.fx_rates, public.hotel_stays, public.notifications,
  public.partner_clicks, public.provider_customer, public.purchase,
  public.subscription, public.transfers, public.trip_budgets, public.trip_documents,
  public.trip_members, public.trip_services, public.trip_telegram_integrations,
  public.trips, public.user_custom_visits, public.users
FROM anon, authenticated;
-- Defense-in-depth (грабля TRIP-49): роль-осведомлённый REVOKE «мимо» PUBLIC
-- выглядит сделанным и не работает; на таблицах PUBLIC-грантов нет, но фиксируем.
REVOKE ALL ON TABLE
  public.chats, public.chat_messages, public.chat_reads, public.partner_clicks
FROM PUBLIC;

-- ── 2. Вернуть РОВНО исключения §1 (единственный прямой доступ фронта к БД) ───────
GRANT SELECT               ON public.chats, public.chat_messages TO authenticated; -- realtime-подписка
GRANT SELECT, INSERT, UPDATE ON public.chat_reads               TO authenticated; -- realtime + отметка read (upsert)
GRANT INSERT               ON public.partner_clicks              TO authenticated; -- fire-and-forget трекинг

-- ── 3. Спящие привилегированные RPC — снять EXECUTE у ролей юзера ─────────────────
-- Клиент не зовёт ни одну; зовут только edge (service_role) / cron. DEFINER среди
-- них одна (get_trip_owner_profiles) — её EXECUTE у authenticated был реальной
-- привилегированной дверью. Снимаем и с PUBLIC (грабля дефолтного GRANT).
REVOKE EXECUTE ON FUNCTION public.create_group_chat_for_trip()                                    FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pending_reminders(window_minutes integer)                    FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reminder_true_instant(ts timestamp with time zone, tz text)      FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_reminders_undelivered_watchdog()                              FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_trip_owner_profiles(trip_id_list uuid[])                     FROM anon, authenticated, PUBLIC;

-- ── 4. Мёртвые RLS-политики (без гранта PostgREST до строки не доходит; при RLS on
--      строка без применимой политики = deny). Убираем RLS КАК АВТОРИЗАЦИЮ
--      (Вариант B: в БД остаётся только целостность). RLS оставляем ВКЛЮЧЁННЫМ с
--      нулём политик = deny-all backstop; service_role обходит. НЕ трогаем живые
--      chat_*/partner_clicks_insert — realtime и трекинг на них держатся.
DROP POLICY IF EXISTS trips_select                          ON public.trips;
DROP POLICY IF EXISTS trip_members_select                   ON public.trip_members;
DROP POLICY IF EXISTS trip_members_select_own               ON public.trip_members;
DROP POLICY IF EXISTS trip_members_insert                   ON public.trip_members;
DROP POLICY IF EXISTS trip_members_update                   ON public.trip_members;
DROP POLICY IF EXISTS trip_members_delete                   ON public.trip_members;
DROP POLICY IF EXISTS trip_telegram_integrations_select     ON public.trip_telegram_integrations;
DROP POLICY IF EXISTS cities_read                           ON public.cities;
DROP POLICY IF EXISTS fx_rates_select                       ON public.fx_rates;
DROP POLICY IF EXISTS partner_clicks_select                 ON public.partner_clicks;
DROP POLICY IF EXISTS subscription_select_own               ON public.subscription;
DROP POLICY IF EXISTS purchase_select_own                   ON public.purchase;
DROP POLICY IF EXISTS provider_customer_select_own          ON public.provider_customer;
DROP POLICY IF EXISTS telegram_link_tokens_own              ON public.telegram_link_tokens;

-- НЕ трогаем: service_role (шов), RLS остаётся enabled (не disable). Живые политики
-- chats_select_for_trip_members / chat_messages_select / chat_reads_own /
-- partner_clicks_insert — сохранены (realtime + трекинг). Предикаты is_trip_participant/
-- is_trip_creator/_can_*_trip_file — их держат оставшиеся политики и Storage-гейт,
-- EXECUTE у них не снимаем.
