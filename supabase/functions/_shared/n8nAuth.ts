/**
 * n8n webhook authentication.
 *
 * The n8n webhooks are protected with "JWT Auth" — they expect an HS256 JWT
 * signed with the shared secret (N8N_SECRET), NOT the raw secret string.
 * Sending the raw secret as a Bearer token fails with "403 jwt malformed".
 *
 * Use signN8nJwt() to produce the Authorization bearer for every OUTGOING
 * call to an n8n webhook (callTriplanioAi, planTripWithAi, ...).
 */

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
