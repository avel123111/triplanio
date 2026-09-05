-- TRIP-517 — `get_my_trip_cards`: участники карточки строятся ТОЛЬКО из
-- `trip_members`, без инъекции владельца из `created_by`+`users`.
--
-- В TRIP-516 владелец стал реальной строкой `trip_members` (role='owner',
-- status='active'). Поэтому ветка `parts`, добиравшая владельца из
-- `my_trips join users on created_by` (is_owner=true) и исключавшая его
-- собственную member-строку из второй ветки, — теперь лишняя: владелец приходит
-- своей строкой, `is_owner = (role='owner')`. Так «участники трипа» = одна
-- таблица на всех концах (эпик TRIP-374), без сборки «владелец ∪ участники».
--
-- Владение (авторитет) НЕ меняется: `owner_pro`/`is_pro` считают Pro по
-- `is_user_pro(created_by)`, `my_role` определяет мою роль по `created_by`
-- (мгновенно и без риска TRIP-143 «владелец показан участником» на загрузке) —
-- это ось владения, отдельная от отрисовки списка. Тело verbatim из
-- 20260905191658_trip516_owner_member_row, изменена только CTE `parts`.

create or replace function public.get_my_trip_cards(p_actor uuid)
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
    select t.id, t.title, t.description, t.cover_image_url,
           t.created_by, t.is_pro_trip, t.created_at, t.details
    from public.trips t where t.created_by = v_uid
    union
    select t.id, t.title, t.description, t.cover_image_url,
           t.created_by, t.is_pro_trip, t.created_at, t.details
    from public.trips t
    join public.trip_members m on m.trip_id = t.id
    where m.user_id = v_uid and m.status = 'active'
  ),
  my_role as (
    select mt.id as trip_id,
      case when mt.created_by = v_uid then 'owner'
           else (select m.role from public.trip_members m
                 where m.trip_id = mt.id and m.user_id = v_uid and m.status = 'active' limit 1)
      end as role
    from my_trips mt
  ),
  owner_pro as (
    select o.created_by, public.is_user_pro(o.created_by) as pro
    from (select distinct created_by from my_trips) o
  ),
  all_visits as (
    select cv.id, cv.trip_id, cv.kind, cv.geonameid, cv.name_i18n, cv.city_name_en,
           cv.country_code, cv.start_date, cv.end_date
    from public.city_visits cv join my_trips mt on mt.id = cv.trip_id
  ),
  visits_agg as (
    select trip_id, jsonb_agg(jsonb_build_object(
      'kind', kind, 'geonameid', geonameid, 'name_i18n', name_i18n,
      'city_name_en', city_name_en, 'country_code', country_code,
      'start_date', start_date, 'end_date', end_date)
      order by start_date nulls last, id) as arr
    from all_visits group by trip_id
  ),
  parts as (
    -- Участники = активные строки trip_members (владелец в их числе, is_owner по
    -- role='owner'). Имя/аватар резолвим через users по user_id — как у любого
    -- участника; отдельной ветки «владелец из created_by» больше нет.
    select p.trip_id, jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'name', p.name,
      'avatar_url', p.avatar_url, 'is_owner', p.is_owner, 'is_deleted', p.is_deleted)
      order by p.is_owner desc, p.name) as arr
    from (
      select m.trip_id, coalesce(u.id, m.user_id) as user_id,
        case when u.deleted_at is not null then ''
             else coalesce(
               nullif(btrim(coalesce(u.full_name, m.user_full_name)), ''),
               nullif(upper(left(split_part(coalesce(u.email, m.invite_email), '@', 1), 1)) || substr(split_part(coalesce(u.email, m.invite_email), '@', 1), 2), ''),
               '') end as name,
        coalesce(u.avatar_url, '') as avatar_url,
        (m.role = 'owner') as is_owner,
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
      'cover_image_url', mt.cover_image_url,
      'created_by', mt.created_by,
      'is_pro', coalesce(mt.is_pro_trip or op.pro, false),
      'role', mr.role,
      'addons', coalesce(mt.details->'addons', '{}'::jsonb),
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

revoke execute on function public.get_my_trip_cards(uuid) from public, anon, authenticated;
grant  execute on function public.get_my_trip_cards(uuid) to service_role;
