/**
 * updateTripSettings
 *
 * Writes to the `trips` table on behalf of OWNER or active ADMIN members — the
 * same set `_can_edit_trip` lets through on the content tables. Since TRIP-190
 * Ф3c `trips` has no write policy at all and `update` is revoked from
 * `authenticated`, NO client can change title/currency/cover/addons directly,
 * the creator included: this function (service role) is the only write path, so
 * the membership+role check below IS the gate. It also gates enabling Pro addons.
 *
 * POST body: { tripId, fields?, addons?, main_currency?, display? }
 *   fields       — whitelisted top-level columns (title, description, cover_image_url, cover_gradient, notes)
 *   addons       — full addons object to set under details.addons
 *   main_currency — set under details.main_currency
 *   display      — trip-level display toggles, shallow-merged into details.display
 *                  (e.g. { booking_warnings: false }). Extensible: future display
 *                  flags flow through here without a schema or function change.
 *
 * Answers: 200 `{ ok: true }` on success; a REFUSAL carries its reason in the
 * HTTP status, not only in the body (TRIP-378). Both refusals used to be sent as
 * 200 `{ ok: false, code }` — a 200 means "done", so every layer that reads the
 * status (Sentry's `withHandler`, `statusOf`/`loadErrorKind`, any future non-JS
 * client) was told the write had succeeded:
 *   403 `{ error, code: 'FORBIDDEN' }`    — caller is not owner/admin of the trip
 *   402 `{ error, code: 'PRO_REQUIRED' }` — enabling a PRO addon on a non-Pro trip
 * 402 rather than 403 on purpose: "you may not" and "you have not paid" are
 * DIFFERENT answers, and keeping them apart at the status level means a caller
 * that reads only the status still tells them apart. The `code`s are unchanged —
 * they are what the client branches on, and renaming one splits Sentry grouping.
 *
 * The remaining bare `Response.json` answers here — body `{ error }` with no
 * `code` — (401 / 400 / the write 500) are deliberately NOT converted: they
 * already carry a truthful status, and the raw answers move to `jsonError` in ONE
 * codemod (эпик TRIP-374, Р4 §0(F) — "по касанию" отменено). Converting them here
 * would make that codemod's diff unreviewable for no behaviour change.
 *
 * ⚠️ Два числа про «сырые ответы» ходят рядом и меряют РАЗНОЕ — предикат раньше
 * числа: **167** = однострочные `Response.json` с телом `{ error }` (счёт §0(F)
 * хендоффа), **193 → 188 после этого PR** = метрика M4 гарда 2r «ответ НЕ ПО
 * КАНОНУ», куда сверх тех 167 входят двухаргументные, `ok:false`, `allow:false` и
 * «только статус ≥400». Ни одно не опечатка; актуальное — `npm run check:door`.
 *
 * ⚠️⚠️ Литерал предиката §0(F) в этой шапке НЕ пишется слитно намеренно: он
 * ГРЕПАЕТСЯ по тексту, комментарии не гасит, и связка «слово + пример» подняла бы
 * счёт ровно в том файле, который сырой ответ УБРАЛ (замер: 167 → 166 при
 * настоящих 164). Гард 2r от этого защищён — он гасит комментарии, — а ручной
 * греп нет. Родня «2d краснеет на комментарии, цитирующем проблемную форму».
 */
import { withHandler, jsonError } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isNotFound } from '../_shared/classifyDbError.ts';
import { isCallerEditor } from '../_shared/tripAccess.ts';
import { PRO_ADDON_SET } from '../_shared/proAddons.ts';

const ALLOWED_COLS = ['title', 'description', 'cover_image_url', 'cover_gradient', 'notes'];

Deno.serve(withHandler('updateTripSettings', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, fields, addons, main_currency, display } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId required' }, { status: 400, headers: corsHeaders });

    // `details` is the only column this function reads: permission comes from
    // isCallerEditor and trip-level Pro from the is_trip_pro RPC below (which
    // also covers "the owner is Pro" — the `is_pro_trip` column does not).
    const { data: trip, error: tripErr } = await supabaseAdmin
      .from('trips').select('details').eq('id', tripId).single();
    // The lookup error used to be DISCARDED entirely, so a failed query fell
    // through `!trip` and answered "Trip not found" — the same lie deleteTrip
    // told, from the same line shape. Split it on the shared taxonomy: genuine
    // absence / unusable id → 404, a query failure → rethrow, which `withHandler`
    // renders as a 500 `INTERNAL` (retryable) with the REAL Postgrest error in
    // Sentry — the same shape `getTripDetails` and `deleteTrip` use.
    if (tripErr && !isNotFound(tripErr)) throw tripErr;
    if (!trip) return jsonError(404, 'Trip not found', 'NOT_FOUND', corsHeaders);

    // Permission: the `editor` step (_shared/tripAccess.ts).
    if (!(await isCallerEditor(tripId, user.id))) {
      return jsonError(403, 'Forbidden', 'FORBIDDEN', corsHeaders);
    }

    // Trip-level Pro from the single SQL source (is_trip_pro = is_pro_trip OR owner
    // is_user_pro, migration 0055). Used only to gate enabling PRO addons below.
    const { data: tripProRpc } = await supabaseAdmin.rpc('is_trip_pro', { p_trip_id: tripId });
    const tripIsPro = tripProRpc === true;

    const update: Record<string, unknown> = {};
    if (fields && typeof fields === 'object') {
      for (const k of ALLOWED_COLS) if (k in fields) update[k] = fields[k];
    }

    if (main_currency !== undefined || addons !== undefined || display !== undefined) {
      const newDetails = { ...(trip.details || {}) };
      if (typeof main_currency === 'string' && main_currency) newDetails.main_currency = main_currency;
      if (display && typeof display === 'object') {
        // Shallow-merge so unrelated display flags are preserved.
        newDetails.display = { ...(trip.details?.display || {}), ...display };
      }
      if (addons && typeof addons === 'object') {
        // Block enabling a PRO addon when the trip isn't Pro.
        const prev = (trip.details?.addons) || {};
        for (const key of Object.keys(addons)) {
          if (addons[key] === true && PRO_ADDON_SET.has(key) && prev[key] !== true && !tripIsPro) {
            // x-sentry-skip: НОРМАЛЬНЫЙ бизнес-«нет», а не сбой — это штатный вход
            // в апселл (не-Pro жмёт Pro-тумблер, клиент открывает предложение).
            // Пока отказ был 200, Sentry о нём не знал ВООБЩЕ; сделать его честным
            // 402, не пометив, значит завести событие на каждый показ апселла, то
            // есть зашумить мониторинг ровно по монетизационной дорожке. Тот же
            // приём и по той же причине, что у `createStripeCheckout`
            // (`TRIP_ALREADY_PRO`, 409). FORBIDDEN ниже НЕ помечен намеренно:
            // «залогинен, но нельзя» — сигнал, что интерфейс предложил действие
            // тому, кому оно недоступно; `_shared/http.ts` называет 403 отчётным.
            return jsonError(402, 'Pro required', 'PRO_REQUIRED', { ...corsHeaders, 'x-sentry-skip': '1' });
          }
        }
        // Shallow-merge so a partial addons body never wipes unrelated flags
        // (symmetric with the display merge above).
        newDetails.addons = { ...prev, ...addons };
      }
      update.details = newDetails;
    }

    if (Object.keys(update).length === 0) return Response.json({ ok: true }, { headers: corsHeaders });

    const { error } = await supabaseAdmin.from('trips').update(update).eq('id', tripId);
    if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

    return Response.json({ ok: true }, { headers: corsHeaders });
}));
