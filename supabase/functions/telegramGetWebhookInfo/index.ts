/**
 * telegramGetWebhookInfo
 *
 * Admin-only diagnostic. Returns Telegram's current webhook configuration.
 *
 * Access restricted to emails listed in ADMIN_EMAILS env var (comma-separated).
 */

import { corsHeaders } from '../_shared/cors.ts';
import { getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    // Admin check: ADMIN_EMAILS env var (comma-separated list of allowed emails)
    const adminEmails = (Deno.env.get('ADMIN_EMAILS') || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (adminEmails.length === 0 || !adminEmails.includes((user.email || '').toLowerCase())) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403, headers: corsHeaders });
    }

    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!token) return Response.json({ error: 'Missing TELEGRAM_BOT_TOKEN' }, { status: 500, headers: corsHeaders });

    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = await res.json();
    return Response.json(data, { headers: corsHeaders });

  } catch (e) {
    console.error('telegramGetWebhookInfo error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
