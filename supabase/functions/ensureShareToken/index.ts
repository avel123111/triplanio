/**
 * ensureShareToken
 *
 * POST body: { tripId }
 *
 * Returns the trip's share_token. If not yet set, generates and saves one.
 * Caller must be the trip owner (created_by === user.id).
 */

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerAdmin } from '../_shared/tripAccess.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId is required' }, { status: 400, headers: corsHeaders });

    // Only trip owner (admin) can manage share tokens
    const isAdmin = await isCallerAdmin(tripId, user.id);
    if (!isAdmin) return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });

    // Fetch current share_token
    const { data: trip, error: fetchErr } = await supabaseAdmin
      .from('trips')
      .select('id, share_token')
      .eq('id', tripId)
      .single();

    if (fetchErr || !trip) {
      return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
    }

    if (trip.share_token) {
      return Response.json({ shareToken: trip.share_token }, { headers: corsHeaders });
    }

    // Generate a new 32-hex token
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const shareToken = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    const { error: updateErr } = await supabaseAdmin
      .from('trips')
      .update({ share_token: shareToken })
      .eq('id', tripId);

    if (updateErr) throw updateErr;

    return Response.json({ shareToken }, { headers: corsHeaders });

  } catch (e) {
    console.error('ensureShareToken error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
