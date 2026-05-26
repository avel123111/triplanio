import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const N8N_WEBHOOK_URL = 'https://pavel27.app.n8n.cloud/webhook/group-chat-ai';

/**
 * Trigger the Triplanio AI assistant for a trip chat.
 *
 * Input (POST JSON): { trip_id: string, user_message?: string }
 *
 * Flow:
 *  1. Verify caller is the trip creator or an active TripMember.
 *  2. Collect trip context (trip + cities + hotels + transfers + activities +
 *     services + budget) and the last 20 chat messages.
 *  3. Sign an HS256 JWT with TRIPLANIO_AI_JWT_SECRET (payload = full context).
 *  4. POST {token, payload} to the n8n webhook (fire-and-forget — n8n calls
 *     us back asynchronously via triplanioAiReply).
 *
 * Does NOT wait for the AI response — n8n is expected to push the reply via
 * the triplanioAiReply endpoint, which creates a ChatMessage and surfaces it
 * in the chat via the live subscription.
 */

// ===== Web Crypto helpers (HS256) =====
function base64urlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function strToBytes(s) { return new TextEncoder().encode(s); }

async function signJwtHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = base64urlEncode(strToBytes(JSON.stringify(header)));
  const encPayload = base64urlEncode(strToBytes(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    strToBytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, strToBytes(signingInput));
  return `${signingInput}.${base64urlEncode(sig)}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { trip_id, user_message } = await req.json();
    if (!trip_id) {
      return Response.json({ error: 'trip_id is required' }, { status: 400 });
    }

    const sr = base44.asServiceRole.entities;
    const trip = await sr.Trip.get(trip_id);
    if (!trip) {
      return Response.json({ error: 'Trip not found' }, { status: 404 });
    }

    // Access check: creator or active member.
    const isCreator = trip.created_by === user.email;
    let isMember = false;
    if (!isCreator) {
      const rows = await sr.TripMember.filter({
        trip_id, user_email: user.email, status: 'active',
      });
      isMember = rows.length > 0;
    }
    if (!isCreator && !isMember) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Minimal context — n8n only needs the trip id, the user's question and
    // the recent chat history. n8n can call back into our API for richer
    // context if/when it needs more.
    const recentMessages = await sr.ChatMessage.filter({ trip_id }, '-created_date', 20);
    const messages = (recentMessages || []).slice().reverse().map(m => ({
      id: m.id,
      user_email: m.user_email,
      user_full_name: m.user_full_name,
      text: m.text,
      created_date: m.created_date,
    }));

    const payload = {
      trip_id,
      user_message: user_message || (messages[messages.length - 1]?.text || ''),
      messages,
      requested_by: { email: user.email, full_name: user.full_name || null },
    };

    const secret = Deno.env.get('TRIPLANIO_AI_JWT_SECRET');
    if (!secret) {
      console.error('TRIPLANIO_AI_JWT_SECRET is not set');
      return Response.json({ error: 'AI not configured' }, { status: 500 });
    }
    // Minimal JWT — n8n only validates the signature, not the claims.
    // Keeping it tiny avoids the HTTP 431 (Request Header Fields Too Large)
    // n8n Cloud returns when the Authorization header is too big.
    const token = await signJwtHS256(
      { iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID() },
      secret,
    );

    // n8n validates the JWT from the Authorization header (Bearer ...).
    // The full context is sent in the JSON body as `payload`.
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ payload }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('n8n webhook returned non-2xx:', res.status, errText);
      return Response.json({ error: 'AI webhook failed', status: res.status }, { status: 502 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error('callTriplanioAi error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});