// getPublicTrip — public read-only trip endpoint (no auth; tripId + share_token).
// Returns trip (ownership stripped) + visits/hotels/transfers/activities/carRentals,
// plus a minimal `owner` identity and the active `members` list (display name +
// avatar + role ONLY — never user_id/email) for the shared-trip reader UI.
import { withHandler, jsonError } from '../_shared/http.ts';
import { fetchTripProfiles } from '../_shared/profiles.ts';
import { displayName } from '../_shared/displayName.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// AI assistant account — a trip_member for chat, never shown as a human traveler.
const TRIPLANIO_BOT_EMAIL = 'info@triplanio.com';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

function sanitizeTrip(t: Record<string, unknown>) {
  const { created_by: _c, share_token: _s, ...rest } = t;
  return rest;
}

// Strip attached-file links before they leave the building. Booking/event
// attachments live in each entity's `documents` jsonb (hotels/transfers/
// activities) and in `trip_services.details.documents` — they are 10-year
// signed download URLs. The public read-only view never renders them, so a
// share-link holder must not receive them in the payload (same "frontend hides,
// API returns" class as the private-docs bug TRIP-118 fixed).
function stripEntityDocs<T extends Record<string, unknown>>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).map(({ documents: _docs, ...rest }) => rest as T);
}

function stripServiceDocs<T extends { details?: unknown }>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).map((row) => {
    if (row?.details && typeof row.details === 'object' && !Array.isArray(row.details)) {
      const { documents: _docs, ...restDetails } = row.details as Record<string, unknown>;
      return { ...row, details: restDetails };
    }
    return row;
  });
}

type MemberRow = { user_id: string | null; user_full_name: string | null; role: string | null; status: string | null };

Deno.serve(withHandler('getPublicTrip', async (req, corsHeaders) => {
    const { tripId, token } = await req.json().catch(() => ({}));
    if (!tripId || !token) {
      return jsonError(400, 'tripId and token required', undefined, corsHeaders);
    }

    const { data: trip } = await admin.from('trips').select('*').eq('id', tripId).single();
    if (!trip || !trip.share_token || trip.share_token !== token) {
      return jsonError(404, 'Not found', undefined, corsHeaders);
    }

    const [visits, hotels, transfers, activities, services, members] = await Promise.all([
      admin.from('city_visits').select('*').eq('trip_id', tripId),
      admin.from('hotel_stays').select('*').eq('trip_id', tripId),
      admin.from('transfers').select('*').eq('trip_id', tripId),
      admin.from('activities').select('*').eq('trip_id', tripId),
      admin.from('trip_services').select('*').eq('trip_id', tripId),
      admin.from('trip_members')
        .select('user_id, user_full_name, role, status')
        .eq('trip_id', tripId)
        // The travellers list = who is actually going: accepted members AND
        // offline placeholders the owner added by name (trip-member/add-offline,
        // no account). NOT pending/declined invites, NOT left/removed — those
        // are not on the trip. Matches the app's "who's going" set.
        .in('status', ['active', 'offline']),
    ]);

    const carRentals = stripServiceDocs(
      (services.data ?? []).filter((s: { kind?: string }) => s.kind === 'car_rental'),
    );

    // ── Resolve owner + member identities (display name + avatar ONLY) ──
    // One batched users lookup for the owner and every active member. `email` is
    // read server-side purely to drop the AI bot from the travelers list; it is
    // never returned. user_id is used as a join key only — also never returned.
    const memberRows = (members.data ?? []) as MemberRow[];

    // Identities come through the ONE canonical seam the whole app uses
    // (`_shared/profiles.ts` — the same one getTripDetails/getInbox use), not a
    // hand-rolled users lookup. It resolves name/avatar/email in one place and,
    // crucially, carries `is_deleted` (from users.deleted_at). A soft-deleted
    // account has its `full_name` scrubbed, but the denormalised
    // `trip_members.user_full_name` cache can still hold the old name — the
    // previous code fell back to it and would leak a deleted person's name on a
    // public link. Here a deleted account is DROPPED from the travellers list,
    // exactly as the app renders it as "Удалённый аккаунт" instead of the cache.
    // The owner is a real member row now (TRIP-516/517), so its user_id is already
    // in memberRows — no separate ownerId injection needed to resolve its profile.
    const profiles = await fetchTripProfiles(admin, { members: memberRows });
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    // Owner identity comes from its trip_members row (role='owner', TRIP-516/517)
    // — the SAME source as the travellers list below, not a trips.created_by lookup.
    const ownerRow = memberRows.find((m) => m.role === 'owner');
    const ownerProfile = ownerRow?.user_id ? profileById.get(ownerRow.user_id) : undefined;
    // Name via the shared ladder (real full_name → Title-cased e-mail local-part),
    // the SAME one every in-app screen uses — an account with no full_name reads as
    // "Test8", not as nothing. The raw e-mail never leaves (only the derived name).
    const owner = ownerProfile && !ownerProfile.is_deleted && (ownerProfile.full_name || ownerProfile.email)
      ? { display_name: displayName(ownerProfile.email, ownerProfile.full_name), avatar_url: ownerProfile.avatar_url }
      : null;

    const memberList = memberRows
      .map((m) => {
        // The owner is a real trip_members row (role='owner') but is already
        // returned in the `owner` field above — drop it from the travellers list
        // by its role (trip_members), not by a created_by comparison (TRIP-517).
        if (m.role === 'owner') return null;
        const p = m.user_id ? profileById.get(m.user_id) : undefined;
        // Deleted/anonymized account — never a current public traveller.
        if (p?.is_deleted) return null;
        // Live account first, through the shared name ladder (full_name →
        // Title-cased e-mail local-part), so an email-only member reads as "Test8"
        // instead of being dropped by the empty-name filter below; else the invite
        // snapshot. `displayName` returns "-" for an empty profile, so only call it
        // when there IS a live account — otherwise fall through to the snapshot.
        const display_name = (
          (p && (p.full_name || p.email) ? displayName(p.email, p.full_name) : '')
          || m.user_full_name || ''
        ).trim();
        return {
          display_name,
          avatar_url: p?.avatar_url || '',
          role: m.role || 'viewer',
          _email: p?.email || '',
        };
      })
      // Drop the AI bot and any member without a resolvable display name.
      .filter((m): m is NonNullable<typeof m> => !!m && !!m.display_name && m._email !== TRIPLANIO_BOT_EMAIL)
      .map(({ _email, ...rest }) => rest);

    return Response.json({
      trip: sanitizeTrip(trip),
      owner,
      members: memberList,
      visits: visits.data ?? [],
      hotels: stripEntityDocs(hotels.data),
      transfers: stripEntityDocs(transfers.data),
      activities: stripEntityDocs(activities.data),
      carRentals,
    }, { headers: corsHeaders });
}));
