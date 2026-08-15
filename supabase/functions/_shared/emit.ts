/**
 * emit(event, ids) — the single door for backend communication events (TRIP-356).
 *
 * The backend no longer decides audience, text or channel: it ANNOUNCES the fact
 * and hands an envelope to the n8n receiver, which resolves language / text and
 * delivers across channels (in-app, email, Telegram, …). Adding a channel becomes
 * an n8n branch, not a code change.
 *
 * Contract (TRIP-417): the wire envelope is { event, env, at, id, data }, where
 * `data` = { trip, actor, member, recipients } — the FACTS as full rows, resolved
 * here from the caller's id slots (see emitResolvers.ts) so n8n reads 0 tables.
 *   • `env`  = raw SENTRY_ENVIRONMENT (development | production) — one workflow
 *     picks the target DB / link base-URL by this label (no Supabase URL needed).
 *   • the backend passes ONLY ids + the `member` snapshot for delete-then-emit
 *     events; the resolver dereferences the rest.
 *
 * Delivery is fire-and-forget in the BACKGROUND (shared `runInBackground` →
 * `EdgeRuntime.waitUntil`) so neither the POST nor the resolve (2–4 DB reads)
 * adds a network hop to the user's response, and FAIL-OPEN: a failed resolve/POST
 * is reported to Sentry but never breaks the user's action. Call emit AFTER the
 * function's own writes are committed.
 *
 * Trade-off owned in Phase 1 (§6): no `outgoing` journal / idempotency yet — if
 * the webhook doesn't arrive the event is lost, exactly as today.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { runInBackground } from './http.ts';
import { signN8nJwt } from './n8nAuth.ts';
import { captureEdgeError } from './sentry.ts';
import { RESOLVERS, EMPTY_DATA, type EmitData } from './emitResolvers.ts';

// n8n receiver base for backend communication events; the event name is the
// last path segment, e.g. .../webhook/notify/invite_created (§1). One webhook
// per event in n8n — no Switch, the URL routes.
const N8N_NOTIFY_BASE = 'https://n8n-production-d1214.up.railway.app/webhook/notify';

/** Id slots the resolver dereferences. Every field optional; the backend fills
 *  only what applies. NOT sent on the wire — consumed by the resolver. */
export type EmitIds = {
  /** Trip the event is about. */
  trip_id?: string;
  /** Explicit addressee (audience for single-recipient events). */
  recipient_id?: string;
  /** Who triggered the event (for `created_by` and audience exclusion). */
  actor_id?: string;
  /** `trip_members` row id — the resolver reads the member row by it. */
  member_id?: string;
};

/** Resolve context: the caller's service_role client + the pre-write `member`
 *  snapshot for delete-then-emit events (the row is gone by resolve time). */
export type EmitCtx = { db: SupabaseClient; snapshot?: Record<string, unknown> };

/** Build the wire envelope (TRIP-417): fixed fields + resolved `data`. */
export function buildEnvelope(event: string, data: EmitData): Record<string, unknown> {
  return {
    event,
    env: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
    at: new Date().toISOString(),
    id: crypto.randomUUID(),
    data,
  };
}

async function deliver(event: string, ids: EmitIds, ctx?: EmitCtx): Promise<void> {
  try {
    const secret = Deno.env.get('N8N_SECRET');
    if (!secret) {
      await captureEdgeError(new Error(`emit(${event}): N8N_SECRET not set`), 'emit');
      return;
    }
    const resolver = RESOLVERS[event];
    const data = ctx?.db && resolver ? await resolver(ctx.db, ids, ctx.snapshot) : EMPTY_DATA;
    const body = buildEnvelope(event, data);
    const jwt = await signN8nJwt(secret);
    const res = await fetch(`${N8N_NOTIFY_BASE}/${encodeURIComponent(event)}`, {
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
 * immediately; resolve (2–4 DB reads) + POST run in the background. Pass `ctx`
 * with the caller's service_role client so the resolver can dereference the ids;
 * omit it only where no data is needed. See module header for the contract.
 */
export function emit(event: string, ids: EmitIds = {}, ctx?: EmitCtx): void {
  runInBackground(deliver(event, ids, ctx));
}
