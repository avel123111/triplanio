/**
 * resolveProfiles
 *
 * POST body: { tripId, emails: string[] }
 *
 * Returns { full_name, avatar_url } for each email — but only for emails
 * that are active participants of the trip (prevents leaking arbitrary profiles).
 *
 * Optimization vs base44: one WHERE email = ANY(...) query instead of N individual queries.
 *
 * Exception: info@triplanio.com (AI bot) is always allowed regardless of membership.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';

const TRIPLANIO_BOT_EMAIL = 'info@triplanio.com';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, emails } = await req.json().catch(() => ({}));
    if (!tripId || !Array.isArray(emails)) {
      return Response.json({ error: 'Missing tripId or emails[]' }, { status: 400, headers: corsHeaders });
    }

    // Normalize & dedupe — drop empty/offline placeholder entries
    const wanted = Array.from(new Set(
      emails
        .filter(Boolean)
        .map((e: string) => String(e).trim().toLowerCase())
        .filter((e: string) => e && !e.startsWith('offline:')),
    ));
    if (wanted.length === 0) return Response.json({ profiles: [] }, { headers: corsHeaders });

    // Caller must be a participant
    const callerOk = await isCallerParticipant(tripId, user.email!);
    if (!callerOk) {
      return Response.json({ error: 'Forbidden: not a trip participant' }, { status: 403, headers: corsHeaders });
    }

    // Load all active members of the trip in one query
    const [tripResult, membersResult] = await Promise.all([
      supabaseAdmin.from('trips').select('created_by').eq('id', tripId).single(),
      supabaseAdmin.from('trip_members').select('user_email').eq('trip_id', tripId).eq('status', 'active'),
    ]);

    if (!tripResult.data) {
      return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
    }

    const ownerEmail = (tripResult.data.created_by || '').toLowerCase();
    const participantEmails = new Set<string>(
      (membersResult.data ?? [])
        .filter((m: { user_email: string | null }) => m.user_email)
        .map((m: { user_email: string }) => m.user_email.toLowerCase()),
    );
    if (ownerEmail) participantEmails.add(ownerEmail);

    // Keep only emails that are participants (+ AI bot exception)
    const allowedEmails = wanted.filter(
      (e) => participantEmails.has(e) || e === TRIPLANIO_BOT_EMAIL,
    );
    if (allowedEmails.length === 0) {
      return Response.json({ profiles: [] }, { headers: corsHeaders });
    }

    // Single batch query — no N+1
    const { data: userRows } = await supabaseAdmin
      .from('users')
      .select('email, full_name, avatar_url')
      .in('email', allowedEmails);

    const byEmail = Object.fromEntries(
      (userRows ?? []).map((u: { email: string; full_name: string | null; avatar_url: string | null }) => [u.email.toLowerCase(), u]),
    );

    const profiles = allowedEmails.map((email) => {
      const u = byEmail[email];
      return {
        email,
        full_name: u?.full_name || '',
        avatar_url: u?.avatar_url || '',
      };
    });

    return Response.json({ profiles }, { headers: corsHeaders });

  } catch (error) {
    console.error('resolveProfiles error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
