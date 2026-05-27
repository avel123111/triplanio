import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';

/**
 * Returns { loading, allowed } for the current user on a given trip.
 * Allowed if the user created the trip, OR has an active TripMember row.
 */
export function useTripAccess(trip) {
  const { user } = useAuth();
  const enabled = !!trip?.id && !!user?.email;

  const { data: membership, isLoading } = useQuery({
    queryKey: ['trip-access', trip?.id, user?.email],
    queryFn: async () => {
      const { data } = await supabase
        .from('trip_members')
        .select('*')
        .eq('trip_id', trip.id)
        .eq('user_email', user.email)
        .eq('status', 'active')
        .limit(1);
      return data?.[0] || null;
    },
    enabled,
  });

  if (!user || !trip) return { loading: true, allowed: false, role: null, canEdit: false };
  if (trip.created_by === user.email) return { loading: false, allowed: true, role: 'owner', canEdit: true };
  if (isLoading) return { loading: true, allowed: false, role: null, canEdit: false };
  const role = membership?.role || null;
  return {
    loading: false,
    allowed: !!membership,
    role,
    canEdit: role === 'admin',
  };
}