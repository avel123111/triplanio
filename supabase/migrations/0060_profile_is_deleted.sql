-- 0060_profile_is_deleted.sql
-- TRIP-78 — expose an is_deleted flag on participant profiles so the frontend can
-- render anonymized (soft-deleted) users as "deleted account" + neutral avatar,
-- instead of an empty name. Detection keys on users.deleted_at (added in 0059),
-- never on an empty full_name (live users may legitimately have none).
--
-- Adding a column to the RETURNS TABLE requires DROP + CREATE (CREATE OR REPLACE
-- cannot change the output signature).

drop function if exists public.get_trip_participant_profiles(uuid[]);

create function public.get_trip_participant_profiles(trip_id_list uuid[])
returns table(
  trip_id uuid,
  user_id uuid,
  full_name text,
  email text,
  avatar_url text,
  role text,
  is_owner boolean,
  is_deleted boolean
)
language sql
stable
security definer
as $function$
  WITH accessible AS (
    SELECT t.id FROM trips t WHERE t.id = ANY(trip_id_list)
      AND (t.created_by = auth.uid() OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = t.id AND tm.user_id = auth.uid() AND tm.status = 'active'))
  )
  SELECT t.id, u.id, COALESCE(u.full_name,''), COALESCE(u.email,''), COALESCE(u.avatar_url,''), 'owner'::text, true, (u.deleted_at IS NOT NULL)
  FROM trips t JOIN users u ON u.id = t.created_by WHERE t.id IN (SELECT id FROM accessible)
  UNION ALL
  SELECT tm.trip_id, COALESCE(u.id, tm.user_id), COALESCE(u.full_name, tm.user_full_name,''), COALESCE(u.email, tm.invite_email,''), COALESCE(u.avatar_url,''), tm.role, false, (u.deleted_at IS NOT NULL)
  FROM trip_members tm LEFT JOIN users u ON u.id = tm.user_id
  WHERE tm.trip_id IN (SELECT id FROM accessible) AND tm.status = 'active';
$function$;

grant execute on function public.get_trip_participant_profiles(uuid[]) to authenticated;
