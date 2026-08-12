/**
 * emit(event, ids) — the single door for backend communication events (TRIP-356).
 *
 * The backend no longer decides audience, text or channel: it ANNOUNCES the fact
 * and hands a small envelope to the n8n receiver, which resolves recipients /
 * names / language / text from the DB (by the ids below) and delivers across
 * channels (in-app, email, Telegram, …). Adding a channel becomes an n8n branch,
 * not a code change.
 *
 * Contract (§2): a fixed envelope { event, domain, at, id } plus id-only slots.
 * The backend passes ONLY ids — never trip title, names, role or language; n8n
 * resolves everything else. `data` stays empty in Phase 1.
 *
 * Delivery is fire-and-forget in the BACKGROUND (shared `runInBackground` →
 * `EdgeRuntime.waitUntil`) so it never adds a network hop to the user's response,
 * and FAIL-OPEN: a failed POST is reported to Sentry but never breaks the user's
 * action. Call emit AFTER the function's own writes are committed, so the n8n
 * receiver reads current data.
 *
 * Trade-off owned in Phase 1 (§6): no `outgoing` journal / idempotency yet — if
 * the webhook doesn't arrive the event is lost, exactly as today.
 */
import { runInBackground } from './http.ts';
import { signN8nJwt } from './n8nAuth.ts';
import { captureEdgeError } from './sentry.ts';

// Live n8n receiver (workflow "Communications"). NOTE: TRIP-356 §1 wrote
// ".../webhook/notify", but the actual webhook path on the instance is
// `outgoing-dispatch` — aligned to the real endpoint.
const N8N_NOTIFY_URL = 'https://n8n-production-d1214.up.railway.app/webhook/outgoing-dispatch';

/** Id-only slots (§2). Every field optional; the backend fills only what applies. */
export type EmitIds = {
  /** Trip the event is about. */
  trip_id?: string;
  /** Explicit addressee (empty → n8n computes the audience itself). */
  recipient_id?: string;
  /** Who triggered the event (for `created_by` and audience exclusion). */
  actor_id?: string;
  /** `trip_members` row id — n8n resolves email/role/status by it. */
  member_id?: string;
  /** Reserved for future structured payload; empty in Phase 1. */
  data?: Record<string, unknown>;
};

/** Build the wire envelope: fixed fields (§2) merged over the caller's id slots. */
export function buildEnvelope(event: string, ids: EmitIds): Record<string, unknown> {
  return {
    event,
    domain: Deno.env.get('SUPABASE_URL') ?? null,
    at: new Date().toISOString(),
    id: crypto.randomUUID(),
    ...ids,
  };
}

async function deliver(event: string, ids: EmitIds): Promise<void> {
  try {
    const secret = Deno.env.get('N8N_SECRET');
    if (!secret) {
      await captureEdgeError(new Error(`emit(${event}): N8N_SECRET not set`), 'emit');
      return;
    }
    const body = buildEnvelope(event, ids);
    const jwt = await signN8nJwt(secret);
    const res = await fetch(N8N_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = `emit(${event}) -> ${res.status}`;
      console.error(msg);
      await captureEdgeError(new Error(msg), 'emit', { event, id: body.id });
    }
  } catch (e) {
    console.error(`emit(${event}) failed:`, e);
    await captureEdgeError(e, 'emit', { event });
  }
}

/**
 * Announce a backend communication event. Non-blocking and fail-open: returns
 * immediately, the POST runs in the background. See module header for the contract.
 */
export function emit(event: string, ids: EmitIds = {}): void {
  runInBackground(deliver(event, ids));
}
