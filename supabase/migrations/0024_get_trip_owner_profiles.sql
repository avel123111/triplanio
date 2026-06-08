-- Migration 0024: get_trip_owner_profiles RPC
-- Returns owner profiles (id, full_name, email, avatar_url) for a list of trip IDs,
-- but only for trips where the calling user is a participant (owner or active member).
-- Used by the /trips collection screen to show owner avatars in trip cards without
-- requiring N+1 calls or leaking arbitrary user profiles.

CREATE OR REPLACE FUNCTION get_trip_owner_profiles(trip_id_list uuid[])
RETURNS TABLE (
  trip_id    uuid,
  user_id    uuid,
  full_name  text,
  email      text,
  avatar_url text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
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
      -- caller is the owner
      t.created_by = auth.uid()
      OR
      -- caller is an active member
      EXISTS (
        SELECT 1 FROM trip_members tm
        WHERE tm.trip_id = t.id
          AND tm.user_id = auth.uid()
          AND tm.status  = 'active'
      )
    );
$$;

-- Grant execute to authenticated users (RLS enforcement is in the WHERE clause above)
GRANT EXECUTE ON FUNCTION get_trip_owner_profiles(uuid[]) TO authenticated;
