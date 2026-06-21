/**
 * updateTripSettings
 *
 * Writes to the owner-only `trips` table on behalf of OWNER or active ADMIN
 * members. The `trips` RLS policy allows UPDATE only to created_by=auth.uid(),
 * so admins can't change trip title/currency/cover/addons via a direct client
 * update — that silently no-ops. This function (service role) does the write
 * after checking membership + role, and gates enabling Pro addons.
 *
 * POST body: { tripId, fields?, addons?, main_currency?, display? }
 *   fields       — whitelisted top-level columns (title, description, cover_image_url, cover_gradient, notes)
 *   addons       — full addons object to set under details.addons
 *   main_currency — set under details.main_currency
 *   display      — trip-level display toggles, shallow-merged into details.display
 *                  (e.g. { booking_warnings: false }). Extensible: future display
 *                  flags flow through here without a schema or function change.
 *
 * Returns 200 { ok: true } | { ok: false, code: 'FORBIDDEN' | 'PRO_REQUIRED' }.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { PRO_ADDON_SET } from '../_shared/proAddons.ts';

const ALLOWED_COLS = ['title', 'description', 'cover_image_url', 'cover_gradient', 'notes'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, fields, addons, main_currency, display } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId required' }, { status: 400, headers: corsHeaders });

    const { data: trip } = await supabaseAdmin
      .from('trips').select('created_by, is_pro_trip, details').eq('id', tripId).single();
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    // Permission: owner (created_by) or an active admin/owner member.
    let allowed = trip.created_by === user.id;
    if (!allowed) {
      const { data: m } = await supabaseAdmin
        .from('trip_members').select('role')
        .eq('trip_id', tripId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
      allowed = !!m && (m.role === 'admin' || m.role === 'owner');
    }
    if (!allowed) return Response.json({ ok: false, code: 'FORBIDDEN' }, { headers: corsHeaders });

    // Trip-level Pro = is_pro_trip OR the owner has an active subscription.
    let tripIsPro = !!trip.is_pro_trip;
    if (!tripIsPro && trip.created_by) {
      const { data: owner } = await supabaseAdmin
        .from('users').select('subscription_status, subscription_end_date').eq('id', trip.created_by).single();
      tripIsPro = !!owner && owner.subscription_status === 'pro'
        && !!owner.subscription_end_date && new Date(owner.subscription_end_date) > new Date();
    }

    const update: Record<string, unknown> = {};
    if (fields && typeof fields === 'object') {
      for (const k of ALLOWED_COLS) if (k in fields) update[k] = fields[k];
    }

    if (main_currency !== undefined || addons !== undefined || display !== undefined) {
      const newDetails = { ...(trip.details || {}) };
      if (typeof main_currency === 'string' && main_currency) newDetails.main_currency = main_currency;
      if (display && typeof display === 'object') {
        // Shallow-merge so unrelated display flags are preserved.
        newDetails.display = { ...(trip.details?.display || {}), ...display };
      }
      if (addons && typeof addons === 'object') {
        // Block enabling a PRO addon when the trip isn't Pro.
        const prev = (trip.details?.addons) || {};
        for (const key of Object.keys(addons)) {
          if (addons[key] === true && PRO_ADDON_SET.has(key) && prev[key] !== true && !tripIsPro) {
            return Response.json({ ok: false, code: 'PRO_REQUIRED' }, { headers: corsHeaders });
          }
        }
        // Shallow-merge so a partial addons body never wipes unrelated flags
        // (symmetric with the display merge above).
        newDetails.addons = { ...prev, ...addons };
      }
      update.details = newDetails;
    }

    if (Object.keys(update).length === 0) return Response.json({ ok: true }, { headers: corsHeaders });

    const { error } = await supabaseAdmin.from('trips').update(update).eq('id', tripId);
    if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (e) {
    console.error('updateTripSettings error:', e);
    return Response.json({ error: e instanceof Error ? e.message : 'Internal error' }, { status: 500, headers: corsHeaders });
  }
});
