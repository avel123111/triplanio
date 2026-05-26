import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
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
      const res = await base44.entities.TripMember.filter({
        trip_id: trip.id,
        user_email: user.email,
        status: 'active',
      });
      return res?.[0] || null;
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