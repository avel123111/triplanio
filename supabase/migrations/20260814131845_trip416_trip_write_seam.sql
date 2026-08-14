-- TRIP-416 — домен «трип» за единой дверью записи (блок 3 эпика TRIP-374).
--
-- Схлопывает 4 разрозненных TS-писателя `trips` (updateTripSettings/deleteTrip/
-- copyTrip/ensureShareToken) в шов записи `_shared/mutate.ts`. delete идёт
-- генерик-веткой op:'delete'+targetBy:'scope' (SQL тут не нужен), остальные три —
-- атомарными RPC ниже. Актор приезжает ДАННЫМИ (`p_actor`); авторизация
-- (editor/participant/owner) уже проверена в edge — под service_role `auth.uid()`
-- НУЛЕВОЙ, поэтому тела RPC себя не авторизуют (конвенция route/member-швов).
--
-- Гранты: least-privilege как у member-RPC (TRIP-409) — `revoke execute … from
-- public, anon, authenticated` (одного `public` мало: `ALTER DEFAULT PRIVILEGES`
-- Supabase авто-грантит EXECUTE anon/authenticated) + `grant … to service_role`.

-- ── is_pro_addon — SQL-зеркало _shared/proAddons.ts (TRIP-416) ────────────────
-- Единый источник множества Pro-аддонов в третьем рантайме (Postgres): зовут
-- copy_trip (санитайз) и update_trip_settings (гейт). Дрейф FE↔edge↔SQL держит
-- `src/lib/tripAddons.test.js` (сверяет этот массив с двумя литералами). Чистая
-- (immutable, ничего не читает) — SECURITY INVOKER, но search_path пиним (TRIP-54).
create or replace function public.is_pro_addon(p_key text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select p_key = any (array['budget', 'chat', 'telegram_assistant']);
$$;

revoke execute on function public.is_pro_addon(text) from public, anon, authenticated;
grant  execute on function public.is_pro_addon(text) to service_role;

-- ── update_trip_settings — read-modify-write + Pro-гейт (ресурс trip-settings) ─
-- Верхние колонки — из p_fields (уже провалидированы швом: title≤300 и т.д.);
-- details.{main_currency,display,addons} — shallow-merge из p_details_patch
-- (частичный патч НЕ затирает соседние флаги). Включение Pro-аддона на не-Pro
-- трипе → {outcome:'pro_required'} (шов переводит в 402 PRO_REQUIRED). Смену
-- валюты гасит триггер trg_reset_fx_on_currency_change на самом UPDATE trips.
-- p_actor не нужен телу (auth в edge), но обязан быть в сигнатуре — его инъектит
-- buildPlan во ВСЕ seam-RPC.
create or replace function public.update_trip_settings(
  p_trip uuid,
  p_actor uuid,
  p_fields jsonb,
  p_details_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_details jsonb;
  v_prev    jsonb;
  v_addons  jsonb;
  k         text;
begin
  select details into v_details from public.trips where id = p_trip;
  -- Авторизация (editor) уже прошла в шве; строки без трипа сюда доехать почти не
  -- может (гонка после гейта). Defensive no-op вместо ложной записи.
  if not found then
    return jsonb_build_object('outcome', 'ok');
  end if;
  v_details := coalesce(v_details, '{}'::jsonb);

  -- details-патч: только присланные ключи (частичный merge).
  if p_details_patch ? 'main_currency' then
    v_details := jsonb_set(v_details, '{main_currency}', p_details_patch -> 'main_currency');
  end if;
  if p_details_patch ? 'display' then
    v_details := jsonb_set(
      v_details, '{display}',
      coalesce(v_details -> 'display', '{}'::jsonb) || (p_details_patch -> 'display')
    );
  end if;
  if p_details_patch ? 'addons' then
    v_prev   := coalesce(v_details -> 'addons', '{}'::jsonb);
    v_addons := p_details_patch -> 'addons';
    -- Pro-гейт: включаешь Pro-аддон (был не-true → true) на не-Pro трипе → отказ
    -- ДО записи. Единый предикат is_trip_pro (покрывает и «владелец Pro»).
    if not public.is_trip_pro(p_trip) then
      for k in select jsonb_object_keys(v_addons) loop
        if (v_addons -> k) = to_jsonb(true)
           and public.is_pro_addon(k)
           and coalesce(v_prev -> k, to_jsonb(false)) is distinct from to_jsonb(true) then
          return jsonb_build_object('outcome', 'pro_required');
        end if;
      end loop;
    end if;
    v_details := jsonb_set(v_details, '{addons}', v_prev || v_addons);
  end if;

  update public.trips set
    title           = case when p_fields ? 'title'           then p_fields ->> 'title'           else title end,
    description     = case when p_fields ? 'description'     then p_fields ->> 'description'     else description end,
    cover_image_url = case when p_fields ? 'cover_image_url' then p_fields ->> 'cover_image_url' else cover_image_url end,
    cover_gradient  = case when p_fields ? 'cover_gradient'  then p_fields ->> 'cover_gradient'  else cover_gradient end,
    notes           = case when p_fields ? 'notes'           then p_fields ->> 'notes'           else notes end,
    details         = v_details
  where id = p_trip;

  return jsonb_build_object('outcome', 'ok');
end;
$$;

revoke execute on function public.update_trip_settings(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.update_trip_settings(uuid, uuid, jsonb, jsonb) to service_role;

-- ── copy_trip — вся копия ОДНОЙ атомарной транзакцией (ресурс trip-share) ──────
-- Уходит ручной «компенсирующий DELETE» из copyTrip.ts — функция = одна
-- транзакция, любой сбой откатывает целиком (нет трипа-сироты). Лимит free/Pro —
-- тот же предикат can_create_trip, что trip/create и триггер trips_enforce_limit
-- (backstop). Копия НЕ Pro (is_pro_trip=false), created_by=p_actor; Pro-аддоны
-- срезаны через is_pro_addon; документы не копируются (documents='[]'/-'documents').
-- COPY_PREFIX (per-lang) живёт ТУТ (одна копия, ушёл из TS); тайтл обрезается
-- left(…,300) — по КОДПОЙНТАМ (замена ручного UTF-16-трима из TS).
create or replace function public.copy_trip(p_source uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_src     public.trips%rowtype;
  v_details jsonb;
  v_addons  jsonb;
  v_lang    text;
  v_prefix  text;
  v_title   text;
  v_new_id  uuid;
  v_cv_map  jsonb := '{}'::jsonb;
  r         record;
  v_new_cv  uuid;
begin
  -- Лимит: чистый {outcome:'limit'} ДО вставки (шов → 402). Триггер остаётся backstop.
  if not public.can_create_trip(p_actor) then
    return jsonb_build_object('outcome', 'limit');
  end if;

  select * into v_src from public.trips where id = p_source;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Санитайз аддонов: копия никогда не Pro → срезаем Pro-аддоны (is_pro_addon).
  v_details := coalesce(v_src.details, '{}'::jsonb);
  v_addons  := v_details -> 'addons';
  if v_addons is not null and jsonb_typeof(v_addons) = 'object' then
    v_addons := coalesce(
      (select jsonb_object_agg(key, value)
         from jsonb_each(v_addons)
        where not public.is_pro_addon(key)),
      '{}'::jsonb
    );
    v_details := jsonb_set(v_details, '{addons}', v_addons);
  end if;

  -- Тайтл в языке актора; срезаем любой существующий префикс, добавляем свой.
  select language into v_lang from public.users where id = p_actor;
  v_prefix := case v_lang
                when 'ru' then 'Копия: '
                when 'es' then 'Copia de '
                else 'Copy of '
              end;
  v_title := left(
    v_prefix || regexp_replace(v_src.title, '^(Copy of |Копия: |Copia de )+', ''),
    300
  );

  insert into public.trips
    (title, description, cover_image_url, cover_gradient, notes, details, is_pro_trip, created_by)
  values
    (v_title, v_src.description, null, coalesce(v_src.cover_gradient, 'gradient_1'),
     v_src.notes, v_details, false, p_actor)
  returning id into v_new_id;

  -- city_visits с ремапом old→new id (нужен всем дочерним ниже).
  for r in select * from public.city_visits where trip_id = p_source loop
    insert into public.city_visits
      (trip_id, external_city_id, geonameid, name_i18n, city_name_en, country_code,
       latitude, longitude, timezone, start_date, end_date, kind, position, notes, details, created_by)
    values
      (v_new_id, r.external_city_id, r.geonameid, r.name_i18n, r.city_name_en, r.country_code,
       r.latitude, r.longitude, r.timezone, r.start_date, r.end_date, r.kind, r.position, r.notes, r.details, p_actor)
    returning id into v_new_cv;
    v_cv_map := v_cv_map || jsonb_build_object(r.id::text, v_new_cv::text);
  end loop;

  -- hotel_stays (копия рождается без документов).
  insert into public.hotel_stays
    (trip_id, city_visit_id, name, address, check_in_datetime, check_out_datetime,
     booking_reference, payment_status, price, currency, free_cancellation, free_cancellation_until,
     phone, email, booking_url, latitude, longitude, notes, details, documents, created_by)
  select
    v_new_id,
    case when h.city_visit_id is not null then (v_cv_map ->> h.city_visit_id::text)::uuid end,
    h.name, h.address, h.check_in_datetime, h.check_out_datetime,
    h.booking_reference, h.payment_status, h.price, h.currency, h.free_cancellation, h.free_cancellation_until,
    h.phone, h.email, h.booking_url, h.latitude, h.longitude, h.notes, h.details, '[]'::jsonb, p_actor
  from public.hotel_stays h
  where h.trip_id = p_source;

  -- activities
  insert into public.activities
    (trip_id, city_visit_id, title, start_datetime, end_datetime, location_address,
     location_latitude, location_longitude, price, currency, notes, details, documents, created_by)
  select
    v_new_id,
    case when a.city_visit_id is not null then (v_cv_map ->> a.city_visit_id::text)::uuid end,
    a.title, a.start_datetime, a.end_datetime, a.location_address,
    a.location_latitude, a.location_longitude, a.price, a.currency, a.notes, a.details, '[]'::jsonb, p_actor
  from public.activities a
  where a.trip_id = p_source;

  -- transfers
  insert into public.transfers
    (trip_id, from_city_visit_id, to_city_visit_id, transport_type, start_datetime, end_datetime,
     carrier, booking_reference, booking_url, from_address, to_address, from_latitude, from_longitude,
     to_latitude, to_longitude, flight_number, day_change, price, currency, notes, details, documents, created_by)
  select
    v_new_id,
    case when t.from_city_visit_id is not null then (v_cv_map ->> t.from_city_visit_id::text)::uuid end,
    case when t.to_city_visit_id   is not null then (v_cv_map ->> t.to_city_visit_id::text)::uuid end,
    t.transport_type, t.start_datetime, t.end_datetime,
    t.carrier, t.booking_reference, t.booking_url, t.from_address, t.to_address, t.from_latitude, t.from_longitude,
    t.to_latitude, t.to_longitude, t.flight_number, t.day_change, t.price, t.currency, t.notes, t.details, '[]'::jsonb, p_actor
  from public.transfers t
  where t.trip_id = p_source;

  -- trip_services (documents живёт внутри details — срезаем ключ).
  insert into public.trip_services
    (trip_id, kind, name, price, currency, pickup_datetime, dropoff_datetime, details, created_by)
  select
    v_new_id, s.kind, s.name, s.price, s.currency, s.pickup_datetime, s.dropoff_datetime,
    coalesce(s.details, '{}'::jsonb) - 'documents', p_actor
  from public.trip_services s
  where s.trip_id = p_source;

  return jsonb_build_object('outcome', 'ok', 'tripId', v_new_id);
end;
$$;

revoke execute on function public.copy_trip(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.copy_trip(uuid, uuid) to service_role;

-- ── ensure_trip_share_token — find-or-create токена (ресурс trip-share) ────────
-- Возвращает существующий share_token либо генерит новый (32 hex). Генерация — та
-- же конвенция, что invite-токен (`create_trip_invite_link`): `gen_random_bytes`
-- из pgcrypto. Токен открывает read-only публичный вид (getPublicTrip), который
-- участник и так видит.
create or replace function public.ensure_trip_share_token(p_trip uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_token text;
begin
  select share_token into v_token from public.trips where id = p_trip;
  if v_token is null then
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
    update public.trips set share_token = v_token where id = p_trip;
  end if;
  return jsonb_build_object('shareToken', v_token);
end;
$$;

revoke execute on function public.ensure_trip_share_token(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.ensure_trip_share_token(uuid, uuid) to service_role;
