-- Карточка трипа несёт ВКЛЮЧЁННЫЕ АДДОНЫ (`details->addons`).
--
-- Зачем. Состав меню трипа зависит от двух фактов: ступени доступа и включённых
-- аддонов (Бюджет и Чат — секции под аддоном). Ступень главная уже знает, аддонов
-- не знала — и из-за одного этого факта меню нельзя было собрать до ответа
-- read-двери: два пункта из десяти оставались неизвестными, поэтому экран трипа
-- ждал `getTripDetails` целиком. С этим полем факты для меню на главной полные.
--
-- Отдаём ИМЕННО `addons`, а не весь `details`: там же лежат display-настройки и
-- прочее, чего карточке знать незачем (лишний вес + PII-поверхность на ровном
-- месте). `'{}'` при отсутствии — аддоны выключены по умолчанию, нормализацию
-- формы делает клиентский `normalizeAddons` (единый для обоих источников).
--
-- Сигнатура (uuid → jsonb) не меняется; DROP+CREATE + те же least-privilege
-- гранты (revoke public/anon/authenticated, grant service_role), как в прошлых
-- редакциях функции.

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
