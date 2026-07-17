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

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { collectPrivateDocFiles, purgeCollectedDocFiles } from '../_shared/personalDocsTeardown.ts';

Deno.serve(withHandler('deleteMyAccount', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) {
      return Response.json({ code: 'unauthorized' }, { status: 401, headers: corsHeaders });
    }

    // Collect the user's PRIVATE document files BEFORE the RPC deletes the rows —
    // the RPC has no Storage access, so the edge must remember the paths first
    // and remove the orphaned files after a successful anonymize (TRIP-44). Routed
    // through the single _shared/personalDocsTeardown source. Best-effort: a
    // failure here must never block account deletion.
    let collectedDocs: { paths: string[]; tripIds: string[]; docIds: string[] } = { paths: [], tripIds: [], docIds: [] };
    try {
      collectedDocs = await collectPrivateDocFiles(supabaseAdmin, user.id);
    } catch (e) {
      console.error('deleteMyAccount: collect personal doc files failed', e);
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

    // RPC removed the rows; now sweep the orphaned Storage files (Storage-guard
    // skips any path a surviving row still references). Best-effort — the account
    // is already anonymized, so never turn an orphan file into a 500.
    try {
      await purgeCollectedDocFiles(supabaseAdmin, collectedDocs);
    } catch (e) {
      console.error('deleteMyAccount: purge personal doc files failed', e);
    }

    // anonymize_my_account scrubs users.avatar_url to null but has no Storage
    // access, so the avatar object itself is left orphaned in the `avatars`
    // bucket. Sweep the user's avatar folder best-effort (TRIP-117) — never let
    // an orphan file turn a successful anonymize into a failure.
    try {
      const { data: avatarFiles } = await supabaseAdmin.storage.from('avatars').list(user.id);
      const paths = (avatarFiles ?? []).map((f) => `${user.id}/${f.name}`);
      if (paths.length) await supabaseAdmin.storage.from('avatars').remove(paths);
    } catch (e) {
      console.error('deleteMyAccount: purge avatar files failed', e);
    }

    return Response.json({ code: 'ok' }, { headers: corsHeaders });

}));
