/**
 * deleteMyAccount
 *
 * POST — no body required.
 *
 * Soft-deletes (anonymizes) the authenticated user's account in a single DB
 * transaction (anonymize_my_account RPC):
 *   - blocks on an active recurring subscription;
 *   - deletes purely-personal records;
 *   - scrubs PII on public.users and on cached trip_members snapshots;
 *   - neutralizes the auth account IN PLACE — drops identities, scrubs the auth
 *     email, permanently bans, and kills sessions. (We can't hard-delete
 *     auth.users because retained shared content references it via FK.)
 *
 * Responses always carry a machine-readable `code` (readable on non-2xx via
 * error.context): 200 ok | 400 active_subscription | 401 unauthorized |
 * 500 delete_failed.
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

    return Response.json({ code: 'ok' }, { headers: corsHeaders });

  } catch (e) {
    console.error('deleteMyAccount error:', e);
    return Response.json({ code: 'delete_failed' }, { status: 500, headers: corsHeaders });
  }
});
