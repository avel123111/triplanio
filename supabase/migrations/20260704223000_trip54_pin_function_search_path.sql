-- TRIP-54: pin search_path = public, pg_temp on ALL application functions
-- (function_search_path_mutable, advisor lint 0011). Target-state pass.
--
-- Two problems this closes across every function we own in `public`:
--   1) 16 functions had NO fixed search_path at all — resolution of unqualified
--      names depended on the caller's session search_path.
--   2) 38 functions had a flat `search_path = public`. Because pg_temp is NOT
--      listed there, Postgres implicitly searches pg_temp FIRST (even before
--      pg_catalog) — so a temp object could still shadow a public/catalog one.
--
-- Fix (both cases): pin to `public, pg_temp` with pg_temp explicitly LAST, so a
-- temp object can never shadow. `auth_email_status` keeps `auth` (it reads the
-- auth schema): `public, auth, pg_temp`.
--
-- Behaviour-neutral: verified (04.07.2026) every body references only public
-- objects + built-ins (pg_catalog is always searched first regardless), and NO
-- function creates a temp table, so moving pg_temp to last changes nothing at
-- runtime. Metadata-only: no table locks, no data change, no RLS/API change.
--
-- Extension functions (pg_trgm / fuzzystrmatch / unaccent) are excluded — they
-- are vendored and not ours to pin (advisor still flags them; nothing to fix).
--
-- Doc: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

-- ── SECURITY DEFINER (run as owner; back RLS — is_trip_participant feeds 18 policies) ──
alter function public.is_trip_creator(p_trip_id uuid)                                    set search_path = public, pg_temp;
alter function public.is_trip_participant(p_trip_id uuid)                                set search_path = public, pg_temp;
alter function public.get_trip_owner_profiles(trip_id_list uuid[])                       set search_path = public, pg_temp;
alter function public.get_trip_participant_profiles(trip_id_list uuid[])                 set search_path = public, pg_temp;
alter function public._can_edit_trip(p_trip uuid, p_uid uuid)                            set search_path = public, pg_temp;
alter function public._trip_anchor_date(p_trip uuid)                                     set search_path = public, pg_temp;
alter function public.active_owned_trips(p_uid uuid)                                     set search_path = public, pg_temp;
alter function public.add_city(p_trip uuid, p_city jsonb, p_index integer)               set search_path = public, pg_temp;
alter function public.add_layover_transfer(p_trip uuid, p_from uuid, p_to uuid, p_waypoints jsonb, p_segments jsonb) set search_path = public, pg_temp;
alter function public.anonymize_my_account(p_user_id uuid)                               set search_path = public, pg_temp;
alter function public.count_active_owned_trips(p_uid uuid)                               set search_path = public, pg_temp;
alter function public.create_trip(p_title text, p_description text)                      set search_path = public, pg_temp;
alter function public.enforce_trip_limit()                                              set search_path = public, pg_temp;
alter function public.ensure_trip_budget(p_trip_id uuid)                                 set search_path = public, pg_temp;
alter function public.geocode_dequeue(p_ticket bigint)                                   set search_path = public, pg_temp;
alter function public.geocode_enqueue(p_priority integer)                                set search_path = public, pg_temp;
alter function public.geocode_serve_fair(p_ticket bigint, p_min numeric, p_rate numeric, p_cap numeric) set search_path = public, pg_temp;
alter function public.get_user_travel_stats()                                           set search_path = public, pg_temp;
alter function public.is_trip_pro(p_trip_id uuid)                                        set search_path = public, pg_temp;
alter function public.is_user_pro(p_uid uuid)                                            set search_path = public, pg_temp;
alter function public.link_pending_invites()                                            set search_path = public, pg_temp;
alter function public.notify_booking_added()                                            set search_path = public, pg_temp;
alter function public.rate_limit_check(p_bucket text, p_key text, p_max integer, p_window_seconds integer) set search_path = public, pg_temp;
alter function public.rate_limit_record(p_bucket text, p_key text)                       set search_path = public, pg_temp;
alter function public.recompute_trip(p_trip uuid, p_base date)                           set search_path = public, pg_temp;
alter function public.recompute_trip_entitlement(p_trip_id uuid)                         set search_path = public, pg_temp;
alter function public.recompute_user_entitlement(p_user_id uuid)                         set search_path = public, pg_temp;
alter function public.remove_city(p_city uuid)                                           set search_path = public, pg_temp;
alter function public.reorder_cities(p_trip uuid, p_order uuid[])                        set search_path = public, pg_temp;
alter function public.revoke_trip_pro_addons(p_trip_id uuid)                             set search_path = public, pg_temp;
alter function public.revoke_user_pro_addons(p_user_id uuid)                             set search_path = public, pg_temp;
alter function public.search_gazetteer(q text, lang text, lim integer)                   set search_path = public, pg_temp;
alter function public.seed_budget_on_trip()                                             set search_path = public, pg_temp;
alter function public.set_city_nights(p_city uuid, p_nights integer)                     set search_path = public, pg_temp;
alter function public.set_trip_start_date(p_trip uuid, p_date date)                      set search_path = public, pg_temp;
alter function public.sync_budget_expense()                                             set search_path = public, pg_temp;
alter function public.take_geocode_token(p_min numeric, p_rate numeric, p_cap numeric)   set search_path = public, pg_temp;
alter function public.trg_recompute_transfer()                                          set search_path = public, pg_temp;

-- auth_email_status reads the auth schema → keep auth, add pg_temp last
alter function public.auth_email_status(p_email text)                                    set search_path = public, auth, pg_temp;

-- ── SECURITY INVOKER (run as caller) ──
alter function public.compute_ai_usage_cost()                                           set search_path = public, pg_temp;
alter function public.create_group_chat_for_trip()                                      set search_path = public, pg_temp;
alter function public.get_ai_usage_cursor()                                             set search_path = public, pg_temp;
alter function public.get_pending_reminders(window_minutes integer)                     set search_path = public, pg_temp;
alter function public.reminder_true_instant(ts timestamp with time zone, tz text)       set search_path = public, pg_temp;
alter function public.get_trips_activity_tomorrow()                                     set search_path = public, pg_temp;
alter function public.get_trips_car_dropoff_tomorrow()                                  set search_path = public, pg_temp;
alter function public.get_trips_car_pickup_tomorrow()                                   set search_path = public, pg_temp;
alter function public.get_trips_hotel_cancel_deadline_tomorrow()                        set search_path = public, pg_temp;
alter function public.get_trips_hotel_checkin_tomorrow()                                set search_path = public, pg_temp;
alter function public.get_trips_hotel_checkout_tomorrow()                               set search_path = public, pg_temp;
alter function public.get_trips_transfer_tomorrow()                                     set search_path = public, pg_temp;
alter function public._can_access_trip_document(p_trip_id uuid, p_visibility text, p_created_by uuid) set search_path = public, pg_temp;
alter function public._can_access_trip_file(p_object_name text)                          set search_path = public, pg_temp;
alter function public.translit_ru_lat(s text)                                            set search_path = public, pg_temp;
