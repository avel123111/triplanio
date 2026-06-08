-- Migration 0025: get_trip_participant_profiles
-- Returns full profile (avatar_url included) for ALL active participants
-- (owner + active members) across a list of trip IDs, in a single batch call.
-- Replaces the separate allTripMembers query + get_trip_owner_profiles RPC.
-- Security: SECURITY DEFINER + WHERE filters to only trips the caller participates in.

CREATE OR REPLACE FUNCTION get_trip_participant_profiles(trip_id_list uuid[])
RETURNS TABLE (
  trip_id    uuid,
  user_id    uuid,
  full_name  text,
  email      text,
  avatar_url text,
  role       text,
  is_owner   boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  -- Helper: trips the caller can access
  WITH accessible AS (
    SELECT t.id
    FROM trips t
    WHERE t.id = ANY(trip_id_list)
      AND (
        t.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM trip_members tm
          WHERE tm.trip_id = t.id
            AND tm.user_id = auth.uid()
            AND tm.status = 'active'
        )
      )
  )

  -- 1. Owner row for each accessible trip
  SELECT
    t.id       AS trip_id,
    u.id       AS user_id,
    COALESCE(u.full_name,  '')  AS full_name,
    COALESCE(u.email,      '')  AS email,
    COALESCE(u.avatar_url, '')  AS avatar_url,
    'owner'::text               AS role,
    true                        AS is_owner
  FROM trips t
  JOIN users u ON u.id = t.created_by
  WHERE t.id IN (SELECT id FROM accessible)

  UNION ALL

  -- 2. Active member rows for each accessible trip
  SELECT
    tm.trip_id,
    COALESCE(u.id, tm.user_id)                              AS user_id,
    COALESCE(u.full_name, tm.user_full_name, '')            AS full_name,
    COALESCE(u.email,     tm.invite_email,   '')            AS email,
    COALESCE(u.avatar_url, '')                              AS avatar_url,
    tm.role,
    false                                                   AS is_owner
  FROM trip_members tm
  LEFT JOIN users u ON u.id = tm.user_id
  WHERE tm.trip_id IN (SELECT id FROM accessible)
    AND tm.status = 'active';
$$;

GRANT EXECUTE ON FUNCTION get_trip_participant_profiles(uuid[]) TO authenticated;
