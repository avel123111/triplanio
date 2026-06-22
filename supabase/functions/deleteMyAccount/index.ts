/**
 * deleteMyAccount
 *
 * POST — no body required.
 *
 * Soft-deletes (anonymizes) the authenticated user's account:
 *   1. anonymize_my_account RPC (one transaction): blocks on an active recurring
 *      subscription, deletes purely-personal records, scrubs PII on public.users
 *      and on cached trip_members snapshots. Shared trip content and financial
 *      records are preserved.
 *   2. Removes the auth account (GoTrue admin API) so the user can no longer log
 *      in and their email is freed for re-registration.
 *
 * Responses always carry a machine-readable `code` so the frontend can map it to
 * a localized message (the body is readable on non-2xx via error.context):
 *   200 { code: 'ok' }
 *   400 { code: 'active_subscription' }  — cancel subscription first
 *   401 { code: 'unauthorized' }
 *   500 { code: 'delete_failed' }
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) {
      return Response.json({ code: 'unauthorized' }, { status: 401, headers: corsHeaders });
    }

    // --- Anonymize all DB data in one transaction (service-role RPC) ---
    const { data, error: rpcError } = await supabaseAdmin.rpc('anonymize_my_account', {
      p_user_id: user.id,
    });

    if (rpcError) {
      console.error('anonymize_my_account error:', rpcError);
      return Response.json({ code: 'delete_failed' }, { status: 500, headers: corsHeaders });
    }

    const code = (data as { code?: string } | null)?.code;

    if (code === 'active_subscription') {
      return Response.json({ code }, { status: 400, headers: corsHeaders });
    }
    if (code === 'unauthorized') {
      return Response.json({ code }, { status: 401, headers: corsHeaders });
    }
    if (code !== 'ok') {
      console.error('anonymize_my_account unexpected code:', code);
      return Response.json({ code: 'delete_failed' }, { status: 500, headers: corsHeaders });
    }

    // --- Remove the auth account (must be last; no FK/trigger to public.users) ---
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (authErr) {
      console.error('auth.admin.deleteUser error:', authErr);
      return Response.json({ code: 'delete_failed' }, { status: 500, headers: corsHeaders });
    }

    return Response.json({ code: 'ok' }, { headers: corsHeaders });

  } catch (e) {
    console.error('deleteMyAccount error:', e);
    return Response.json({ code: 'delete_failed' }, { status: 500, headers: corsHeaders });
  }
});
