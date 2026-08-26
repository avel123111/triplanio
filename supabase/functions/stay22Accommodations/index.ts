/**
 * stay22Accommodations
 *
 * Thin proxy to the Stay22 Accommodations API (v2 beta), used by the trip
 * editor's hotel "fork" side-panel to show real bookable stays for a city.
 *
 * Why a proxy: Stay22 v2 authenticates with an `X-API-KEY` header. The key must
 * never reach the browser, so the client calls this function and we attach the
 * secret server-side (same pattern as placesAutocomplete + GOOGLE_MAPS_API_KEY).
 *
 * POST body:
 *   { lat, lng | nelat, nelng, swlat, swlng,
 *     radius?, checkin?, checkout?, currency?, lang?, page?,
 *     adults?, children?, rooms?, provider? }
 *
 * Гео принимается ДВУМЯ способами, и они дают разные выборки: ТОЧКА — «~140
 * ближайших» (в плотном городе это несколько кварталов), ПРЯМОУГОЛЬНИК —
 * выборку, размазанную по площади. Разбор обоих и цифры замеров — в `query.ts`,
 * туда же вынесена сборка строки запроса, чтобы её пинал `deno test`.
 * Прямоугольник сейчас ТОЛЬКО пробрасывается: клиент его ещё не шлёт, так что
 * на сегодняшнем теле строка запроса не изменилась ни на знак (тест
 * «без коробки строка запроса не изменилась ни на знак»).
 *
 * Третий способ, `address`, НЕ используется. Раньше тут была
 * ветка поиска по строке `address`, и она выигрывала у координат; замер по
 * живому API показал, что адресный геокодер Stay22 резолвит имя города в
 * геометрический центр МУНИЦИПАЛИТЕТА, который у крупных городов лежит вне
 * города: Лос-Анджелес — 26 км, Рим — 14 км (соседние коммуны Кастелли Романи),
 * Париж — 9 км (Монтрёй, Нуази-ле-Сек), Токио — 132 км. По координатам те же
 * города отдают 100% выдачи в пределах 5 км от центра, и наборы не пересекаются
 * вовсе. Форма строки роли не играла (проверены три написания).
 *
 * `radius` (МЕТРЫ) остаётся необязательным и клиентом не шлётся: дефолт Stay22 =
 * 10 км, и он сам ведёт себя адаптивно — в плотном городе ближайшие сотни отелей
 * укладываются в 0.5–1.5 км, в редком растягиваются до 10 км и захватывают
 * соседние городки. На 97 реальных городах прода дефолта хватает всем, кроме
 * стран, где у Stay22 инвентаря нет вообще ни при каком радиусе.
 *
 * We pin aid=triplanio, campaign=fork_api_search, cluster=false. We do NOT pin a
 * provider: Stay22 returns each result's available suppliers and the client picks
 * the first one (supplier-agnostic); `provider` stays a pass-through for a caller
 * that wants one supplier. `pageSize` is client-driven (default 10, clamped
 * 1..100) so the map-badge overlay can request the full page in one go while the
 * list paginates in lockstep (TRIP-140).
 *
 * Returns the Stay22 payload pass-through: { meta, _links, results }.
 * Nothing is persisted — the side-panel fetches on open and renders client-side.
 */

import { withHandler } from '../_shared/http.ts';
import { requireUser } from '../_shared/supabaseAdmin.ts';
import { buildStay22Query, locationError } from './query.ts';

const STAY22_BASE = 'https://api.stay22.com/v2/accommodations';

Deno.serve(withHandler('stay22Accommodations', async (req, corsHeaders) => {
    const user = await requireUser(req);

    const apiKey = Deno.env.get('STAY22_API_KEY');
    if (!apiKey) return Response.json({ error: 'STAY22_API_KEY not configured' }, { status: 500, headers: corsHeaders });

    const body = await req.json();

    const badLocation = locationError(body);
    if (badLocation) {
      return Response.json({ error: badLocation }, { status: 400, headers: corsHeaders });
    }

    const params = buildStay22Query(body);

    const res = await fetch(`${STAY22_BASE}?${params}`, {
      headers: { 'X-API-KEY': apiKey, accept: 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[stay22Accommodations] upstream error', res.status, text.slice(0, 500));
      // Carry the real upstream status in the canonical `code` (TRIP-441): the edge
      // seam's Sentry reporter reads `body.code`, so `upstream_429`/`upstream_5xx`
      // reaches monitoring and the bare "responded 502" becomes diagnosable (is
      // Stay22 rate-limiting us, down, or are we sending a bad request?). The client
      // path is unchanged — a 502 surfaces as a transport error it already handles.
      return Response.json(
        { error: 'stay22_upstream_error', code: `upstream_${res.status}`, status: res.status },
        { status: 502, headers: corsHeaders },
      );
    }

    const data = await res.json();
    return Response.json(
      { meta: data.meta ?? null, _links: data._links ?? null, results: data.results ?? [] },
      { headers: corsHeaders },
    );
}));
