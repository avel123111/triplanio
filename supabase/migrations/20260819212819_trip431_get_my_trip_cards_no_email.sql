-- TRIP-431 (Phase 1): get_my_trip_cards(p_actor) больше НЕ отдаёт сырой email
-- участника на фронт. Приватность: адрес (с доменом) — PII, а на главной он
-- играл ровно ОДНУ роль — дать инициал аватара безымянному аккаунту (имя-строка
-- под аватаром на карточках главной не рендерится). Резолвим это имя-фолбэк
-- НА СЕРВЕРЕ (зеркало src/lib/displayName.js) и отдаём готовым полем `name`,
-- сырой `email` из ответа убираем. Визуально — ноль изменений (та же буква).
--
-- RPC не версионируем: DROP+CREATE той же сигнатуры (p_actor uuid → jsonb) в ОДНОЙ
-- миграции + тот же REVOKE public/anon/authenticated + GRANT service_role. Сигнатура
-- не меняется → database.types.ts (гард 2t) остаётся байт-в-байт.
--
-- ЕДИНСТВЕННОЕ изменение против TRIP-403 — CTE `parts`:
--   было:  'full_name', <сырое имя>, 'email', <сырой адрес>
--   стало: 'name', <displayName-эквивалент в SQL>   (email убран)
-- displayName(email, full_name): непустой trim(full_name) → он; иначе local-part
-- адреса с заглавной первой буквой (НЕ initcap — тот Title-казит каждое слово);
-- иначе ''. Для обезличенного аккаунта (deleted_at) — пусто, как и раньше
-- (FE рисует метку «удалён» по is_deleted, имя игнорирует).

drop function if exists public.get_my_trip_cards(uuid);

create function public.get_my_trip_cards(p_actor uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := p_actor;
  v_cards jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  with my_trips as (
    -- Точная семантика is_trip_participant(t.id), развёрнутая в две индексируемые
    -- ветки (как get_user_travel_stats). union схлопывает дубли по одинаковым столбцам.
    select t.id, t.title, t.description, t.cover_gradient, t.cover_image_url,
           t.created_by, t.is_pro_trip, t.created_at
    from public.trips t where t.created_by = v_uid
    union
    select t.id, t.title, t.description, t.cover_gradient, t.cover_image_url,
           t.created_by, t.is_pro_trip, t.created_at
    from public.trips t
    join public.trip_members m on m.trip_id = t.id
    where m.user_id = v_uid and m.status = 'active'
  ),
  my_role as (
    -- Роль актора на трипе: owner если он создатель, иначе роль его active-членства
    -- (та же логика, что getRoleFor во фронте: me.is_owner ? 'owner' : me.role).
    select mt.id as trip_id,
      case when mt.created_by = v_uid then 'owner'
           else (select m.role from public.trip_members m
                 where m.trip_id = mt.id and m.user_id = v_uid and m.status = 'active' limit 1)
      end as role
    from my_trips mt
  ),
  owner_pro as (
    -- Один is_user_pro на уникального владельца (не на трип); формула — в is_user_pro.
    select o.created_by, public.is_user_pro(o.created_by) as pro
    from (select distinct created_by from my_trips) o
  ),
  all_visits as (
    select cv.id, cv.trip_id, cv.kind, cv.geonameid, cv.name_i18n, cv.city_name_en,
           cv.country_code, cv.start_date, cv.end_date
    from public.city_visits cv join my_trips mt on mt.id = cv.trip_id
  ),
  visits_agg as (
    -- Форма визита карточки: ровно то, что читают trip-cities/trip-dates хелперы
    -- (localizeVisits выводит city_name из name_i18n/city_name_en). Порядок
    -- детерминирован (start_date, id) — стабильный список городов и поисковый стог.
    select trip_id, jsonb_agg(jsonb_build_object(
      'kind', kind, 'geonameid', geonameid, 'name_i18n', name_i18n,
      'city_name_en', city_name_en, 'country_code', country_code,
      'start_date', start_date, 'end_date', end_date)
      order by start_date nulls last, id) as arr
    from all_visits group by trip_id
  ),
  parts as (
    -- owner + active-members, форма/скоуп get_trip_participant_profiles; owner первым.
    -- `name` — серверный резолв (displayName-эквивалент); сырой email не уезжает.
    select p.trip_id, jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'name', p.name,
      'avatar_url', p.avatar_url, 'is_owner', p.is_owner, 'is_deleted', p.is_deleted)
      order by p.is_owner desc, p.name) as arr
    from (
      select mt.id as trip_id, u.id as user_id,
        case when u.deleted_at is not null then ''
             else coalesce(
               nullif(btrim(u.full_name), ''),
               nullif(upper(left(split_part(u.email, '@', 1), 1)) || substr(split_part(u.email, '@', 1), 2), ''),
               '') end as name,
        coalesce(u.avatar_url, '') as avatar_url, true as is_owner,
        (u.deleted_at is not null) as is_deleted
      from my_trips mt join public.users u on u.id = mt.created_by
      union all
      select m.trip_id, coalesce(u.id, m.user_id) as user_id,
        case when u.deleted_at is not null then ''
             else coalesce(
               nullif(btrim(coalesce(u.full_name, m.user_full_name)), ''),
               nullif(upper(left(split_part(coalesce(u.email, m.invite_email), '@', 1), 1)) || substr(split_part(coalesce(u.email, m.invite_email), '@', 1), 2), ''),
               '') end as name,
        coalesce(u.avatar_url, '') as avatar_url, false as is_owner,
        (u.deleted_at is not null) as is_deleted
      from public.trip_members m
      left join public.users u on u.id = m.user_id
      where m.trip_id in (select id from my_trips) and m.status = 'active'
    ) p
    group by p.trip_id
  ),
  cards as (
    select jsonb_agg(jsonb_build_object(
      'id', mt.id, 'title', mt.title, 'description', mt.description,
      'cover_gradient', mt.cover_gradient, 'cover_image_url', mt.cover_image_url,
      'created_by', mt.created_by,
      'is_pro', coalesce(mt.is_pro_trip or op.pro, false),
      'role', mr.role,
      'visits', coalesce(va.arr, '[]'::jsonb),
      'participants', coalesce(pa.arr, '[]'::jsonb))
      order by mt.created_at desc) as arr
    from my_trips mt
    join owner_pro op on op.created_by = mt.created_by
    join my_role mr on mr.trip_id = mt.id
    left join visits_agg va on va.trip_id = mt.id
    left join parts pa on pa.trip_id = mt.id
  )
  select coalesce((select arr from cards), '[]'::jsonb) into v_cards;
  return v_cards;
end $function$;

-- Least-privilege EXECUTE: снять PUBLIC-грант свежей функции (иначе anon/authenticated
-- держат EXECUTE через PUBLIC — грабля TRIP-49), оставить только service_role (edge getTrips).
revoke execute on function public.get_my_trip_cards(uuid) from public, anon, authenticated;
grant  execute on function public.get_my_trip_cards(uuid) to service_role;
