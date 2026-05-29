/**
 * Shared trip access-control helpers.
 *
 * Repeated in every member-management function — centralised here so
 * a single change covers all callers.
 */

import { supabaseAdmin } from './supabaseAdmin.ts';

/**
 * Returns true if `userId` is the trip creator or an active admin/owner member.
 * Used to gate write operations (invite, remove, role change, resend).
 */
export async function isCallerAdmin(tripId: string, userId: string): Promise<boolean> {
  const { data: trip } = await supabaseAdmin
    .from('trips')
    .select('created_by')
    .eq('id', tripId)
    .single();

  if (!trip) return false;
  if (trip.created_by === userId) return true;

  const { data: members } = await supabaseAdmin
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);

  const role = members?.[0]?.role;
  return role === 'admin' || role === 'owner';
}

/**
 * Returns true if `userId` is an active participant of the trip
 * (creator OR active TripMember of any role).
 */
export async function isCallerParticipant(tripId: string, userId: string): Promise<boolean> {
  const { data: trip } = await supabaseAdmin
    .from('trips')
    .select('created_by')
    .eq('id', tripId)
    .single();

  if (!trip) return false;
  if (trip.created_by === userId) return true;

  const { data: members } = await supabaseAdmin
    .from('trip_members')
    .select('id')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);

  return (members ?? []).length > 0;
}
