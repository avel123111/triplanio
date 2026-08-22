// @ts-check
/**
 * Data-access layer for a trip's Telegram bindings (TRIP-439).
 *
 * The ONE place the front talks to the edge for Telegram integrations, mirroring
 * the document layer (`documentMutations.js`). Two react-query projections of the
 * SAME resource (`trip_telegram_integrations`), each its own list-query:
 *   • TG_TRIP_KEY(tripId) — the bindings of ONE trip (Settings lens).
 *   • TG_MINE_KEY         — every binding the caller made, across all trips,
 *                           enriched with trip title/cover (Account screen).
 * A write to a binding invalidates BOTH projections through `invalidateTelegram`
 * so the two surfaces can never drift — the contract lives here, once.
 *
 * Reads re-throw the STAMPED invokeFn error (`__seamHandled`) so the global
 * React-Query onError seam does not report it to Sentry twice. Writes rethrow the
 * machine `code` via `refusalError` (never the raw server prose, TRIP-378) so the
 * calling mutation words it through `errorText(t, e.code)`.
 */
import { invokeFn } from '@/lib/invokeFn';
import { refusalError } from '@/lib/refusalError';

/** React-query key for ONE trip's Telegram bindings (Settings lens). */
export const TG_TRIP_KEY = (tripId) => ['tg-integrations', tripId];

/** React-query key for the caller's bindings across all trips (Account screen). */
export const TG_MINE_KEY = ['tg-my-integrations'];

/**
 * Invalidate BOTH projections of the Telegram-bindings resource after a write, so
 * Settings lens and the Account screen reconcile to server truth on the response.
 * `tripId` is optional — the Account screen has no single trip in scope.
 */
export function invalidateTelegram(qc, tripId) {
  if (tripId) qc.invalidateQueries({ queryKey: TG_TRIP_KEY(tripId) });
  qc.invalidateQueries({ queryKey: TG_MINE_KEY });
}

/** Fetch one trip's bindings. queryFn for TG_TRIP_KEY. */
export async function fetchTripIntegrations(tripId) {
  const { data, error } = await invokeFn('telegramGetIntegration', { body: { tripId } });
  if (error) throw error; // stamped __seamHandled → not re-reported by the query seam
  return data?.integrations ?? [];
}

/** Fetch the caller's bindings across all trips. queryFn for TG_MINE_KEY. */
export async function fetchMyIntegrations() {
  const { data, error } = await invokeFn('telegramGetMyIntegrations');
  if (error) throw error;
  return data?.integrations ?? [];
}

/**
 * Unlink ONE binding (real teardown: deletes the row AND emits
 * `trip_telegram_unlinked` to n8n so the bot stops). Rethrows the machine `code`
 * on refusal so the caller's onError can word it and roll the list back.
 */
export async function disconnectTelegram(tripId, integrationId) {
  const { error, code } = await invokeFn('telegramDisconnect', {
    body: { tripId, integrationId },
  });
  if (error) throw refusalError(code);
}

/** Toggle a binding's `is_active` (bot notifies / stays quiet for this chat). */
export async function setTelegramActive(tripId, integrationId, isActive) {
  const { error, code } = await invokeFn('telegramSetActive', {
    body: { tripId, integrationId, isActive },
  });
  if (error) throw refusalError(code);
}

/**
 * Mint the one-time deep link that binds a Telegram chat to the trip. Rethrows the
 * machine `code` on refusal; returns the `t.me` url on success.
 * @returns {Promise<string>}
 */
export async function startTelegramLink(tripId) {
  const { data, error, code } = await invokeFn('telegramStartLink', { body: { tripId } });
  if (error || !data?.url) throw refusalError(code);
  return data.url;
}
