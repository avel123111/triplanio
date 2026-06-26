-- TRIP-102 baseline — полный pg_dump схемы public (источник истины: prod tizscxrpuopobgcxbekf, снят 2026-06-26).
-- Заменяет catalog-generated снимок TRIP-68 (тот покрывал только public, содержал литеральные \n-артефакты
-- в CREATE TABLE и перечислял вью по алфавиту). Этот файл — настоящий pg_dump: топологический порядок,
-- корректный синтаксис, grants/owner/identity/comments.
--
-- Версия-таймстамп 20260625120000 СОХРАНЕНА намеренно: на prod/dev эта запись already-applied, поэтому файл
-- там НЕ исполняется (журналы prod/dev/репо остаются синхронными). Назначение файла — корректный bootstrap
-- чистой БД «с нуля» (supabase db reset / db push на пустой проект / CI-интеграционные тесты).
--
-- Содержит:
--   • схему public целиком — таблицы, sequences, 52 функции, 14 триггеров, 6 вью (security_invoker, топопорядок),
--     RLS + 42 политики, индексы, FK/constraints, grants;
--   • наши storage-объекты (в самом конце файла) — бакеты avatars/trips + 6 RLS-политик storage.objects.
-- НЕ содержит:
--   • платформенные схемы auth/storage DDL — их создаёт сам Supabase-стек (включение → коллизия «already exists»);
--   • storage.protect_delete() и триггеры protect_* — это платформенный механизм storage, не наш код.
--
-- Ниже идёт нетронутый вывод pg_dump (включая требуемый `SET check_function_bodies = false;`).
-- ============================================================================================================



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "fuzzystrmatch" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."_can_edit_trip"("p_trip" "uuid", "p_uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from trips t where t.id = p_trip and t.created_by = p_uid)
      or exists (
        select 1 from trip_members m
        where m.trip_id = p_trip and m.user_id = p_uid
          and coalesce(m.role, '') <> 'viewer'
          and coalesce(m.status, 'active') = 'active'
      );
$$;


ALTER FUNCTION "public"."_can_edit_trip"("p_trip" "uuid", "p_uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_trip_anchor_date"("p_trip" "uuid") RETURNS "date"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select (t.start_datetime at time zone 'UTC')::date
       from transfers t
       join city_visits sc on sc.id = t.from_city_visit_id and sc.kind = 'start'
      where t.trip_id = p_trip and t.start_datetime is not null
      order by t.start_datetime
      limit 1),
    (select cv.start_date
       from city_visits cv
      where cv.trip_id = p_trip and cv.kind not in ('start','end')
      order by case cv.kind when 'start' then 0 when 'end' then 2 else 1 end,
               cv.position nulls last, cv.start_date nulls last, cv.created_at
      limit 1),
    current_date
  );
$$;


ALTER FUNCTION "public"."_trip_anchor_date"("p_trip" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."active_owned_trips"("p_uid" "uuid") RETURNS TABLE("id" "uuid", "title" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select t.id, t.title
  from public.trips t
  where t.created_by = p_uid
    and coalesce(
          (select max(cv.end_date) from public.city_visits cv where cv.trip_id = t.id),
          current_date
        ) >= current_date
$$;


ALTER FUNCTION "public"."active_owned_trips"("p_uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_city"("p_trip" "uuid", "p_city" "jsonb", "p_index" integer DEFAULT NULL::integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_kind  text;
  v_pos   int;
  v_start date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

  v_kind := coalesce(nullif(p_city->>'kind',''), 'transit');
  v_pos  := coalesce(p_index, (select coalesce(max(position), -1) + 1 from city_visits where trip_id = p_trip));

  update city_visits set position = position + 1 where trip_id = p_trip and position >= v_pos;

  v_start := coalesce(
    (select max(end_date) from city_visits where trip_id = p_trip),
    current_date);

  insert into city_visits (
    trip_id, created_by, external_city_id, city_name, country, country_code,
    latitude, longitude, timezone, kind, start_date, end_date, position)
  values (
    p_trip, v_uid, nullif(p_city->>'external_city_id',''), p_city->>'city_name',
    p_city->>'country', p_city->>'country_code',
    nullif(p_city->>'latitude','')::numeric, nullif(p_city->>'longitude','')::numeric,
    nullif(p_city->>'timezone',''), v_kind,
    v_start, v_start + (case when v_kind = 'transit' then 2 else 0 end), v_pos)
  returning id into v_id;

  perform public.recompute_trip(p_trip, null);
  return v_id;
end;
$$;


ALTER FUNCTION "public"."add_city"("p_trip" "uuid", "p_city" "jsonb", "p_index" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_layover_transfer"("p_trip" "uuid", "p_from" "uuid", "p_to" "uuid", "p_waypoints" "jsonb", "p_segments" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid      uuid := auth.uid();
  v_from_pos int;
  v_wp       jsonb;
  v_wp_id    uuid;
  v_ids      uuid[];
  v_seg      jsonb;
  v_i        int := 0;
  v_idx      int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

  select position into v_from_pos from city_visits where id = p_from and trip_id = p_trip;
  if v_from_pos is null then raise exception 'from city not found in trip'; end if;

  v_ids := array[p_from];

  for v_wp in select value from jsonb_array_elements(coalesce(p_waypoints, '[]'::jsonb)) as t(value)
  loop
    v_i  := v_i + 1;
    v_idx := v_from_pos + v_i;
    update city_visits set position = position + 1, updated_at = now()
      where trip_id = p_trip and position >= v_idx;
    insert into city_visits (
      trip_id, created_by, external_city_id, city_name, country, country_code,
      latitude, longitude, timezone, kind, start_date, end_date, position)
    values (
      p_trip, v_uid, nullif(v_wp->>'external_city_id',''), v_wp->>'city_name',
      v_wp->>'country', v_wp->>'country_code',
      nullif(v_wp->>'latitude','')::numeric, nullif(v_wp->>'longitude','')::numeric,
      nullif(v_wp->>'timezone',''), 'waypoint',
      current_date, current_date, v_idx)
    returning id into v_wp_id;
    v_ids := v_ids || v_wp_id;
  end loop;

  v_ids := v_ids || p_to;

  v_i := 0;
  for v_seg in select value from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) as t(value)
  loop
    v_i := v_i + 1;
    insert into transfers (
      trip_id, created_by, from_city_visit_id, to_city_visit_id,
      transport_type, day_change, start_datetime, end_datetime,
      carrier, flight_number, from_address, to_address,
      from_latitude, from_longitude, to_latitude, to_longitude,
      booking_reference, booking_url,
      price, currency, documents, notes, details)
    values (
      p_trip, v_uid, v_ids[v_i], v_ids[v_i + 1],
      v_seg->>'transport_type', coalesce((v_seg->>'day_change')::boolean, false),
      nullif(v_seg->>'start_datetime','')::timestamptz, nullif(v_seg->>'end_datetime','')::timestamptz,
      nullif(v_seg->>'carrier',''), nullif(v_seg->>'flight_number',''),
      nullif(v_seg->>'from_address',''), nullif(v_seg->>'to_address',''),
      nullif(v_seg->>'from_latitude','')::double precision, nullif(v_seg->>'from_longitude','')::double precision,
      nullif(v_seg->>'to_latitude','')::double precision, nullif(v_seg->>'to_longitude','')::double precision,
      nullif(v_seg->>'booking_reference',''), nullif(v_seg->>'booking_url',''),
      nullif(v_seg->>'price','')::numeric, coalesce(nullif(v_seg->>'currency',''), 'EUR'),
      coalesce(v_seg->'documents', '[]'::jsonb),
      nullif(v_seg->>'notes',''), '{}'::jsonb);
  end loop;

  perform public.recompute_trip(p_trip, null);
end;
$$;


ALTER FUNCTION "public"."add_layover_transfer"("p_trip" "uuid", "p_from" "uuid", "p_to" "uuid", "p_waypoints" "jsonb", "p_segments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anonymize_my_account"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_active_sub int;
begin
  if p_user_id is null then return jsonb_build_object('code','unauthorized'); end if;

  select count(*) into v_active_sub from public.trip_subscriptions
  where user_id = p_user_id and type in ('pro_monthly','pro_yearly') and status='active';
  if v_active_sub > 0 then return jsonb_build_object('code','active_subscription'); end if;

  -- purely-personal records
  delete from public.chat_reads             where user_id = p_user_id;
  delete from public.notifications          where user_id = p_user_id;
  delete from public.telegram_link_tokens   where user_id = p_user_id;
  delete from public.telegram_reminder_logs where user_id = p_user_id;
  delete from public.trip_telegram_integrations where user_id = p_user_id;
  delete from public.user_custom_visits     where user_id = p_user_id;
  delete from public.trip_member_blocks     where user_id = p_user_id;

  update public.users
  set email='deleted+'||p_user_id::text||'@deleted.invalid', full_name=null, avatar_url=null, deleted_at=now()
  where id = p_user_id;

  update public.trip_members set user_full_name=null, invite_email=null where user_id = p_user_id;

  -- Scrub denormalized author-name snapshots on RETAINED content (PII at rest).
  -- Display already renders "deleted account" via is_deleted, so this only
  -- removes the lingering real name from the row. Mirrors the trip_members
  -- cache scrub above. chat_messages.user_full_name = pre-existing snapshot;
  -- trip_documents.created_by_name = added in 0062.
  update public.chat_messages  set user_full_name = null where user_id   = p_user_id;
  update public.trip_documents set created_by_name = null where created_by = p_user_id;

  delete from auth.sessions   where user_id = p_user_id;
  delete from auth.identities where user_id = p_user_id;
  update auth.users set email='deleted+'||p_user_id::text||'@deleted.invalid', updated_at=now() where id = p_user_id;

  return jsonb_build_object('code','ok');
end; $$;


ALTER FUNCTION "public"."anonymize_my_account"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_viator_reassign"("p_updates" "jsonb", "p_inserts" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_cleared int; v_updated int; v_inserted int; v_deleted int;
begin
  update public.cities set viator_dest_id = null where viator_dest_id is not null;
  get diagnostics v_cleared = row_count;

  update public.cities c set viator_dest_id = u.viator_dest_id, updated_at = now()
  from jsonb_to_recordset(p_updates) as u(id bigint, viator_dest_id text)
  where c.id = u.id;
  get diagnostics v_updated = row_count;

  insert into public.cities (name_en, country_code, lat, lng, time_zone, iata_code, viator_dest_id, source)
  select i.name_en, i.country_code, i.lat, i.lng, i.time_zone, i.iata_code, i.viator_dest_id, 'viator'
  from jsonb_to_recordset(p_inserts) as i(name_en text, country_code text, lat double precision, lng double precision, time_zone text, iata_code text, viator_dest_id text);
  get diagnostics v_inserted = row_count;

  delete from public.cities c
  where c.source = 'viator' and c.viator_dest_id is null
    and not exists (select 1 from public.city_visits v where v.city_id = c.id);
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('cleared',v_cleared,'updated',v_updated,'inserted',v_inserted,'deleted_orphans',v_deleted);
end; $$;


ALTER FUNCTION "public"."apply_viator_reassign"("p_updates" "jsonb", "p_inserts" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_email_status"("p_email" "text") RETURNS TABLE("exists_user" boolean, "is_confirmed" boolean, "has_password" boolean, "has_oauth" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select
    count(u.*) > 0                                                            as exists_user,
    coalesce(bool_or(u.email_confirmed_at is not null), false)                as is_confirmed,
    coalesce(bool_or(i.provider = 'email'), false)                            as has_password,
    coalesce(bool_or(i.provider is not null and i.provider <> 'email'), false) as has_oauth
  from auth.users u
  left join auth.identities i on i.user_id = u.id
  where lower(u.email) = lower(p_email);
$$;


ALTER FUNCTION "public"."auth_email_status"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_ai_usage_cost"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_price  numeric(20,12);
  v_total  numeric(20,10) := 0;
  v_bd     jsonb := '{}'::jsonb;
  v_complete boolean := true;

  -- helper-ish inline: for each metric, look up price & accumulate
  procedure_dummy int;
begin
  -- normalize model: strip leading "models/" if present
  if NEW.model like 'models/%' then
    NEW.model := substring(NEW.model from 8);
  end if;

  -- derive tokens_total if missing
  if NEW.tokens_total is null and (NEW.tokens_input is not null or NEW.tokens_output is not null) then
    NEW.tokens_total := coalesce(NEW.tokens_input,0) + coalesce(NEW.tokens_output,0);
  end if;

  -- if caller already supplied cost, respect it
  if NEW.cost_usd is not null then
    return NEW;
  end if;

  -- input tokens
  if NEW.tokens_input is not null and NEW.tokens_input <> 0 then
    select unit_price_usd into v_price from public.ai_model_prices
      where provider = NEW.provider and model = NEW.model and unit = 'input_token'
        and effective_from <= NEW.occurred_at
        and (effective_to is null or effective_to > NEW.occurred_at)
      order by effective_from desc limit 1;
    if v_price is null then v_complete := false;
    else
      v_total := v_total + NEW.tokens_input * v_price;
      v_bd := v_bd || jsonb_build_object('input_token', round((NEW.tokens_input * v_price)::numeric, 10));
    end if;
  end if;

  -- output tokens
  v_price := null;
  if NEW.tokens_output is not null and NEW.tokens_output <> 0 then
    select unit_price_usd into v_price from public.ai_model_prices
      where provider = NEW.provider and model = NEW.model and unit = 'output_token'
        and effective_from <= NEW.occurred_at
        and (effective_to is null or effective_to > NEW.occurred_at)
      order by effective_from desc limit 1;
    if v_price is null then v_complete := false;
    else
      v_total := v_total + NEW.tokens_output * v_price;
      v_bd := v_bd || jsonb_build_object('output_token', round((NEW.tokens_output * v_price)::numeric, 10));
    end if;
  end if;

  -- pages
  v_price := null;
  if NEW.pages is not null and NEW.pages <> 0 then
    select unit_price_usd into v_price from public.ai_model_prices
      where provider = NEW.provider and model = NEW.model and unit = 'page'
        and effective_from <= NEW.occurred_at
        and (effective_to is null or effective_to > NEW.occurred_at)
      order by effective_from desc limit 1;
    if v_price is null then v_complete := false;
    else
      v_total := v_total + NEW.pages * v_price;
      v_bd := v_bd || jsonb_build_object('page', round((NEW.pages * v_price)::numeric, 10));
    end if;
  end if;

  -- per-request pricing (optional, only if a 'request' price exists)
  v_price := null;
  if NEW.requests is not null and NEW.requests <> 0 then
    select unit_price_usd into v_price from public.ai_model_prices
      where provider = NEW.provider and model = NEW.model and unit = 'request'
        and effective_from <= NEW.occurred_at
        and (effective_to is null or effective_to > NEW.occurred_at)
      order by effective_from desc limit 1;
    if v_price is not null then
      v_total := v_total + NEW.requests * v_price;
      v_bd := v_bd || jsonb_build_object('request', round((NEW.requests * v_price)::numeric, 10));
    end if;
  end if;

  NEW.cost_usd := round(v_total, 10);
  NEW.cost_breakdown := v_bd;
  NEW.pricing_complete := v_complete;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."compute_ai_usage_cost"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_active_owned_trips"("p_uid" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select count(*)::int from public.active_owned_trips(p_uid)
$$;


ALTER FUNCTION "public"."count_active_owned_trips"("p_uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_group_chat_for_trip"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO chats (trip_id, type)
  VALUES (NEW.id, 'group')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_group_chat_for_trip"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_trip"("p_title" "text", "p_description" "text" DEFAULT ''::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid; v_trip_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  insert into public.trips (title, description, created_by)
  values (p_title, p_description, v_uid)
  returning id into v_trip_id;
  return v_trip_id;
end $$;


ALTER FUNCTION "public"."create_trip"("p_title" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_trip_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := NEW.created_by;
begin
  if v_uid is not null and not public.is_user_pro(v_uid) then
    if public.count_active_owned_trips(v_uid) >= 1 then
      raise exception 'TRIP_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end $$;


ALTER FUNCTION "public"."enforce_trip_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_trip_budget"("p_trip_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_owner uuid; v_currency text;
begin
  select created_by, coalesce(details->>'main_currency','EUR') into v_owner, v_currency
  from public.trips where id = p_trip_id;
  if v_owner is null then return; end if;

  insert into public.trip_budgets (trip_id, currency, fx_overrides, created_by)
  select p_trip_id, coalesce(v_currency,'EUR'), '{}'::jsonb, v_owner
  where not exists (select 1 from public.trip_budgets where trip_id = p_trip_id);

  if not exists (select 1 from public.budget_categories where trip_id = p_trip_id) then
    insert into public.budget_categories (trip_id, kind, name, system_key, icon, color, order_index, created_by) values
      (p_trip_id,'system','Accommodation','accommodation','🏨','#6366f1',0,v_owner),
      (p_trip_id,'system','Transport','transport','✈️','#0ea5e9',1,v_owner),
      (p_trip_id,'system','Activities','activities','🎭','#10b981',2,v_owner),
      (p_trip_id,'system','Services','services','🧳','#14b8a6',3,v_owner),
      (p_trip_id,'custom','Food',null,'🍽️','#f59e0b',4,v_owner),
      (p_trip_id,'custom','Shopping',null,'🛍️','#ec4899',5,v_owner),
      (p_trip_id,'custom','Souvenirs',null,'🎁','#8b5cf6',6,v_owner),
      (p_trip_id,'custom','Other',null,'💰','#78716c',7,v_owner);
  end if;
end $$;


ALTER FUNCTION "public"."ensure_trip_budget"("p_trip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."geocode_dequeue"("p_ticket" bigint) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  delete from public.geocode_queue where id = p_ticket;
$$;


ALTER FUNCTION "public"."geocode_dequeue"("p_ticket" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."geocode_enqueue"("p_priority" integer) RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into public.geocode_queue (priority)
  values (greatest(1, coalesce(p_priority, 2)))
  returning id;
$$;


ALTER FUNCTION "public"."geocode_enqueue"("p_priority" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."geocode_serve_fair"("p_ticket" bigint, "p_min" numeric DEFAULT 1, "p_rate" numeric DEFAULT 2, "p_cap" numeric DEFAULT 2) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tokens  numeric;
  v_updated timestamptz;
  v_now     timestamptz := clock_timestamp();
  v_head    bigint;
begin
  insert into public.geocode_rate_bucket (id, tokens, updated_at)
  values (1, p_cap, v_now)
  on conflict (id) do nothing;

  select tokens, updated_at into v_tokens, v_updated
  from public.geocode_rate_bucket where id = 1 for update;

  delete from public.geocode_queue where enqueued_at < v_now - interval '60 seconds';

  v_tokens := least(p_cap, v_tokens + extract(epoch from (v_now - v_updated)) * p_rate);

  select id into v_head from public.geocode_queue order by priority asc, id asc limit 1;

  if v_head is not null and v_head = p_ticket and v_tokens >= p_min then
    v_tokens := v_tokens - 1;
    delete from public.geocode_queue where id = p_ticket;
    update public.geocode_rate_bucket set tokens = v_tokens, updated_at = v_now where id = 1;
    return true;
  end if;

  update public.geocode_rate_bucket set tokens = v_tokens, updated_at = v_now where id = 1;
  return false;
end;
$$;


ALTER FUNCTION "public"."geocode_serve_fair"("p_ticket" bigint, "p_min" numeric, "p_rate" numeric, "p_cap" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_ai_usage_cursor"() RETURNS json
    LANGUAGE "sql" STABLE
    AS $_$
  select json_build_object('cursor', coalesce(max((execution_id)::bigint), 0))
  from public.ai_usage_events
  where execution_id ~ '^[0-9]+$';
$_$;


ALTER FUNCTION "public"."get_ai_usage_cursor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_pending_reminders"("window_minutes" integer DEFAULT 15) RETURNS TABLE("type" "text", "user_id" "text", "user_locale" "text", "trip_id" "uuid", "chat_id" "text", "context" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  with active_users as (
    select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id,
           coalesce(u.language, 'en') as locale
    from trip_telegram_integrations tti
    join users u on u.id = tti.user_id
    where tti.is_active = true and tti.telegram_chat_id is not null
  ),
  hotel_checkin as (
    select 'hotel_checkin'::text as type, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(h) || jsonb_build_object('event_timezone', coalesce(nullif(cv.timezone, ''), 'UTC')) as context,
           h.check_in_datetime as evt_wall, cv.timezone as evt_tz
    from hotel_stays h
    join active_users au on au.trip_id = h.trip_id
    left join city_visits cv on cv.id = h.city_visit_id
    where public.reminder_true_instant(h.check_in_datetime, cv.timezone)
          between now() + interval '24 hours' and now() + interval '24 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_checkin' and l.event_id = h.id)
  ),
  hotel_checkout as (
    select 'hotel_checkout'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(h) || jsonb_build_object('event_timezone', coalesce(nullif(cv.timezone, ''), 'UTC')),
           h.check_out_datetime, cv.timezone
    from hotel_stays h
    join active_users au on au.trip_id = h.trip_id
    left join city_visits cv on cv.id = h.city_visit_id
    where public.reminder_true_instant(h.check_out_datetime, cv.timezone)
          between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_checkout' and l.event_id = h.id)
  ),
  hotel_cancel as (
    select 'hotel_cancel_deadline'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(h) || jsonb_build_object('event_timezone', coalesce(nullif(cv.timezone, ''), 'UTC')),
           h.free_cancellation_until, cv.timezone
    from hotel_stays h
    join active_users au on au.trip_id = h.trip_id
    left join city_visits cv on cv.id = h.city_visit_id
    where h.free_cancellation = true
      and public.reminder_true_instant(h.free_cancellation_until, cv.timezone)
          between now() + interval '24 hours' and now() + interval '24 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_cancel_deadline' and l.event_id = h.id)
  ),
  transfer_start as (
    select 'transfer_start'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(t) || jsonb_build_object('event_timezone', coalesce(nullif(fcv.timezone, ''), 'UTC')),
           t.start_datetime, fcv.timezone
    from transfers t
    join active_users au on au.trip_id = t.trip_id
    left join city_visits fcv on fcv.id = t.from_city_visit_id
    where public.reminder_true_instant(t.start_datetime, fcv.timezone)
          between now() + interval '4 hours' and now() + interval '4 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'transfer_start' and l.event_id = t.id)
  ),
  activity_start as (
    select 'activity_start'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(a) || jsonb_build_object('event_timezone', coalesce(nullif(cv.timezone, ''), 'UTC')),
           a.start_datetime, cv.timezone
    from activities a
    join active_users au on au.trip_id = a.trip_id
    left join city_visits cv on cv.id = a.city_visit_id
    where public.reminder_true_instant(a.start_datetime, cv.timezone)
          between now() + interval '4 hours' and now() + interval '4 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'activity_start' and l.event_id = a.id)
  ),
  car_pickup as (
    select 'car_rental_pickup'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(s) || jsonb_build_object('event_timezone', coalesce(nullif(s.details->>'pickup_timezone', ''), 'UTC')),
           s.pickup_datetime, s.details->>'pickup_timezone'
    from trip_services s
    join active_users au on au.trip_id = s.trip_id
    where s.kind = 'car_rental'
      and public.reminder_true_instant(s.pickup_datetime, s.details->>'pickup_timezone')
          between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'car_rental_pickup' and l.event_id = s.id)
  ),
  car_dropoff as (
    select 'car_rental_dropoff'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(s) || jsonb_build_object('event_timezone', coalesce(nullif(coalesce(s.details->>'dropoff_timezone', s.details->>'pickup_timezone'), ''), 'UTC')),
           s.dropoff_datetime, coalesce(s.details->>'dropoff_timezone', s.details->>'pickup_timezone')
    from trip_services s
    join active_users au on au.trip_id = s.trip_id
    where s.kind = 'car_rental'
      and public.reminder_true_instant(s.dropoff_datetime, coalesce(s.details->>'dropoff_timezone', s.details->>'pickup_timezone'))
          between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'car_rental_dropoff' and l.event_id = s.id)
  ),
  all_reminders as (
    select * from hotel_checkin
    union all select * from hotel_checkout
    union all select * from hotel_cancel
    union all select * from transfer_start
    union all select * from activity_start
    union all select * from car_pickup
    union all select * from car_dropoff
  )
  select
    type, user_id::text, locale as user_locale, trip_id, chat_id,
    context || jsonb_build_object(
      'event_instant_utc', public.reminder_true_instant(evt_wall, evt_tz),
      'starts_in_minutes', round(extract(epoch from (public.reminder_true_instant(evt_wall, evt_tz) - now())) / 60.0)::int,
      'event_local_time', to_char(evt_wall, 'HH24:MI'),
      'event_local_date', to_char(evt_wall, 'YYYY-MM-DD'),
      'relative_day',
        case (public.reminder_true_instant(evt_wall, evt_tz) at time zone coalesce(nullif(evt_tz, ''), 'UTC'))::date
             - (now() at time zone coalesce(nullif(evt_tz, ''), 'UTC'))::date
          when 0 then 'today'
          when 1 then 'tomorrow'
          else 'in_' || ((public.reminder_true_instant(evt_wall, evt_tz) at time zone coalesce(nullif(evt_tz, ''), 'UTC'))::date
                         - (now() at time zone coalesce(nullif(evt_tz, ''), 'UTC'))::date)::text || '_days'
        end
    ) as context
  from all_reminders;
$$;


ALTER FUNCTION "public"."get_pending_reminders"("window_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trip_owner_profiles"("trip_id_list" "uuid"[]) RETURNS TABLE("trip_id" "uuid", "user_id" "uuid", "full_name" "text", "email" "text", "avatar_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    t.id        AS trip_id,
    u.id        AS user_id,
    COALESCE(u.full_name, '') AS full_name,
    COALESCE(u.email,     '') AS email,
    COALESCE(u.avatar_url,'') AS avatar_url
  FROM trips t
  JOIN users u ON u.id = t.created_by
  WHERE
    t.id = ANY(trip_id_list)
    AND (
      t.created_by = auth.uid()
      OR
      EXISTS (
        SELECT 1 FROM trip_members tm
        WHERE tm.trip_id = t.id
          AND tm.user_id = auth.uid()
          AND tm.status  = 'active'
      )
    );
$$;


ALTER FUNCTION "public"."get_trip_owner_profiles"("trip_id_list" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trip_participant_profiles"("trip_id_list" "uuid"[]) RETURNS TABLE("trip_id" "uuid", "user_id" "uuid", "full_name" "text", "email" "text", "avatar_url" "text", "role" "text", "is_owner" boolean, "is_deleted" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  WITH accessible AS (
    SELECT t.id FROM trips t WHERE t.id = ANY(trip_id_list)
      AND (t.created_by = auth.uid() OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = t.id AND tm.user_id = auth.uid() AND tm.status = 'active'))
  )
  SELECT t.id, u.id, COALESCE(u.full_name,''),
         CASE WHEN u.deleted_at IS NOT NULL THEN '' ELSE COALESCE(u.email,'') END,
         COALESCE(u.avatar_url,''), 'owner'::text, true, (u.deleted_at IS NOT NULL)
  FROM trips t JOIN users u ON u.id = t.created_by WHERE t.id IN (SELECT id FROM accessible)
  UNION ALL
  SELECT tm.trip_id, COALESCE(u.id, tm.user_id),
         COALESCE(u.full_name, tm.user_full_name,''),
         CASE WHEN u.deleted_at IS NOT NULL THEN '' ELSE COALESCE(u.email, tm.invite_email,'') END,
         COALESCE(u.avatar_url,''), tm.role, false, (u.deleted_at IS NOT NULL)
  FROM trip_members tm LEFT JOIN users u ON u.id = tm.user_id
  WHERE tm.trip_id IN (SELECT id FROM accessible) AND tm.status = 'active';
$$;


ALTER FUNCTION "public"."get_trip_participant_profiles"("trip_id_list" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trips_activity_tomorrow"() RETURNS TABLE("trip_id" "uuid", "user_id" "text", "chat_id" "text", "user_locale" "text", "event_id" "uuid", "context" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, a.id, to_jsonb(a)
  from activities a
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = a.trip_id
  where a.start_datetime::date = current_date + 1;
$$;


ALTER FUNCTION "public"."get_trips_activity_tomorrow"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trips_car_dropoff_tomorrow"() RETURNS TABLE("trip_id" "uuid", "user_id" "text", "chat_id" "text", "user_locale" "text", "event_id" "uuid", "context" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, s.id, to_jsonb(s)
  from trip_services s
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = s.trip_id
  where s.kind = 'car_rental'
    and coalesce(s.dropoff_datetime, (s.details->>'dropoff_at_local')::timestamptz)::date = current_date + 1;
$$;


ALTER FUNCTION "public"."get_trips_car_dropoff_tomorrow"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trips_car_pickup_tomorrow"() RETURNS TABLE("trip_id" "uuid", "user_id" "text", "chat_id" "text", "user_locale" "text", "event_id" "uuid", "context" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, s.id, to_jsonb(s)
  from trip_services s
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = s.trip_id
  where s.kind = 'car_rental'
    and coalesce(s.pickup_datetime, (s.details->>'pickup_at_local')::timestamptz)::date = current_date + 1;
$$;


ALTER FUNCTION "public"."get_trips_car_pickup_tomorrow"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trips_hotel_cancel_deadline_tomorrow"() RETURNS TABLE("trip_id" "uuid", "user_id" "text", "chat_id" "text", "user_locale" "text", "event_id" "uuid", "context" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, h.id, to_jsonb(h)
  from hotel_stays h
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = h.trip_id
  where h.free_cancellation = true and h.free_cancellation_until::date = current_date + 1;
$$;


ALTER FUNCTION "public"."get_trips_hotel_cancel_deadline_tomorrow"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trips_hotel_checkin_tomorrow"() RETURNS TABLE("trip_id" "uuid", "user_id" "text", "chat_id" "text", "user_locale" "text", "event_id" "uuid", "context" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, h.id, to_jsonb(h)
  from hotel_stays h
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = h.trip_id
  where h.check_in_datetime::date = current_date + 1;
$$;


ALTER FUNCTION "public"."get_trips_hotel_checkin_tomorrow"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trips_hotel_checkout_tomorrow"() RETURNS TABLE("trip_id" "uuid", "user_id" "text", "chat_id" "text", "user_locale" "text", "event_id" "uuid", "context" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, h.id, to_jsonb(h)
  from hotel_stays h
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = h.trip_id
  where h.check_out_datetime::date = current_date + 1;
$$;


ALTER FUNCTION "public"."get_trips_hotel_checkout_tomorrow"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_trips_transfer_tomorrow"() RETURNS TABLE("trip_id" "uuid", "user_id" "text", "chat_id" "text", "user_locale" "text", "event_id" "uuid", "context" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, t.id, to_jsonb(t)
  from transfers t
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = t.trip_id
  where t.start_datetime::date = current_date + 1;
$$;


ALTER FUNCTION "public"."get_trips_transfer_tomorrow"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_travel_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_points jsonb; v_trips jsonb; v_transfers int; v_trip_visits jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  with my_trips as (
    select t.id, t.title, t.cover_gradient, t.cover_image_url
    from public.trips t where public.is_trip_participant(t.id)
  ),
  all_visits as (
    select cv.id, cv.trip_id, cv.kind, cv.city_name, cv.country_code,
           cv.latitude, cv.longitude, cv.start_date, cv.end_date
    from public.city_visits cv join my_trips mt on mt.id = cv.trip_id
  ),
  trip_points as (
    select jsonb_agg(jsonb_build_object('id',id,'kind','trip','trip_id',trip_id,
      'city_name',city_name,'country_code',country_code,'lat',latitude,'lng',longitude,
      'start_date',start_date,'end_date',end_date)) as arr
    from all_visits where kind='transit'
  ),
  custom_points as (
    select jsonb_agg(jsonb_build_object('id',ucv.id,'kind','custom','trip_id',null,
      'city_name',ucv.city_name,'country_code',ucv.country_code,'lat',ucv.lat,'lng',ucv.lng,
      'start_date',ucv.start_date,'end_date',ucv.end_date)) as arr
    from public.user_custom_visits ucv where ucv.user_id = v_uid
  ),
  trip_visits as (
    select jsonb_object_agg(trip_id::text, rows) as obj from (
      select trip_id, jsonb_agg(jsonb_build_object('kind',kind,'city_name',city_name,
        'country_code',country_code,'start_date',start_date,'end_date',end_date)) as rows
      from all_visits group by trip_id
    ) g
  )
  select
    coalesce((select arr from trip_points),'[]'::jsonb) || coalesce((select arr from custom_points),'[]'::jsonb),
    coalesce((select jsonb_object_agg(mt.id::text, jsonb_build_object('title',mt.title,
      'cover_gradient',mt.cover_gradient,'cover_image_url',mt.cover_image_url)) from my_trips mt),'{}'::jsonb),
    coalesce((select count(*) from public.transfers tr where tr.trip_id in (select id from my_trips)),0),
    coalesce((select obj from trip_visits),'{}'::jsonb)
  into v_points, v_trips, v_transfers, v_trip_visits;
  return jsonb_build_object('points',v_points,'trips',v_trips,'transfers_total',v_transfers,'trip_visits',v_trip_visits);
end $$;


ALTER FUNCTION "public"."get_user_travel_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_trip_creator"("p_trip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select exists (select 1 from public.trips where id = p_trip_id and created_by = auth.uid());
$$;


ALTER FUNCTION "public"."is_trip_creator"("p_trip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_trip_participant"("p_trip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select exists (select 1 from public.trips where id = p_trip_id and created_by = auth.uid())
      or exists (select 1 from public.trip_members
                 where trip_id = p_trip_id and user_id = auth.uid() and status = 'active');
$$;


ALTER FUNCTION "public"."is_trip_participant"("p_trip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_trip_pro"("p_trip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select t.is_pro_trip or public.is_user_pro(t.created_by)
     from public.trips t
     where t.id = p_trip_id),
    false)
$$;


ALTER FUNCTION "public"."is_trip_pro"("p_trip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_user_pro"("p_uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select u.subscription_status = 'pro'
            and u.subscription_end_date is not null
            and u.subscription_end_date > now()
     from public.users u
     where u.id = p_uid),
    false)
$$;


ALTER FUNCTION "public"."is_user_pro"("p_uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."learn_city"("p_name_en" "text", "p_country_code" "text", "p_lat" double precision, "p_lng" double precision) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id   bigint;
  v_name text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_cc   text := upper(nullif(btrim(coalesce(p_country_code, '')), ''));
begin
  if v_name is null or v_cc is null or p_lat is null or p_lng is null then
    return null;
  end if;

  select id into v_id
  from cities
  where upper(country_code) = v_cc
    and lower(unaccent(name_en)) = lower(unaccent(v_name))
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into cities (name_en, country_code, lat, lng, source)
  values (v_name, v_cc, p_lat, p_lng, 'locationiq')
  returning id into v_id;
  return v_id;
exception when others then
  return null;
end;
$$;


ALTER FUNCTION "public"."learn_city"("p_name_en" "text", "p_country_code" "text", "p_lat" double precision, "p_lng" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_pending_invites"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if NEW.email is null then
    return NEW;
  end if;

  update public.trip_members m
     set user_id = NEW.id
   where m.user_id is null
     and m.status = 'pending'
     and lower(m.invite_email) = lower(NEW.email);

  insert into public.notifications
    (user_id, type, i18n_title_key, i18n_message_key, i18n_params,
     title, message, trip_id, trip_member_id, read, created_by)
  select NEW.id, 'trip_invite', 'notif.tpl_invite_title', 'notif.tpl_invite_msg',
         jsonb_build_object(
           'trip', t.title,
           'inviter', coalesce(iu.full_name, ''),
           'role_key', case when m.role = 'admin' then 'notif.role_admin' else 'notif.role_viewer' end
         ),
         'Trip invitation', '', m.trip_id, m.id, false, m.invited_by
    from public.trip_members m
    join public.trips t on t.id = m.trip_id
    left join public.users iu on iu.id = m.invited_by
   where m.user_id = NEW.id and m.status = 'pending';

  return NEW;
end $$;


ALTER FUNCTION "public"."link_pending_invites"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_booking_added"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_kind text := tg_argv[0];
  agg record;
  rec record;
  actor_name text;
  trip_title text;
begin
  for agg in
    select trip_id, count(*)::int as n, (array_agg(created_by))[1] as actor_id
    from newrows
    group by trip_id
  loop
    select coalesce(u.full_name, '') into actor_name from users u where u.id = agg.actor_id;
    select title into trip_title from trips where id = agg.trip_id;

    for rec in
      select x.uid as user_id, coalesce(u.language, 'en') as lang
      from (
        select tm.user_id as uid
        from trip_members tm
        where tm.trip_id = agg.trip_id and tm.status = 'active' and tm.user_id is not null
        union
        select t.created_by as uid
        from trips t
        where t.id = agg.trip_id
      ) x
      join users u on u.id = x.uid
      where x.uid <> agg.actor_id
    loop
      insert into notifications
        (user_id, type, i18n_title_key, i18n_message_key, i18n_params, title, message, trip_id, read, created_by)
      values (
        rec.user_id,
        'trip_booking_added',
        'notif.tpl_booking_added_title',
        case when agg.n > 1 then 'notif.tpl_booking_added_batch_msg' else 'notif.tpl_booking_added_msg' end,
        jsonb_build_object('name', actor_name, 'count', agg.n, 'kind', v_kind, 'trip', trip_title),
        case rec.lang
          when 'ru' then actor_name || ' добавил бронь'
          when 'es' then actor_name || ' añadió una reserva'
          else actor_name || ' added a booking'
        end,
        case when agg.n > 1 then
          case rec.lang
            when 'ru' then agg.n || ' брони в «' || trip_title || '»'
            when 'es' then agg.n || ' reservas en «' || trip_title || '»'
            else agg.n || ' bookings in "' || trip_title || '"'
          end
        else
          case rec.lang
            when 'ru' then (case v_kind when 'hotel' then 'Отель' when 'transfer' then 'Переезд' when 'service' then 'Услуга' else 'Бронь' end) || ' в «' || trip_title || '»'
            when 'es' then (case v_kind when 'hotel' then 'Hotel' when 'transfer' then 'Transporte' when 'service' then 'Servicio' else 'Reserva' end) || ' en «' || trip_title || '»'
            else (case v_kind when 'hotel' then 'Hotel' when 'transfer' then 'Transfer' when 'service' then 'Service' else 'Booking' end) || ' in "' || trip_title || '"'
          end
        end,
        agg.trip_id, false, agg.actor_id
      );
    end loop;
  end loop;
  return null;
exception when others then
  raise warning 'notify_booking_added failed: %', sqlerrm;
  return null;
end $$;


ALTER FUNCTION "public"."notify_booking_added"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_trip"("p_trip" "uuid", "p_base" "date" DEFAULT NULL::"date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cursor  date;
  v_prev_id uuid := null;
  v_gap     int;
  v_nights  int;
  v_start   date;
  v_end     date;
  rec       record;
begin
  v_cursor := coalesce(p_base, public._trip_anchor_date(p_trip));

  for rec in
    select cv.id, cv.kind, cv.start_date, cv.end_date,
           (row_number() over (
              order by case cv.kind when 'start' then 0 when 'end' then 2 else 1 end,
                       cv.position nulls last, cv.start_date nulls last, cv.created_at
           ) - 1) as idx
    from city_visits cv
    where cv.trip_id = p_trip
    order by idx
  loop
    if rec.kind = 'start' then
      update city_visits
        set start_date = v_cursor, end_date = v_cursor, position = rec.idx, updated_at = now()
      where id = rec.id;
      v_prev_id := rec.id;
      continue;
    end if;

    if rec.kind = 'end' then
      v_gap := 0;
      if v_prev_id is not null then
        select case when bool_or(t.day_change) then 1 else 0 end
          into v_gap
        from transfers t
        where t.trip_id = p_trip
          and t.from_city_visit_id = v_prev_id
          and t.to_city_visit_id   = rec.id;
        v_gap := coalesce(v_gap, 0);
      end if;
      update city_visits
        set start_date = v_cursor + v_gap, end_date = v_cursor + v_gap, position = rec.idx, updated_at = now()
      where id = rec.id;
      v_prev_id := rec.id;
      continue;
    end if;

    v_gap := 0;
    if v_prev_id is not null then
      select case when bool_or(t.day_change) then 1 else 0 end
        into v_gap
      from transfers t
      where t.trip_id = p_trip
        and t.from_city_visit_id = v_prev_id
        and t.to_city_visit_id   = rec.id;
      v_gap := coalesce(v_gap, 0);
    end if;

    v_start := v_cursor + v_gap;

    if rec.kind = 'waypoint' then
      update city_visits
        set start_date = v_start, end_date = v_start, position = rec.idx, updated_at = now()
      where id = rec.id;
      v_cursor := v_start;
    else
      v_nights := greatest(0, coalesce((rec.end_date - rec.start_date), 1));
      v_end := case when v_nights > 0 then v_start + v_nights else v_start end;
      update city_visits
        set start_date = v_start, end_date = v_end, position = rec.idx, updated_at = now()
      where id = rec.id;
      v_cursor := v_start + v_nights;
    end if;

    v_prev_id := rec.id;
  end loop;
end;
$$;


ALTER FUNCTION "public"."recompute_trip"("p_trip" "uuid", "p_base" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_user_entitlement"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_end timestamptz;
begin
  select max(
    case
      when ts.status = 'past_due' then
        greatest(
          coalesce(
            (ts.provider_meta->>'next_payment_attempt')::timestamptz + interval '1 day',
            now() + interval '3 days'
          ),
          now() + interval '1 minute'
        )
      else coalesce(ts.current_period_end, ts.end_date)
    end
  )
  into v_end
  from trip_subscriptions ts
  where ts.user_id = p_user_id
    and ts.type in ('pro_monthly', 'pro_yearly')
    and ts.status in ('active', 'trialing', 'past_due');

  if v_end is not null then
    update users
       set subscription_status = 'pro',
           subscription_end_date = v_end
     where id = p_user_id;
  else
    update users
       set subscription_status = 'free',
           subscription_end_date = null
     where id = p_user_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."recompute_user_entitlement"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reminder_true_instant"("ts" timestamp with time zone, "tz" "text") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    AS $$
  select case
    when ts is null then null
    when tz is null or tz = '' or tz = 'UTC' then ts
    else (ts at time zone 'UTC') at time zone tz
  end;
$$;


ALTER FUNCTION "public"."reminder_true_instant"("ts" timestamp with time zone, "tz" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_city"("p_city" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_trip uuid;
  v_base date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select trip_id into v_trip from city_visits where id = p_city;
  if v_trip is null then raise exception 'city not found'; end if;
  if not public._can_edit_trip(v_trip, v_uid) then raise exception 'forbidden'; end if;

  v_base := public._trip_anchor_date(v_trip);

  delete from hotel_stays where trip_id = v_trip and city_visit_id = p_city;
  delete from activities  where trip_id = v_trip and city_visit_id = p_city;
  delete from transfers   where trip_id = v_trip and (from_city_visit_id = p_city or to_city_visit_id = p_city);
  delete from city_visits where id = p_city;

  perform public.recompute_trip(v_trip, v_base);
end;
$$;


ALTER FUNCTION "public"."remove_city"("p_city" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_cities"("p_trip" "uuid", "p_order" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_base date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

  v_base := public._trip_anchor_date(p_trip);

  update city_visits cv
    set position = x.ord - 1, updated_at = now()
  from (select id, ord from unnest(p_order) with ordinality as t(id, ord)) x
  where cv.id = x.id and cv.trip_id = p_trip;

  perform public.recompute_trip(p_trip, v_base);
end;
$$;


ALTER FUNCTION "public"."reorder_cities"("p_trip" "uuid", "p_order" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_cities_local"("p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with items as (
    select (ord - 1)::int                                    as idx,
           nullif(btrim(elem->>'name_en'), '')               as name_en,
           upper(nullif(btrim(elem->>'country_code'), ''))   as cc
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
         with ordinality as t(elem, ord)
  ),
  matched as (
    select distinct on (i.idx)
           i.idx,
           c.id, c.name_en, c.country_code, c.lat, c.lng,
           c.time_zone, c.iata_code, c.viator_dest_id, c.getyourguide_id
    from items i
    join cities c
      on i.name_en is not null
     and i.cc is not null
     and lower(unaccent(c.name_en)) = lower(unaccent(i.name_en))
     and upper(c.country_code) = i.cc
    order by i.idx,
             (c.source is distinct from 'manual') desc,
             (c.viator_dest_id is not null) desc,
             c.id
  )
  select coalesce(
    jsonb_agg(
      case when m.id is null then null else jsonb_build_object(
        'city_id',         m.id,
        'name_en',         m.name_en,
        'country_code',    m.country_code,
        'lat',             m.lat,
        'lng',             m.lng,
        'time_zone',       m.time_zone,
        'iata_code',       m.iata_code,
        'viator_dest_id',  m.viator_dest_id,
        'getyourguide_id', m.getyourguide_id
      ) end
      order by i.idx
    ),
    '[]'::jsonb
  )
  from items i
  left join matched m on m.idx = i.idx;
$$;


ALTER FUNCTION "public"."resolve_cities_local"("p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_city_id"("p_country_code" "text", "p_lat" double precision, "p_lng" double precision, "p_name_en" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_id bigint;
BEGIN
  SELECT id INTO v_id
  FROM cities
  WHERE
    -- Exclude nameless manual ghost rows (source='manual', name_en IS NULL)
    NOT (source = 'manual' AND name_en IS NULL)
    -- 30 km bounding box (fast index scan)
    AND ABS(lat - p_lat) < 0.3
    AND ABS(lng - p_lng) < 0.3
    -- Exact 30 km distance
    AND 6371 * 2 * asin(sqrt(
          power(sin(radians((lat - p_lat) / 2)), 2) +
          cos(radians(p_lat)) * cos(radians(lat)) *
          power(sin(radians((lng - p_lng) / 2)), 2)
        )) < 30
  ORDER BY
    -- 1) Exact name match (if caller passes p_name_en)
    (p_name_en IS NOT NULL AND lower(name_en) = lower(p_name_en)) DESC,
    -- 2) Same country — NULLS LAST so missing country_code never beats a real match
    (country_code = p_country_code) DESC NULLS LAST,
    -- 3) Nearest first
    6371 * 2 * asin(sqrt(
      power(sin(radians((lat - p_lat) / 2)), 2) +
      cos(radians(p_lat)) * cos(radians(lat)) *
      power(sin(radians((lng - p_lng) / 2)), 2)
    ))
  LIMIT 1;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."resolve_city_id"("p_country_code" "text", "p_lat" double precision, "p_lng" double precision, "p_name_en" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_trip_pro_addons"("p_trip_id" "uuid") RETURNS TABLE("trip_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  update public.trips t
     set details = jsonb_set(jsonb_set(jsonb_set(
             coalesce(t.details, '{}'::jsonb),
             '{addons,budget}',             'false'::jsonb, true),
             '{addons,chat}',               'false'::jsonb, true),
             '{addons,telegram_assistant}', 'false'::jsonb, true)
   where t.id = p_trip_id
     and not public.is_trip_pro(t.id)
     and (
          coalesce((t.details->'addons'->>'budget')::boolean, false)
       or coalesce((t.details->'addons'->>'chat')::boolean, false)
       or coalesce((t.details->'addons'->>'telegram_assistant')::boolean, false)
       or exists (select 1 from public.trip_telegram_integrations i where i.trip_id = t.id)
     )
  returning t.id;
end $$;


ALTER FUNCTION "public"."revoke_trip_pro_addons"("p_trip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_user_pro_addons"("p_user_id" "uuid") RETURNS TABLE("trip_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  update public.trips t
     set details = jsonb_set(jsonb_set(jsonb_set(
             coalesce(t.details, '{}'::jsonb),
             '{addons,budget}',             'false'::jsonb, true),
             '{addons,chat}',               'false'::jsonb, true),
             '{addons,telegram_assistant}', 'false'::jsonb, true)
   where t.created_by = p_user_id
     and not public.is_trip_pro(t.id)
     and (
          coalesce((t.details->'addons'->>'budget')::boolean, false)
       or coalesce((t.details->'addons'->>'chat')::boolean, false)
       or coalesce((t.details->'addons'->>'telegram_assistant')::boolean, false)
       or exists (select 1 from public.trip_telegram_integrations i where i.trip_id = t.id)
     )
  returning t.id;
end $$;


ALTER FUNCTION "public"."revoke_user_pro_addons"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_budget_on_trip"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.ensure_trip_budget(NEW.id);
  return NEW;
exception when others then
  raise warning 'seed_budget_on_trip failed: %', sqlerrm;
  return NEW;
end $$;


ALTER FUNCTION "public"."seed_budget_on_trip"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_city_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_city_id bigint;
BEGIN
  -- Resolve against the cities dimension using the new 4-arg signature
  v_city_id := resolve_city_id(
    new.country_code,
    new.latitude,
    new.longitude,
    new.city_name_en
  );

  IF v_city_id IS NOT NULL THEN
    new.city_id := v_city_id;
  ELSE
    -- Only create a manual ghost city when the insert has a non-null name
    -- (prevents nameless ghost rows that pollute the resolver).
    IF new.city_name_en IS NOT NULL THEN
      INSERT INTO cities (name_en, country_code, lat, lng, source)
      VALUES (new.city_name_en, new.country_code, new.latitude, new.longitude, 'manual')
      RETURNING id INTO v_city_id;
      new.city_id := v_city_id;
    END IF;
    -- If city_name_en is also NULL: leave city_id as whatever caller set (or NULL).
  END IF;

  RETURN new;
END;
$$;


ALTER FUNCTION "public"."set_city_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_city_nights"("p_city" "uuid", "p_nights" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_trip  uuid;
  v_kind  text;
  v_start date;
  v_n     int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select trip_id, kind, start_date into v_trip, v_kind, v_start from city_visits where id = p_city;
  if v_trip is null then raise exception 'city not found'; end if;
  if not public._can_edit_trip(v_trip, v_uid) then raise exception 'forbidden'; end if;
  if v_kind in ('start','end') then raise exception 'nights not applicable to anchor city'; end if;

  v_n := greatest(0, least(60, coalesce(p_nights, 0)));
  update city_visits
    set kind     = case when v_n = 0 then 'waypoint' else 'transit' end,
        end_date = coalesce(v_start, current_date) + v_n,
        updated_at = now()
  where id = p_city;

  perform public.recompute_trip(v_trip, null);
end;
$$;


ALTER FUNCTION "public"."set_city_nights"("p_city" "uuid", "p_nights" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_trip_start_date"("p_trip" "uuid", "p_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;
  perform public.recompute_trip(p_trip, p_date);
end;
$$;


ALTER FUNCTION "public"."set_trip_start_date"("p_trip" "uuid", "p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_budget_expense"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_kind text; v_syskey text; v_trip uuid; v_amount numeric; v_currency text;
  v_title text; v_city text; v_cat uuid; v_owner uuid; v_src uuid;
begin
  if    TG_TABLE_NAME = 'hotel_stays'   then v_kind:='hotel';    v_syskey:='accommodation';
  elsif TG_TABLE_NAME = 'transfers'     then v_kind:='transfer'; v_syskey:='transport';
  elsif TG_TABLE_NAME = 'activities'    then v_kind:='activity'; v_syskey:='activities';
  elsif TG_TABLE_NAME = 'trip_services' then v_kind:='service';  v_syskey:='services';
  else return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'DELETE' then
    delete from public.budget_expenses where source_kind = v_kind and source_id = OLD.id;
    return OLD;
  end if;

  v_trip := NEW.trip_id; v_amount := coalesce(NEW.price, 0); v_currency := NEW.currency; v_src := NEW.id;

  if    TG_TABLE_NAME = 'hotel_stays'   then v_title:=NEW.name;  select city_name into v_city from public.city_visits where id = NEW.city_visit_id;
  elsif TG_TABLE_NAME = 'transfers'     then v_title:=coalesce(NEW.carrier,'Transfer'); select city_name into v_city from public.city_visits where id = NEW.to_city_visit_id;
  elsif TG_TABLE_NAME = 'activities'    then v_title:=NEW.title; select city_name into v_city from public.city_visits where id = NEW.city_visit_id;
  elsif TG_TABLE_NAME = 'trip_services' then v_title:=NEW.name;  v_city:=null;
  end if;

  perform public.ensure_trip_budget(v_trip);
  select created_by into v_owner from public.trips where id = v_trip;
  select id into v_cat from public.budget_categories where trip_id = v_trip and system_key = v_syskey limit 1;
  if v_cat is null then
    select id into v_cat from public.budget_categories where trip_id = v_trip order by order_index limit 1;
  end if;
  if v_cat is null then return NEW; end if;

  update public.budget_expenses
     set category_id = v_cat, title = v_title, original_amount = v_amount,
         original_currency = coalesce(v_currency,'EUR'), city_name = v_city
   where source_kind = v_kind and source_id = v_src;
  if not found then
    insert into public.budget_expenses
      (trip_id, category_id, title, original_amount, original_currency, source_kind, source_id, city_name, created_by)
    values (v_trip, v_cat, v_title, v_amount, coalesce(v_currency,'EUR'), v_kind, v_src, v_city, v_owner);
  end if;

  return NEW;
exception when others then
  raise warning 'sync_budget_expense failed: %', sqlerrm;
  return coalesce(NEW, OLD);
end $$;


ALTER FUNCTION "public"."sync_budget_expense"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."take_geocode_token"("p_min" numeric DEFAULT 1, "p_rate" numeric DEFAULT 2, "p_cap" numeric DEFAULT 2) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tokens  numeric;
  v_updated timestamptz;
  v_now     timestamptz := clock_timestamp();
  v_ok      boolean := false;
begin
  insert into public.geocode_rate_bucket (id, tokens, updated_at)
  values (1, p_cap, v_now)
  on conflict (id) do nothing;

  select tokens, updated_at
    into v_tokens, v_updated
  from public.geocode_rate_bucket
  where id = 1
  for update;

  v_tokens := least(p_cap, v_tokens + extract(epoch from (v_now - v_updated)) * p_rate);

  if v_tokens >= p_min then
    v_tokens := v_tokens - 1;
    v_ok := true;
  end if;

  update public.geocode_rate_bucket
  set tokens = v_tokens, updated_at = v_now
  where id = 1;

  return v_ok;
end;
$$;


ALTER FUNCTION "public"."take_geocode_token"("p_min" numeric, "p_rate" numeric, "p_cap" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recompute_transfer"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_trip uuid;
begin
  v_trip := coalesce(NEW.trip_id, OLD.trip_id);
  if v_trip is not null then
    perform public.recompute_trip(v_trip, null);
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."trg_recompute_transfer"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "city_visit_id" "uuid" NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "start_datetime" timestamp with time zone,
    "end_datetime" timestamp with time zone,
    "location_address" "text",
    "price" numeric,
    "currency" "text" NOT NULL,
    "documents" "jsonb" DEFAULT '[]'::"jsonb",
    "notes" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "location_latitude" double precision,
    "location_longitude" double precision,
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_usage_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "process" "text" NOT NULL,
    "workflow_id" "text",
    "execution_id" "text",
    "node_name" "text",
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "operation" "text",
    "user_id" "uuid",
    "trip_id" "uuid",
    "channel" "text",
    "tag" "text",
    "tokens_input" bigint,
    "tokens_output" bigint,
    "tokens_total" bigint,
    "pages" integer,
    "requests" integer DEFAULT 1 NOT NULL,
    "metrics" "jsonb",
    "cost_usd" numeric(20,10),
    "cost_breakdown" "jsonb",
    "pricing_complete" boolean,
    "status" "text" DEFAULT 'success'::"text" NOT NULL,
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "run_index" integer
);


ALTER TABLE "public"."ai_usage_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_usage_events" IS 'One row per billable AI model call. cost_usd/cost_breakdown/pricing_complete are filled at insert by trg_ai_usage_cost from ai_model_prices.';



CREATE OR REPLACE VIEW "public"."ai_cost_by_day" WITH ("security_invoker"='on') AS
 SELECT ("date_trunc"('day'::"text", "occurred_at"))::"date" AS "day",
    "count"(*) AS "calls",
    "sum"("cost_usd") AS "cost_usd",
    "sum"("tokens_input") AS "tokens_input",
    "sum"("tokens_output") AS "tokens_output",
    "sum"("pages") AS "pages"
   FROM "public"."ai_usage_events"
  GROUP BY (("date_trunc"('day'::"text", "occurred_at"))::"date")
  ORDER BY (("date_trunc"('day'::"text", "occurred_at"))::"date") DESC;


ALTER VIEW "public"."ai_cost_by_day" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ai_cost_by_process" WITH ("security_invoker"='on') AS
 SELECT "process",
    "count"(*) AS "calls",
    "sum"("cost_usd") AS "cost_usd",
    "sum"("tokens_input") AS "tokens_input",
    "sum"("tokens_output") AS "tokens_output",
    "sum"("pages") AS "pages"
   FROM "public"."ai_usage_events"
  GROUP BY "process"
  ORDER BY ("sum"("cost_usd")) DESC NULLS LAST;


ALTER VIEW "public"."ai_cost_by_process" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ai_cost_by_run" WITH ("security_invoker"='on') AS
 SELECT "execution_id",
    "process",
    "min"("occurred_at") AS "started_at",
    "count"(*) AS "calls",
    "sum"("cost_usd") AS "cost_usd",
    "bool_and"("pricing_complete") AS "fully_priced"
   FROM "public"."ai_usage_events"
  WHERE ("execution_id" IS NOT NULL)
  GROUP BY "execution_id", "process"
  ORDER BY ("min"("occurred_at")) DESC;


ALTER VIEW "public"."ai_cost_by_run" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ai_cost_by_trip" WITH ("security_invoker"='on') AS
 SELECT "trip_id",
    "count"(*) AS "calls",
    "sum"("cost_usd") AS "cost_usd"
   FROM "public"."ai_usage_events"
  WHERE ("trip_id" IS NOT NULL)
  GROUP BY "trip_id"
  ORDER BY ("sum"("cost_usd")) DESC NULLS LAST;


ALTER VIEW "public"."ai_cost_by_trip" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ai_cost_by_user" WITH ("security_invoker"='on') AS
 SELECT "user_id",
    "count"(*) AS "calls",
    "sum"("cost_usd") AS "cost_usd"
   FROM "public"."ai_usage_events"
  WHERE ("user_id" IS NOT NULL)
  GROUP BY "user_id"
  ORDER BY ("sum"("cost_usd")) DESC NULLS LAST;


ALTER VIEW "public"."ai_cost_by_user" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."ai_cost_by_week" WITH ("security_invoker"='on') AS
 SELECT ("date_trunc"('week'::"text", "occurred_at"))::"date" AS "week_start",
    "count"(*) AS "calls",
    "sum"("cost_usd") AS "cost_usd"
   FROM "public"."ai_usage_events"
  GROUP BY (("date_trunc"('week'::"text", "occurred_at"))::"date")
  ORDER BY (("date_trunc"('week'::"text", "occurred_at"))::"date") DESC;


ALTER VIEW "public"."ai_cost_by_week" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_model_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "unit" "text" NOT NULL,
    "unit_price_usd" numeric(20,12) NOT NULL,
    "effective_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "effective_to" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_model_prices_unit_check" CHECK (("unit" = ANY (ARRAY['input_token'::"text", 'output_token'::"text", 'total_token'::"text", 'page'::"text", 'request'::"text", 'second'::"text", 'character'::"text", 'image'::"text"])))
);


ALTER TABLE "public"."ai_model_prices" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_model_prices" IS 'Versioned price book. One row per (provider, model, unit). unit_price_usd is price for ONE unit. effective_to null = currently active.';



CREATE TABLE IF NOT EXISTS "public"."budget_categories" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text" DEFAULT 'custom'::"text",
    "system_key" "text",
    "order_index" numeric DEFAULT 0,
    "icon" "text",
    "color" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid" NOT NULL,
    CONSTRAINT "budget_categories_kind_check" CHECK (("kind" = ANY (ARRAY['system'::"text", 'custom'::"text"]))),
    CONSTRAINT "budget_categories_system_key_check" CHECK ((("system_key" IS NULL) OR ("system_key" = ANY (ARRAY['accommodation'::"text", 'transport'::"text", 'activities'::"text", 'services'::"text", 'food'::"text"]))))
);


ALTER TABLE "public"."budget_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budget_expenses" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "original_amount" numeric,
    "original_currency" "text",
    "spent_on" "date",
    "source_kind" "text" DEFAULT 'manual'::"text",
    "source_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid" NOT NULL,
    "city_name" "text",
    "notes" "text",
    CONSTRAINT "budget_expenses_source_kind_check" CHECK (("source_kind" = ANY (ARRAY['manual'::"text", 'hotel'::"text", 'transfer'::"text", 'activity'::"text", 'service'::"text"])))
);


ALTER TABLE "public"."budget_expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "user_full_name" "text",
    "text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "chat_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL
);

ALTER TABLE ONLY "public"."chat_messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_reads" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "chat_id" "uuid",
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."chat_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'group'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cities" (
    "id" bigint NOT NULL,
    "name_en" "text",
    "country_code" "text",
    "lat" double precision,
    "lng" double precision,
    "time_zone" "text",
    "iata_code" "text",
    "viator_dest_id" "text",
    "getyourguide_id" "text",
    "source" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cities" OWNER TO "postgres";


ALTER TABLE "public"."cities" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cities_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."city_visits" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "external_city_id" "text",
    "city_name" "text" NOT NULL,
    "country" "text",
    "country_code" "text",
    "latitude" numeric,
    "longitude" numeric,
    "timezone" "text",
    "start_date" "date",
    "end_date" "date",
    "kind" "text" DEFAULT 'transit'::"text",
    "notes" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid" NOT NULL,
    "position" integer,
    "city_name_en" "text",
    "city_id" bigint,
    CONSTRAINT "city_visits_kind_check" CHECK (("kind" = ANY (ARRAY['transit'::"text", 'start'::"text", 'end'::"text", 'waypoint'::"text"])))
);


ALTER TABLE "public"."city_visits" OWNER TO "postgres";


COMMENT ON COLUMN "public"."city_visits"."position" IS 'Auto-maintained order tie-breaker, subordinate to start_datetime. Sort nodes everywhere by (start_datetime, position). Disambiguates nodes sharing a day (incl. future kind=waypoint). Must never contradict chronology.';



CREATE TABLE IF NOT EXISTS "public"."fx_rates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "base" "text" NOT NULL,
    "rates" "jsonb" NOT NULL,
    "fetched_at" timestamp with time zone,
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."fx_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."geocode_cache" (
    "id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "query_key" "text" NOT NULL,
    "lang" "text" NOT NULL,
    "results" "jsonb" NOT NULL,
    "hit_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."geocode_cache" OWNER TO "postgres";


ALTER TABLE "public"."geocode_cache" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."geocode_cache_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."geocode_queue" (
    "id" bigint NOT NULL,
    "priority" integer NOT NULL,
    "enqueued_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."geocode_queue" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."geocode_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."geocode_queue_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."geocode_queue_id_seq" OWNED BY "public"."geocode_queue"."id";



CREATE TABLE IF NOT EXISTS "public"."geocode_rate_bucket" (
    "id" integer DEFAULT 1 NOT NULL,
    "tokens" numeric DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "geocode_rate_bucket_singleton" CHECK (("id" = 1))
);


ALTER TABLE "public"."geocode_rate_bucket" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hotel_stays" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "city_visit_id" "uuid" NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "check_in_datetime" timestamp with time zone,
    "check_out_datetime" timestamp with time zone,
    "booking_reference" "text",
    "payment_status" "text",
    "price" numeric,
    "currency" "text" NOT NULL,
    "free_cancellation" boolean DEFAULT false,
    "free_cancellation_until" timestamp with time zone,
    "phone" "text",
    "email" "text",
    "booking_url" "text",
    "documents" "jsonb" DEFAULT '[]'::"jsonb",
    "notes" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "latitude" double precision,
    "longitude" double precision,
    "created_by" "uuid" NOT NULL,
    CONSTRAINT "hotel_stays_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['paid'::"text", 'partial'::"text", 'pay_on_arrival'::"text"])))
);


ALTER TABLE "public"."hotel_stays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."n8n_chat_histories" (
    "id" integer NOT NULL,
    "session_id" character varying(255) NOT NULL,
    "message" "jsonb" NOT NULL
);


ALTER TABLE "public"."n8n_chat_histories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."n8n_chat_histories_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."n8n_chat_histories_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."n8n_chat_histories_id_seq" OWNED BY "public"."n8n_chat_histories"."id";



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "type" "text" DEFAULT 'system'::"text",
    "title" "text",
    "message" "text",
    "i18n_title_key" "text",
    "i18n_message_key" "text",
    "i18n_params" "jsonb" DEFAULT '{}'::"jsonb",
    "trip_id" "uuid",
    "trip_member_id" "uuid",
    "read" boolean DEFAULT false,
    "action_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "user_id" "uuid",
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['trip_invite'::"text", 'trip_update'::"text", 'trip_member_joined'::"text", 'system'::"text", 'pro_activated'::"text", 'trip_invite_declined'::"text", 'trip_member_left'::"text", 'trip_member_removed'::"text", 'trip_role_changed'::"text", 'trip_booking_added'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partner_clicks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "trip_id" "uuid",
    "partner" "text" NOT NULL,
    "type" "text",
    "link" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "provider" "text",
    CONSTRAINT "partner_clicks_type_check" CHECK (("type" = ANY (ARRAY['transfer'::"text", 'hotel'::"text", 'esim'::"text", 'carrental'::"text", 'insurance'::"text", 'activity'::"text"])))
);


ALTER TABLE "public"."partner_clicks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."password_reset_attempts" (
    "id" bigint NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."password_reset_attempts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."password_reset_attempts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."password_reset_attempts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."password_reset_attempts_id_seq" OWNED BY "public"."password_reset_attempts"."id";



CREATE TABLE IF NOT EXISTS "public"."stripe_events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stripe_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telegram_link_tokens" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "token" "text" NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."telegram_link_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telegram_reminder_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_kind" "text",
    "event_id" "uuid" NOT NULL,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "telegram_reminder_logs_event_kind_check" CHECK (("event_kind" = ANY (ARRAY['hotel_cancel_deadline'::"text", 'hotel_checkin'::"text", 'hotel_checkout'::"text", 'transfer_start'::"text", 'car_rental_start'::"text", 'car_rental_end'::"text", 'car_rental_pickup'::"text", 'car_rental_dropoff'::"text", 'activity_start'::"text"])))
);


ALTER TABLE "public"."telegram_reminder_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transfers" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "from_city_visit_id" "uuid",
    "to_city_visit_id" "uuid",
    "transport_type" "text" DEFAULT 'plane'::"text",
    "start_datetime" timestamp with time zone,
    "end_datetime" timestamp with time zone,
    "carrier" "text",
    "booking_reference" "text",
    "booking_url" "text",
    "from_address" "text",
    "to_address" "text",
    "price" numeric,
    "currency" "text" NOT NULL,
    "documents" "jsonb" DEFAULT '[]'::"jsonb",
    "notes" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "from_latitude" double precision,
    "from_longitude" double precision,
    "to_latitude" double precision,
    "to_longitude" double precision,
    "flight_number" "text",
    "created_by" "uuid" NOT NULL,
    "day_change" boolean DEFAULT false NOT NULL,
    CONSTRAINT "transfers_transport_type_check" CHECK (("transport_type" = ANY (ARRAY['plane'::"text", 'train'::"text", 'bus'::"text", 'car'::"text", 'taxi'::"text", 'ferry'::"text", 'walk'::"text", 'own_transport'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."transfers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trip_budgets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "currency" "text" NOT NULL,
    "fx_overrides" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."trip_budgets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trip_documents" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "visibility" "text" DEFAULT 'shared'::"text",
    "notes" "text",
    "file_url" "text",
    "file_name" "text",
    "documents" "jsonb" DEFAULT '[]'::"jsonb",
    "link_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid" NOT NULL,
    "created_by_name" "text",
    CONSTRAINT "trip_documents_visibility_check" CHECK (("visibility" = ANY (ARRAY['shared'::"text", 'private'::"text"])))
);


ALTER TABLE "public"."trip_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trip_invite_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trip_invite_links_role_check" CHECK (("role" = ANY (ARRAY['viewer'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."trip_invite_links" OWNER TO "postgres";


COMMENT ON TABLE "public"."trip_invite_links" IS 'Shareable trip invite links. Each row binds an opaque token to a trip + role + expiry. Only edge functions (service role) read/write this table; redeeming adds the caller to trip_members with the stored role. RLS is enabled with no policies on purpose: the anon/auth roles have no direct access.';



CREATE TABLE IF NOT EXISTS "public"."trip_member_blocks" (
    "trip_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "blocked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "blocked_by" "uuid"
);


ALTER TABLE "public"."trip_member_blocks" OWNER TO "postgres";


COMMENT ON TABLE "public"."trip_member_blocks" IS 'Per-trip block list. When an admin removes a member, the (trip,user) pair is recorded here so redeemTripInviteLink refuses to re-add them via an invite link. Cleared when the user is explicitly re-invited (pending invite) or re-joins. Only edge functions (service role) touch this table.';



CREATE TABLE IF NOT EXISTS "public"."trip_members" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "invite_email" "text",
    "user_full_name" "text",
    "role" "text" DEFAULT 'viewer'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "user_id" "uuid",
    "invited_by" "uuid",
    CONSTRAINT "trip_members_role_check" CHECK (("role" = ANY (ARRAY['viewer'::"text", 'admin'::"text", 'owner'::"text"]))),
    CONSTRAINT "trip_members_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'declined'::"text", 'offline'::"text"])))
);


ALTER TABLE "public"."trip_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trip_services" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "kind" "text",
    "name" "text" NOT NULL,
    "price" numeric,
    "currency" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "pickup_datetime" timestamp with time zone,
    "dropoff_datetime" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    CONSTRAINT "trip_services_kind_check" CHECK (("kind" = ANY (ARRAY['esim'::"text", 'car_rental'::"text", 'insurance'::"text"])))
);


ALTER TABLE "public"."trip_services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trip_subscriptions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid",
    "type" "text",
    "stripe_subscription_id" "text",
    "stripe_checkout_id" "text",
    "stripe_payment_intent_id" "text",
    "status" "text" DEFAULT 'active'::"text",
    "start_date" timestamp with time zone,
    "end_date" timestamp with time zone,
    "amount_paid" numeric,
    "currency" "text" DEFAULT 'usd'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "user_id" "uuid",
    "provider" "text" DEFAULT 'stripe'::"text" NOT NULL,
    "platform" "text" DEFAULT 'web'::"text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "provider_meta" "jsonb",
    CONSTRAINT "trip_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'past_due'::"text", 'canceled'::"text", 'unpaid'::"text", 'incomplete'::"text", 'incomplete_expired'::"text", 'paused'::"text", 'refunded'::"text", 'disputed'::"text", 'cancelled'::"text", 'expired'::"text"]))),
    CONSTRAINT "trip_subscriptions_type_check" CHECK (("type" = ANY (ARRAY['pro_trip'::"text", 'pro_monthly'::"text", 'pro_yearly'::"text"])))
);


ALTER TABLE "public"."trip_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trip_telegram_integrations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "trip_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "telegram_chat_id" "text" NOT NULL,
    "telegram_username" "text",
    "telegram_first_name" "text",
    "is_active" boolean DEFAULT true,
    "linked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."trip_telegram_integrations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."trip_telegram_integrations"."user_id" IS 'linked_by: kto iniciiroval privyazku. NE chast identichnosti; identichnost = (trip_id, telegram_chat_id). Nullable + ON DELETE SET NULL.';



CREATE TABLE IF NOT EXISTS "public"."trips" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "cover_image_url" "text",
    "notes" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "is_pro_trip" boolean DEFAULT false,
    "share_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "cover_gradient" "text" DEFAULT 'gradient_1'::"text",
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."trips" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_custom_visits" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "city_name" "text" NOT NULL,
    "country_code" "text",
    "lat" double precision,
    "lng" double precision,
    "start_date" "date",
    "end_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_custom_visits" OWNER TO "postgres";


ALTER TABLE "public"."user_custom_visits" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."user_custom_visits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "language" "text" DEFAULT 'ru'::"text",
    "theme" "text" DEFAULT 'system'::"text",
    "notify_email_invites" boolean DEFAULT true,
    "notify_email_updates" boolean DEFAULT true,
    "subscription_status" "text" DEFAULT 'free'::"text",
    "subscription_end_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "stripe_customer_id" "text",
    "entitlement_synced_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "unit_system" "text" DEFAULT 'metric'::"text" NOT NULL,
    CONSTRAINT "users_language_check" CHECK (("language" = ANY (ARRAY['ru'::"text", 'en'::"text", 'es'::"text"]))),
    CONSTRAINT "users_subscription_status_check" CHECK (("subscription_status" = ANY (ARRAY['free'::"text", 'pro'::"text"]))),
    CONSTRAINT "users_theme_check" CHECK (("theme" = ANY (ARRAY['light'::"text", 'dark'::"text", 'system'::"text"]))),
    CONSTRAINT "users_unit_system_check" CHECK (("unit_system" = ANY (ARRAY['metric'::"text", 'imperial'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."geocode_queue" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."geocode_queue_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."n8n_chat_histories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."n8n_chat_histories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."password_reset_attempts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."password_reset_attempts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_model_prices"
    ADD CONSTRAINT "ai_model_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_usage_events"
    ADD CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budget_categories"
    ADD CONSTRAINT "budget_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budget_expenses"
    ADD CONSTRAINT "budget_expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_reads"
    ADD CONSTRAINT "chat_reads_chat_user_key" UNIQUE ("chat_id", "user_id");



ALTER TABLE ONLY "public"."chat_reads"
    ADD CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chats"
    ADD CONSTRAINT "chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."city_visits"
    ADD CONSTRAINT "city_visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fx_rates"
    ADD CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."geocode_cache"
    ADD CONSTRAINT "geocode_cache_action_query_lang_key" UNIQUE ("action", "query_key", "lang");



ALTER TABLE ONLY "public"."geocode_cache"
    ADD CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."geocode_queue"
    ADD CONSTRAINT "geocode_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."geocode_rate_bucket"
    ADD CONSTRAINT "geocode_rate_bucket_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hotel_stays"
    ADD CONSTRAINT "hotel_stays_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."n8n_chat_histories"
    ADD CONSTRAINT "n8n_chat_histories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_clicks"
    ADD CONSTRAINT "partner_clicks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."password_reset_attempts"
    ADD CONSTRAINT "password_reset_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_events"
    ADD CONSTRAINT "stripe_events_event_id_key" UNIQUE ("event_id");



ALTER TABLE ONLY "public"."stripe_events"
    ADD CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telegram_link_tokens"
    ADD CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telegram_link_tokens"
    ADD CONSTRAINT "telegram_link_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."telegram_reminder_logs"
    ADD CONSTRAINT "telegram_reminder_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_budgets"
    ADD CONSTRAINT "trip_budgets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_documents"
    ADD CONSTRAINT "trip_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_invite_links"
    ADD CONSTRAINT "trip_invite_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_invite_links"
    ADD CONSTRAINT "trip_invite_links_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."trip_member_blocks"
    ADD CONSTRAINT "trip_member_blocks_pkey" PRIMARY KEY ("trip_id", "user_id");



ALTER TABLE ONLY "public"."trip_members"
    ADD CONSTRAINT "trip_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_services"
    ADD CONSTRAINT "trip_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_subscriptions"
    ADD CONSTRAINT "trip_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_telegram_integrations"
    ADD CONSTRAINT "trip_telegram_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_telegram_integrations"
    ADD CONSTRAINT "trip_telegram_integrations_trip_chat_uniq" UNIQUE ("trip_id", "telegram_chat_id");



ALTER TABLE ONLY "public"."trips"
    ADD CONSTRAINT "trips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_custom_visits"
    ADD CONSTRAINT "user_custom_visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "ai_model_prices_lookup_idx" ON "public"."ai_model_prices" USING "btree" ("provider", "model", "unit", "effective_from" DESC);



CREATE INDEX "ai_usage_events_execution_idx" ON "public"."ai_usage_events" USING "btree" ("execution_id");



CREATE INDEX "ai_usage_events_model_idx" ON "public"."ai_usage_events" USING "btree" ("provider", "model");



CREATE INDEX "ai_usage_events_occurred_idx" ON "public"."ai_usage_events" USING "btree" ("occurred_at");



CREATE INDEX "ai_usage_events_process_idx" ON "public"."ai_usage_events" USING "btree" ("process", "occurred_at");



CREATE INDEX "ai_usage_events_trip_idx" ON "public"."ai_usage_events" USING "btree" ("trip_id");



CREATE INDEX "ai_usage_events_user_idx" ON "public"."ai_usage_events" USING "btree" ("user_id");



CREATE INDEX "chat_messages_chat_id_idx" ON "public"."chat_messages" USING "btree" ("chat_id", "created_at");



CREATE UNIQUE INDEX "chats_trip_group_idx" ON "public"."chats" USING "btree" ("trip_id") WHERE ("type" = 'group'::"text");



CREATE INDEX "cities_iata_idx" ON "public"."cities" USING "btree" ("iata_code") WHERE ("iata_code" IS NOT NULL);



CREATE INDEX "cities_lat_idx" ON "public"."cities" USING "btree" ("lat");



CREATE INDEX "cities_lng_idx" ON "public"."cities" USING "btree" ("lng");



CREATE INDEX "cities_name_cc_idx" ON "public"."cities" USING "btree" ("lower"("name_en"), "country_code");



CREATE INDEX "cities_viator_idx" ON "public"."cities" USING "btree" ("viator_dest_id") WHERE ("viator_dest_id" IS NOT NULL);



CREATE INDEX "city_visits_city_id_idx" ON "public"."city_visits" USING "btree" ("city_id");



CREATE INDEX "geocode_queue_order_idx" ON "public"."geocode_queue" USING "btree" ("priority", "id");



CREATE INDEX "idx_activities_city_visit_id" ON "public"."activities" USING "btree" ("city_visit_id");



CREATE INDEX "idx_activities_start" ON "public"."activities" USING "btree" ("start_datetime");



CREATE INDEX "idx_activities_trip_id" ON "public"."activities" USING "btree" ("trip_id");



CREATE INDEX "idx_budget_categories_trip_id" ON "public"."budget_categories" USING "btree" ("trip_id");



CREATE INDEX "idx_budget_expenses_trip_id" ON "public"."budget_expenses" USING "btree" ("trip_id");



CREATE INDEX "idx_chat_messages_trip_id" ON "public"."chat_messages" USING "btree" ("trip_id");



CREATE INDEX "idx_city_visits_trip_id" ON "public"."city_visits" USING "btree" ("trip_id");



CREATE INDEX "idx_hotel_stays_cancellation" ON "public"."hotel_stays" USING "btree" ("free_cancellation_until") WHERE ("free_cancellation" = true);



CREATE INDEX "idx_hotel_stays_checkin" ON "public"."hotel_stays" USING "btree" ("check_in_datetime");



CREATE INDEX "idx_hotel_stays_checkout" ON "public"."hotel_stays" USING "btree" ("check_out_datetime");



CREATE INDEX "idx_hotel_stays_city_visit_id" ON "public"."hotel_stays" USING "btree" ("city_visit_id");



CREATE INDEX "idx_hotel_stays_trip_id" ON "public"."hotel_stays" USING "btree" ("trip_id");



CREATE INDEX "idx_pwd_reset_attempts_email_time" ON "public"."password_reset_attempts" USING "btree" ("lower"("email"), "created_at" DESC);



CREATE UNIQUE INDEX "idx_reminder_logs_dedup" ON "public"."telegram_reminder_logs" USING "btree" ("user_id", "event_kind", "event_id");



CREATE INDEX "idx_transfers_start" ON "public"."transfers" USING "btree" ("start_datetime");



CREATE INDEX "idx_transfers_trip_id" ON "public"."transfers" USING "btree" ("trip_id");



CREATE INDEX "idx_trip_budgets_trip_id" ON "public"."trip_budgets" USING "btree" ("trip_id");



CREATE INDEX "idx_trip_documents_trip_id" ON "public"."trip_documents" USING "btree" ("trip_id");



CREATE INDEX "idx_trip_members_trip_id" ON "public"."trip_members" USING "btree" ("trip_id");



CREATE INDEX "idx_trip_members_user_email" ON "public"."trip_members" USING "btree" ("invite_email");



CREATE INDEX "idx_trip_services_trip_id" ON "public"."trip_services" USING "btree" ("trip_id");



CREATE INDEX "idx_tti_active_trip" ON "public"."trip_telegram_integrations" USING "btree" ("trip_id", "is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_users_stripe_customer" ON "public"."users" USING "btree" ("stripe_customer_id");



CREATE INDEX "trip_invite_links_trip_id_idx" ON "public"."trip_invite_links" USING "btree" ("trip_id");



CREATE INDEX "trip_invite_links_trip_role_live_idx" ON "public"."trip_invite_links" USING "btree" ("trip_id", "role") WHERE ("revoked_at" IS NULL);



CREATE UNIQUE INDEX "uq_trip_subs_checkout" ON "public"."trip_subscriptions" USING "btree" ("stripe_checkout_id");



CREATE UNIQUE INDEX "uq_trip_subs_subscription" ON "public"."trip_subscriptions" USING "btree" ("stripe_subscription_id");



CREATE INDEX "user_custom_visits_user_idx" ON "public"."user_custom_visits" USING "btree" ("user_id");



CREATE UNIQUE INDEX "ux_ai_usage_dedup" ON "public"."ai_usage_events" USING "btree" ("execution_id", "node_name", "run_index");



CREATE OR REPLACE TRIGGER "trg_ai_usage_cost" BEFORE INSERT OR UPDATE ON "public"."ai_usage_events" FOR EACH ROW EXECUTE FUNCTION "public"."compute_ai_usage_cost"();



CREATE OR REPLACE TRIGGER "trg_city_visits_city" BEFORE INSERT OR UPDATE OF "latitude", "longitude", "city_name_en", "country_code" ON "public"."city_visits" FOR EACH ROW EXECUTE FUNCTION "public"."set_city_id"();



CREATE OR REPLACE TRIGGER "trg_link_pending_invites" AFTER INSERT ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."link_pending_invites"();



CREATE OR REPLACE TRIGGER "trg_notify_booking_added" AFTER INSERT ON "public"."hotel_stays" REFERENCING NEW TABLE AS "newrows" FOR EACH STATEMENT EXECUTE FUNCTION "public"."notify_booking_added"('hotel');



CREATE OR REPLACE TRIGGER "trg_notify_booking_added" AFTER INSERT ON "public"."transfers" REFERENCING NEW TABLE AS "newrows" FOR EACH STATEMENT EXECUTE FUNCTION "public"."notify_booking_added"('transfer');



CREATE OR REPLACE TRIGGER "trg_notify_booking_added" AFTER INSERT ON "public"."trip_services" REFERENCING NEW TABLE AS "newrows" FOR EACH STATEMENT EXECUTE FUNCTION "public"."notify_booking_added"('service');



CREATE OR REPLACE TRIGGER "trg_recompute_on_transfer_ins_del" AFTER INSERT OR DELETE ON "public"."transfers" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recompute_transfer"();



CREATE OR REPLACE TRIGGER "trg_recompute_on_transfer_upd" AFTER UPDATE ON "public"."transfers" FOR EACH ROW WHEN ((("old"."day_change" IS DISTINCT FROM "new"."day_change") OR ("old"."from_city_visit_id" IS DISTINCT FROM "new"."from_city_visit_id") OR ("old"."to_city_visit_id" IS DISTINCT FROM "new"."to_city_visit_id") OR ("old"."start_datetime" IS DISTINCT FROM "new"."start_datetime"))) EXECUTE FUNCTION "public"."trg_recompute_transfer"();



CREATE OR REPLACE TRIGGER "trg_seed_budget_on_trip" AFTER INSERT ON "public"."trips" FOR EACH ROW EXECUTE FUNCTION "public"."seed_budget_on_trip"();



CREATE OR REPLACE TRIGGER "trg_sync_budget_activity" AFTER INSERT OR DELETE OR UPDATE ON "public"."activities" FOR EACH ROW EXECUTE FUNCTION "public"."sync_budget_expense"();



CREATE OR REPLACE TRIGGER "trg_sync_budget_hotel" AFTER INSERT OR DELETE OR UPDATE ON "public"."hotel_stays" FOR EACH ROW EXECUTE FUNCTION "public"."sync_budget_expense"();



CREATE OR REPLACE TRIGGER "trg_sync_budget_service" AFTER INSERT OR DELETE OR UPDATE ON "public"."trip_services" FOR EACH ROW EXECUTE FUNCTION "public"."sync_budget_expense"();



CREATE OR REPLACE TRIGGER "trg_sync_budget_transfer" AFTER INSERT OR DELETE OR UPDATE ON "public"."transfers" FOR EACH ROW EXECUTE FUNCTION "public"."sync_budget_expense"();



CREATE OR REPLACE TRIGGER "trips_create_group_chat" AFTER INSERT ON "public"."trips" FOR EACH ROW EXECUTE FUNCTION "public"."create_group_chat_for_trip"();



CREATE OR REPLACE TRIGGER "trips_enforce_limit" BEFORE INSERT ON "public"."trips" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_trip_limit"();



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_city_visit_id_fkey" FOREIGN KEY ("city_visit_id") REFERENCES "public"."city_visits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_categories"
    ADD CONSTRAINT "budget_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."budget_categories"
    ADD CONSTRAINT "budget_categories_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_expenses"
    ADD CONSTRAINT "budget_expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_expenses"
    ADD CONSTRAINT "budget_expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."budget_expenses"
    ADD CONSTRAINT "budget_expenses_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."chat_reads"
    ADD CONSTRAINT "chat_reads_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_reads"
    ADD CONSTRAINT "chat_reads_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_reads"
    ADD CONSTRAINT "chat_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."chats"
    ADD CONSTRAINT "chats_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."city_visits"
    ADD CONSTRAINT "city_visits_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id");



ALTER TABLE ONLY "public"."city_visits"
    ADD CONSTRAINT "city_visits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."city_visits"
    ADD CONSTRAINT "city_visits_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hotel_stays"
    ADD CONSTRAINT "hotel_stays_city_visit_id_fkey" FOREIGN KEY ("city_visit_id") REFERENCES "public"."city_visits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hotel_stays"
    ADD CONSTRAINT "hotel_stays_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."hotel_stays"
    ADD CONSTRAINT "hotel_stays_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_trip_member_id_fkey" FOREIGN KEY ("trip_member_id") REFERENCES "public"."trip_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."partner_clicks"
    ADD CONSTRAINT "partner_clicks_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_clicks"
    ADD CONSTRAINT "partner_clicks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."telegram_link_tokens"
    ADD CONSTRAINT "telegram_link_tokens_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."telegram_link_tokens"
    ADD CONSTRAINT "telegram_link_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."telegram_reminder_logs"
    ADD CONSTRAINT "telegram_reminder_logs_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."telegram_reminder_logs"
    ADD CONSTRAINT "telegram_reminder_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_from_city_visit_id_fkey" FOREIGN KEY ("from_city_visit_id") REFERENCES "public"."city_visits"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_to_city_visit_id_fkey" FOREIGN KEY ("to_city_visit_id") REFERENCES "public"."city_visits"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_budgets"
    ADD CONSTRAINT "trip_budgets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."trip_budgets"
    ADD CONSTRAINT "trip_budgets_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_documents"
    ADD CONSTRAINT "trip_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."trip_documents"
    ADD CONSTRAINT "trip_documents_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_invite_links"
    ADD CONSTRAINT "trip_invite_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_invite_links"
    ADD CONSTRAINT "trip_invite_links_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_member_blocks"
    ADD CONSTRAINT "trip_member_blocks_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_member_blocks"
    ADD CONSTRAINT "trip_member_blocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_members"
    ADD CONSTRAINT "trip_members_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."trip_members"
    ADD CONSTRAINT "trip_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."trip_members"
    ADD CONSTRAINT "trip_members_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_members"
    ADD CONSTRAINT "trip_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."trip_services"
    ADD CONSTRAINT "trip_services_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."trip_services"
    ADD CONSTRAINT "trip_services_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_subscriptions"
    ADD CONSTRAINT "trip_subscriptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."trip_subscriptions"
    ADD CONSTRAINT "trip_subscriptions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trip_subscriptions"
    ADD CONSTRAINT "trip_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."trip_telegram_integrations"
    ADD CONSTRAINT "trip_telegram_integrations_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_telegram_integrations"
    ADD CONSTRAINT "trip_telegram_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trips"
    ADD CONSTRAINT "trips_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."user_custom_visits"
    ADD CONSTRAINT "user_custom_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."activities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activities_all" ON "public"."activities" USING ("public"."is_trip_participant"("trip_id")) WITH CHECK ("public"."is_trip_participant"("trip_id"));



ALTER TABLE "public"."ai_model_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_usage_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budget_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "budget_categories_all" ON "public"."budget_categories" USING ("public"."is_trip_participant"("trip_id")) WITH CHECK ("public"."is_trip_participant"("trip_id"));



ALTER TABLE "public"."budget_expenses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "budget_expenses_all" ON "public"."budget_expenses" USING ("public"."is_trip_participant"("trip_id")) WITH CHECK ("public"."is_trip_participant"("trip_id"));



ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_messages_delete" ON "public"."chat_messages" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "chat_messages_insert" ON "public"."chat_messages" FOR INSERT WITH CHECK ("public"."is_trip_participant"("trip_id"));



CREATE POLICY "chat_messages_select" ON "public"."chat_messages" FOR SELECT USING ("public"."is_trip_participant"("trip_id"));



CREATE POLICY "chat_messages_update" ON "public"."chat_messages" FOR UPDATE USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."chat_reads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_reads_own" ON "public"."chat_reads" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."chats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chats_select_for_trip_members" ON "public"."chats" FOR SELECT USING (("trip_id" IN ( SELECT "trips"."id"
   FROM "public"."trips"
  WHERE ("trips"."created_by" = "auth"."uid"())
UNION
 SELECT "trip_members"."trip_id"
   FROM "public"."trip_members"
  WHERE (("trip_members"."user_id" = "auth"."uid"()) AND ("trip_members"."status" = 'active'::"text")))));



ALTER TABLE "public"."cities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cities_read" ON "public"."cities" FOR SELECT USING (true);



ALTER TABLE "public"."city_visits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "city_visits_all" ON "public"."city_visits" USING ("public"."is_trip_participant"("trip_id")) WITH CHECK ("public"."is_trip_participant"("trip_id"));



ALTER TABLE "public"."fx_rates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fx_rates_select" ON "public"."fx_rates" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."geocode_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."geocode_rate_bucket" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hotel_stays" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "hotel_stays_all" ON "public"."hotel_stays" USING ("public"."is_trip_participant"("trip_id")) WITH CHECK ("public"."is_trip_participant"("trip_id"));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_delete" ON "public"."notifications" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_select" ON "public"."notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_update" ON "public"."notifications" FOR UPDATE USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."partner_clicks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partner_clicks_insert" ON "public"."partner_clicks" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("user_id" = "auth"."uid"())));



CREATE POLICY "partner_clicks_select" ON "public"."partner_clicks" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."password_reset_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."telegram_link_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "telegram_link_tokens_own" ON "public"."telegram_link_tokens" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."telegram_reminder_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transfers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transfers_all" ON "public"."transfers" USING ("public"."is_trip_participant"("trip_id")) WITH CHECK ("public"."is_trip_participant"("trip_id"));



ALTER TABLE "public"."trip_budgets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trip_budgets_all" ON "public"."trip_budgets" USING ("public"."is_trip_participant"("trip_id")) WITH CHECK ("public"."is_trip_participant"("trip_id"));



ALTER TABLE "public"."trip_documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trip_documents_all" ON "public"."trip_documents" USING ("public"."is_trip_participant"("trip_id")) WITH CHECK ("public"."is_trip_participant"("trip_id"));



ALTER TABLE "public"."trip_invite_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trip_member_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trip_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trip_members_delete" ON "public"."trip_members" FOR DELETE USING (("public"."is_trip_creator"("trip_id") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "trip_members_insert" ON "public"."trip_members" FOR INSERT WITH CHECK ("public"."is_trip_creator"("trip_id"));



CREATE POLICY "trip_members_select" ON "public"."trip_members" FOR SELECT USING ("public"."is_trip_participant"("trip_id"));



CREATE POLICY "trip_members_select_own" ON "public"."trip_members" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "trip_members_update" ON "public"."trip_members" FOR UPDATE USING (("public"."is_trip_creator"("trip_id") OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."trip_services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trip_services_all" ON "public"."trip_services" USING ("public"."is_trip_participant"("trip_id")) WITH CHECK ("public"."is_trip_participant"("trip_id"));



ALTER TABLE "public"."trip_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trip_subscriptions_select" ON "public"."trip_subscriptions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_trip_participant"("trip_id")));



ALTER TABLE "public"."trip_telegram_integrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trip_telegram_integrations_select" ON "public"."trip_telegram_integrations" FOR SELECT USING ("public"."is_trip_participant"("trip_id"));



CREATE POLICY "trip_telegram_integrations_write" ON "public"."trip_telegram_integrations" USING ((("user_id" = "auth"."uid"()) AND "public"."is_trip_participant"("trip_id"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_trip_participant"("trip_id")));



ALTER TABLE "public"."trips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trips_delete" ON "public"."trips" FOR DELETE USING (("created_by" = "auth"."uid"()));



CREATE POLICY "trips_select" ON "public"."trips" FOR SELECT USING ("public"."is_trip_participant"("id"));



CREATE POLICY "trips_update" ON "public"."trips" FOR UPDATE USING (("created_by" = "auth"."uid"()));



CREATE POLICY "ucv_delete" ON "public"."user_custom_visits" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "ucv_insert" ON "public"."user_custom_visits" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "ucv_select" ON "public"."user_custom_visits" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "ucv_update" ON "public"."user_custom_visits" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_custom_visits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_delete_own" ON "public"."users" FOR DELETE USING (("id" = "auth"."uid"()));



CREATE POLICY "users_insert_own" ON "public"."users" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "users_select_own" ON "public"."users" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "users_update_own" ON "public"."users" FOR UPDATE USING (("id" = "auth"."uid"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_messages";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."_can_edit_trip"("p_trip" "uuid", "p_uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_can_edit_trip"("p_trip" "uuid", "p_uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_can_edit_trip"("p_trip" "uuid", "p_uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_trip_anchor_date"("p_trip" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_trip_anchor_date"("p_trip" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."active_owned_trips"("p_uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."active_owned_trips"("p_uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_city"("p_trip" "uuid", "p_city" "jsonb", "p_index" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_city"("p_trip" "uuid", "p_city" "jsonb", "p_index" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_city"("p_trip" "uuid", "p_city" "jsonb", "p_index" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_layover_transfer"("p_trip" "uuid", "p_from" "uuid", "p_to" "uuid", "p_waypoints" "jsonb", "p_segments" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_layover_transfer"("p_trip" "uuid", "p_from" "uuid", "p_to" "uuid", "p_waypoints" "jsonb", "p_segments" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_layover_transfer"("p_trip" "uuid", "p_from" "uuid", "p_to" "uuid", "p_waypoints" "jsonb", "p_segments" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."anonymize_my_account"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."anonymize_my_account"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_viator_reassign"("p_updates" "jsonb", "p_inserts" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_viator_reassign"("p_updates" "jsonb", "p_inserts" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."auth_email_status"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auth_email_status"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_ai_usage_cost"() TO "anon";
GRANT ALL ON FUNCTION "public"."compute_ai_usage_cost"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_ai_usage_cost"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_active_owned_trips"("p_uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_active_owned_trips"("p_uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_group_chat_for_trip"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_group_chat_for_trip"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_group_chat_for_trip"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_trip"("p_title" "text", "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_trip"("p_title" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_trip"("p_title" "text", "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."daitch_mokotoff"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."daitch_mokotoff"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."daitch_mokotoff"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."daitch_mokotoff"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."difference"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."difference"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."difference"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."difference"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."dmetaphone"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."dmetaphone"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."dmetaphone"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dmetaphone"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."dmetaphone_alt"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."dmetaphone_alt"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."dmetaphone_alt"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dmetaphone_alt"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_trip_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_trip_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_trip_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_trip_budget"("p_trip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_trip_budget"("p_trip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_trip_budget"("p_trip_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."geocode_dequeue"("p_ticket" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."geocode_dequeue"("p_ticket" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geocode_dequeue"("p_ticket" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."geocode_enqueue"("p_priority" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."geocode_enqueue"("p_priority" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geocode_enqueue"("p_priority" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."geocode_serve_fair"("p_ticket" bigint, "p_min" numeric, "p_rate" numeric, "p_cap" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."geocode_serve_fair"("p_ticket" bigint, "p_min" numeric, "p_rate" numeric, "p_cap" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geocode_serve_fair"("p_ticket" bigint, "p_min" numeric, "p_rate" numeric, "p_cap" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_ai_usage_cursor"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_ai_usage_cursor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_ai_usage_cursor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_pending_reminders"("window_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_pending_reminders"("window_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pending_reminders"("window_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trip_owner_profiles"("trip_id_list" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_trip_owner_profiles"("trip_id_list" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trip_owner_profiles"("trip_id_list" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trip_participant_profiles"("trip_id_list" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_trip_participant_profiles"("trip_id_list" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trip_participant_profiles"("trip_id_list" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trips_activity_tomorrow"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_trips_activity_tomorrow"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trips_activity_tomorrow"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trips_car_dropoff_tomorrow"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_trips_car_dropoff_tomorrow"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trips_car_dropoff_tomorrow"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trips_car_pickup_tomorrow"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_trips_car_pickup_tomorrow"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trips_car_pickup_tomorrow"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trips_hotel_cancel_deadline_tomorrow"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_trips_hotel_cancel_deadline_tomorrow"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trips_hotel_cancel_deadline_tomorrow"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trips_hotel_checkin_tomorrow"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_trips_hotel_checkin_tomorrow"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trips_hotel_checkin_tomorrow"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trips_hotel_checkout_tomorrow"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_trips_hotel_checkout_tomorrow"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trips_hotel_checkout_tomorrow"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_trips_transfer_tomorrow"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_trips_transfer_tomorrow"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trips_transfer_tomorrow"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_travel_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_travel_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_travel_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_trip_creator"("p_trip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_trip_creator"("p_trip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_trip_creator"("p_trip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_trip_participant"("p_trip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_trip_participant"("p_trip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_trip_participant"("p_trip_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_trip_pro"("p_trip_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_trip_pro"("p_trip_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_user_pro"("p_uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_user_pro"("p_uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."learn_city"("p_name_en" "text", "p_country_code" "text", "p_lat" double precision, "p_lng" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."learn_city"("p_name_en" "text", "p_country_code" "text", "p_lat" double precision, "p_lng" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."learn_city"("p_name_en" "text", "p_country_code" "text", "p_lat" double precision, "p_lng" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."levenshtein"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."levenshtein"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."levenshtein"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."levenshtein"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."levenshtein"("text", "text", integer, integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."levenshtein"("text", "text", integer, integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."levenshtein"("text", "text", integer, integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."levenshtein"("text", "text", integer, integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."levenshtein_less_equal"("text", "text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."levenshtein_less_equal"("text", "text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."levenshtein_less_equal"("text", "text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."levenshtein_less_equal"("text", "text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."levenshtein_less_equal"("text", "text", integer, integer, integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."levenshtein_less_equal"("text", "text", integer, integer, integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."levenshtein_less_equal"("text", "text", integer, integer, integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."levenshtein_less_equal"("text", "text", integer, integer, integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."link_pending_invites"() TO "anon";
GRANT ALL ON FUNCTION "public"."link_pending_invites"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."link_pending_invites"() TO "service_role";



GRANT ALL ON FUNCTION "public"."metaphone"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."metaphone"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."metaphone"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."metaphone"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_booking_added"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_booking_added"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_booking_added"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."recompute_trip"("p_trip" "uuid", "p_base" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_trip"("p_trip" "uuid", "p_base" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recompute_user_entitlement"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_user_entitlement"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reminder_true_instant"("ts" timestamp with time zone, "tz" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reminder_true_instant"("ts" timestamp with time zone, "tz" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reminder_true_instant"("ts" timestamp with time zone, "tz" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_city"("p_city" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_city"("p_city" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_city"("p_city" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reorder_cities"("p_trip" "uuid", "p_order" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_cities"("p_trip" "uuid", "p_order" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_cities"("p_trip" "uuid", "p_order" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_cities_local"("p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_cities_local"("p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_cities_local"("p_items" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_city_id"("p_country_code" "text", "p_lat" double precision, "p_lng" double precision, "p_name_en" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_city_id"("p_country_code" "text", "p_lat" double precision, "p_lng" double precision, "p_name_en" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_city_id"("p_country_code" "text", "p_lat" double precision, "p_lng" double precision, "p_name_en" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_trip_pro_addons"("p_trip_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_trip_pro_addons"("p_trip_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_user_pro_addons"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_user_pro_addons"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_budget_on_trip"() TO "anon";
GRANT ALL ON FUNCTION "public"."seed_budget_on_trip"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_budget_on_trip"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_city_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_city_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_city_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_city_nights"("p_city" "uuid", "p_nights" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_city_nights"("p_city" "uuid", "p_nights" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_city_nights"("p_city" "uuid", "p_nights" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_trip_start_date"("p_trip" "uuid", "p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_trip_start_date"("p_trip" "uuid", "p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_trip_start_date"("p_trip" "uuid", "p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."soundex"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."soundex"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."soundex"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."soundex"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_budget_expense"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_budget_expense"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_budget_expense"() TO "service_role";



GRANT ALL ON FUNCTION "public"."take_geocode_token"("p_min" numeric, "p_rate" numeric, "p_cap" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."take_geocode_token"("p_min" numeric, "p_rate" numeric, "p_cap" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."take_geocode_token"("p_min" numeric, "p_rate" numeric, "p_cap" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."text_soundex"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."text_soundex"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."text_soundex"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."text_soundex"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_recompute_transfer"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recompute_transfer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recompute_transfer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "service_role";


















GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON TABLE "public"."ai_usage_events" TO "anon";
GRANT ALL ON TABLE "public"."ai_usage_events" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_usage_events" TO "service_role";



GRANT ALL ON TABLE "public"."ai_cost_by_day" TO "service_role";



GRANT ALL ON TABLE "public"."ai_cost_by_process" TO "service_role";



GRANT ALL ON TABLE "public"."ai_cost_by_run" TO "service_role";



GRANT ALL ON TABLE "public"."ai_cost_by_trip" TO "service_role";



GRANT ALL ON TABLE "public"."ai_cost_by_user" TO "service_role";



GRANT ALL ON TABLE "public"."ai_cost_by_week" TO "service_role";



GRANT ALL ON TABLE "public"."ai_model_prices" TO "anon";
GRANT ALL ON TABLE "public"."ai_model_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_model_prices" TO "service_role";



GRANT ALL ON TABLE "public"."budget_categories" TO "anon";
GRANT ALL ON TABLE "public"."budget_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_categories" TO "service_role";



GRANT ALL ON TABLE "public"."budget_expenses" TO "anon";
GRANT ALL ON TABLE "public"."budget_expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_expenses" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."chat_reads" TO "anon";
GRANT ALL ON TABLE "public"."chat_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_reads" TO "service_role";



GRANT ALL ON TABLE "public"."chats" TO "anon";
GRANT ALL ON TABLE "public"."chats" TO "authenticated";
GRANT ALL ON TABLE "public"."chats" TO "service_role";



GRANT ALL ON TABLE "public"."cities" TO "anon";
GRANT ALL ON TABLE "public"."cities" TO "authenticated";
GRANT ALL ON TABLE "public"."cities" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cities_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cities_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cities_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."city_visits" TO "anon";
GRANT ALL ON TABLE "public"."city_visits" TO "authenticated";
GRANT ALL ON TABLE "public"."city_visits" TO "service_role";



GRANT ALL ON TABLE "public"."fx_rates" TO "anon";
GRANT ALL ON TABLE "public"."fx_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."fx_rates" TO "service_role";



GRANT ALL ON TABLE "public"."geocode_cache" TO "anon";
GRANT ALL ON TABLE "public"."geocode_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."geocode_cache" TO "service_role";



GRANT ALL ON SEQUENCE "public"."geocode_cache_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."geocode_cache_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."geocode_cache_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."geocode_queue" TO "anon";
GRANT ALL ON TABLE "public"."geocode_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."geocode_queue" TO "service_role";



GRANT ALL ON SEQUENCE "public"."geocode_queue_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."geocode_queue_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."geocode_queue_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."geocode_rate_bucket" TO "anon";
GRANT ALL ON TABLE "public"."geocode_rate_bucket" TO "authenticated";
GRANT ALL ON TABLE "public"."geocode_rate_bucket" TO "service_role";



GRANT ALL ON TABLE "public"."hotel_stays" TO "anon";
GRANT ALL ON TABLE "public"."hotel_stays" TO "authenticated";
GRANT ALL ON TABLE "public"."hotel_stays" TO "service_role";



GRANT ALL ON TABLE "public"."n8n_chat_histories" TO "anon";
GRANT ALL ON TABLE "public"."n8n_chat_histories" TO "authenticated";
GRANT ALL ON TABLE "public"."n8n_chat_histories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."n8n_chat_histories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."n8n_chat_histories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."n8n_chat_histories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."partner_clicks" TO "anon";
GRANT ALL ON TABLE "public"."partner_clicks" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_clicks" TO "service_role";



GRANT ALL ON TABLE "public"."password_reset_attempts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."password_reset_attempts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."password_reset_attempts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."password_reset_attempts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_events" TO "anon";
GRANT ALL ON TABLE "public"."stripe_events" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_events" TO "service_role";



GRANT ALL ON TABLE "public"."telegram_link_tokens" TO "anon";
GRANT ALL ON TABLE "public"."telegram_link_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."telegram_link_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."telegram_reminder_logs" TO "anon";
GRANT ALL ON TABLE "public"."telegram_reminder_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."telegram_reminder_logs" TO "service_role";



GRANT ALL ON TABLE "public"."transfers" TO "anon";
GRANT ALL ON TABLE "public"."transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."transfers" TO "service_role";



GRANT ALL ON TABLE "public"."trip_budgets" TO "anon";
GRANT ALL ON TABLE "public"."trip_budgets" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_budgets" TO "service_role";



GRANT ALL ON TABLE "public"."trip_documents" TO "anon";
GRANT ALL ON TABLE "public"."trip_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_documents" TO "service_role";



GRANT ALL ON TABLE "public"."trip_invite_links" TO "anon";
GRANT ALL ON TABLE "public"."trip_invite_links" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_invite_links" TO "service_role";



GRANT ALL ON TABLE "public"."trip_member_blocks" TO "anon";
GRANT ALL ON TABLE "public"."trip_member_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_member_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."trip_members" TO "anon";
GRANT ALL ON TABLE "public"."trip_members" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_members" TO "service_role";



GRANT ALL ON TABLE "public"."trip_services" TO "anon";
GRANT ALL ON TABLE "public"."trip_services" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_services" TO "service_role";



GRANT ALL ON TABLE "public"."trip_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."trip_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."trip_telegram_integrations" TO "anon";
GRANT ALL ON TABLE "public"."trip_telegram_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_telegram_integrations" TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."trips" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."trips" TO "authenticated";
GRANT ALL ON TABLE "public"."trips" TO "service_role";



GRANT UPDATE("id") ON TABLE "public"."trips" TO "authenticated";



GRANT UPDATE("title") ON TABLE "public"."trips" TO "authenticated";



GRANT UPDATE("description") ON TABLE "public"."trips" TO "authenticated";



GRANT UPDATE("cover_image_url") ON TABLE "public"."trips" TO "authenticated";



GRANT UPDATE("notes") ON TABLE "public"."trips" TO "authenticated";



GRANT UPDATE("details") ON TABLE "public"."trips" TO "authenticated";



GRANT UPDATE("share_token") ON TABLE "public"."trips" TO "authenticated";



GRANT UPDATE("created_at") ON TABLE "public"."trips" TO "authenticated";



GRANT UPDATE("updated_at") ON TABLE "public"."trips" TO "authenticated";



GRANT UPDATE("cover_gradient") ON TABLE "public"."trips" TO "authenticated";



GRANT UPDATE("created_by") ON TABLE "public"."trips" TO "authenticated";



GRANT ALL ON TABLE "public"."user_custom_visits" TO "anon";
GRANT ALL ON TABLE "public"."user_custom_visits" TO "authenticated";
GRANT ALL ON TABLE "public"."user_custom_visits" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_custom_visits_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_custom_visits_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_custom_visits_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."users" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT INSERT("id"),UPDATE("id") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("email"),UPDATE("email") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("full_name"),UPDATE("full_name") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("avatar_url"),UPDATE("avatar_url") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("language"),UPDATE("language") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("theme"),UPDATE("theme") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("notify_email_invites"),UPDATE("notify_email_invites") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("notify_email_updates"),UPDATE("notify_email_updates") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("created_at"),UPDATE("created_at") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("updated_at"),UPDATE("updated_at") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("unit_system"),UPDATE("unit_system") ON TABLE "public"."users" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

































-- ============================================================================================================
-- ===== STORAGE (наши объекты: бакеты + RLS-политики storage.objects) =====
-- На prod/dev этот блок already-applied (не исполняется). На чистой БД — провизионит наши бакеты и политики.
-- Guard на to_regclass('storage.buckets'): если на момент прогона миграций storage-схема ещё не поднята
-- стеком — блок тихо пропускается (бакеты создаст storage-сервис). Политики применяются через EXECUTE,
-- идемпотентно (DROP POLICY IF EXISTS перед CREATE).
-- Только живые политики двух наших бакетов (avatars ×3, trips ×3 = 6). Мёртвые политики для
-- несуществующих бакетов trip-covers/documents удалены на живых БД миграцией 20260626190000.
DO $do$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not present — skipping bucket/policy seed (storage service will provision it)';
    RETURN;
  END IF;

  -- --- Buckets ---
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    ('avatars', 'avatars', true,  5242880,  ARRAY['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']),
    ('trips',   'trips',   false, 52428800, NULL)
  ON CONFLICT (id) DO UPDATE
    SET public            = EXCLUDED.public,
        file_size_limit   = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  -- --- Policies on storage.objects (idempotent) ---

  EXECUTE $p$ DROP POLICY IF EXISTS "avatars_insert" ON storage.objects $p$;
  EXECUTE $p$ CREATE POLICY "avatars_insert" ON storage.objects FOR INSERT TO public WITH CHECK ((bucket_id = 'avatars'::text) AND (auth.uid() IS NOT NULL)) $p$;

  EXECUTE $p$ DROP POLICY IF EXISTS "avatars_select" ON storage.objects $p$;
  EXECUTE $p$ CREATE POLICY "avatars_select" ON storage.objects FOR SELECT TO public USING (bucket_id = 'avatars'::text) $p$;

  EXECUTE $p$ DROP POLICY IF EXISTS "avatars_update" ON storage.objects $p$;
  EXECUTE $p$ CREATE POLICY "avatars_update" ON storage.objects FOR UPDATE TO public USING ((bucket_id = 'avatars'::text) AND (auth.uid() IS NOT NULL)) $p$;

  EXECUTE $p$ DROP POLICY IF EXISTS "trips_delete" ON storage.objects $p$;
  EXECUTE $p$ CREATE POLICY "trips_delete" ON storage.objects FOR DELETE TO public USING ((bucket_id = 'trips'::text) AND (auth.uid() IS NOT NULL)) $p$;

  EXECUTE $p$ DROP POLICY IF EXISTS "trips_insert" ON storage.objects $p$;
  EXECUTE $p$ CREATE POLICY "trips_insert" ON storage.objects FOR INSERT TO public WITH CHECK ((bucket_id = 'trips'::text) AND (auth.uid() IS NOT NULL)) $p$;

  EXECUTE $p$ DROP POLICY IF EXISTS "trips_select" ON storage.objects $p$;
  EXECUTE $p$ CREATE POLICY "trips_select" ON storage.objects FOR SELECT TO public USING ((bucket_id = 'trips'::text) AND (auth.uid() IS NOT NULL)) $p$;

END
$do$;
