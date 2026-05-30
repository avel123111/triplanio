/**
 * n8n webhook authentication.
 *
 * OUTGOING (Supabase -> n8n): the n8n webhooks are protected with "JWT Auth" —
 * they expect an HS256 JWT signed with the shared secret (N8N_SECRET), NOT the
 * raw secret string. Sending the raw secret as a Bearer token fails with
 * "403 jwt malformed". Use signN8nJwt() to produce the Authorization bearer for
 * every outgoing call to an n8n webhook (callTriplanioAi, planTripWithAi, ...).
 *
 * INCOMING (n8n / Telegram bot -> Supabase): our server-to-server Edge
 * Functions run with verify_jwt=false, so the platform gateway does NOT
 * authenticate the caller — the function MUST do it itself. We require
 * `Authorization: Bearer <N8N_SECRET>` (the RAW secret, matching how n8n is
 * configured for getPendingReminders / getDailyReminders). Use
 * requireN8nSecret() at the top of every such handler.
 */

import { corsHeaders } from './cors.ts';

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Returns an HS256 JWT signed with `secret` (the n8n shared secret).
 * Includes iat/exp standard claims (5 min lifetime).
 */
export async function signN8nJwt(secret: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iat: now, exp: now + 300 }));
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${b64url(sig)}`;
}

/**
 * Guards an INCOMING server-to-server endpoint (called by n8n / the Telegram
 * bot) that runs with verify_jwt=false. Requires `Authorization: Bearer
 * <N8N_SECRET>`.
 *
 * Returns a ready-to-send error Response when the caller is NOT authorized
 * (the handler should return it immediately), or `null` when the secret matches
 * and the handler may proceed.
 *
 *   const denied = requireN8nSecret(req);
 *   if (denied) return denied;
 */
export function requireN8nSecret(req: Request): Response | null {
  const expected = Deno.env.get('N8N_SECRET');
  if (!expected) {
    console.error('N8N_SECRET is not set');
    return Response.json({ error: 'Server misconfigured' }, { status: 500, headers: corsHeaders });
  }

  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  return null;
}
