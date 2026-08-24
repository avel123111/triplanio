/**
 * render-share-card (TRIP-193)
 *
 * Returns the shareable story/post card as an SVG for the CLIENT to render in the
 * browser (branded background, a map sticker with the real route, key numbers, QR
 * to the landing page). No server-side rasterisation - rasterising in the edge
 * isolate is what intermittently blew the CPU limit (HTTP 546, cold isolate).
 *
 * Two modes (body.mode):
 *   'overlay'  -> the frame SVG only (transparent map hole), drawn by the client
 *                 over the live preview map.
 *   'card_svg' -> the full card SVG with fonts embedded and the map left as a
 *                 placeholder; the client injects its own high-res map snapshot
 *                 and rasterises SVG -> PNG in the browser (default).
 *
 * POST { trip_id, format?: 'story'|'post', lang?: 'ru'|'en'|'es',
 *        mode?: 'overlay'|'card_svg' }
 *   auth: JWT; caller must be an active participant of the trip.
 * 200 overlay:  { svg, width, height, slot, backgrounds } — backgrounds = публичные
 *               URL пресет-фонов из бакета `card-bg-presets` (дверь экрана
 *               конструктора, TRIP-374: каталог фонов едет тем же кругом, что и
 *               рамка; подменяет фон КЛИЕНТ — см. src/lib/shareCardBg.js).
 *     card_svg: { svg, width, height, slot } | { code: 'no_transit_cities' }
 * 4xx: Unauthorized / trip_not_found / forbidden
 *
 * verify_jwt: defaults to TRUE (user function; NOT listed in config.toml).
 */
import { corsFor } from '../_shared/cors.ts';
import { captureEdgeError } from '../_shared/sentry.ts';
import { jsonError } from '../_shared/http.ts';
import { getRequestUser, supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';
import { pickLang } from '../_shared/tgLang.ts';
import {
  BRAND, cardStrings, dateParts, factsLine, formatNumber,
} from '../_shared/shareCardText.ts';
import { withViralMarks } from '../_shared/viralLink.ts';
import {
  cityLabel, dateSpan, routeDistanceKm, tripDays,
  uniqueCityCount, uniqueCountryCount, uniqueTransitCities, type Visit,
} from './stats.ts';
import { buildCardSvg, cardSize, mapSlot, type Format } from './template.ts';
import { fontFaceStyle } from './fontFaces.ts';
import { defaultBgDataUri } from './render.ts';

// Token the client swaps for its own high-res map data URI in card_svg mode.
const MAP_PLACEHOLDER = '__SHARE_CARD_MAP__';

// Публичный бакет пресет-фонов карточки. Таблицы-каталога НЕТ намеренно: на фон
// никто не ссылается персистентно (карточка = PNG в момент генерации), порядок
// задаёт префикс имени файла, снятие с витрины = удаление файла (см. миграцию
// card_bg_presets_bucket). Листинг только здесь, под service_role — политик на
// бакете ноль (TRIP-48), фронт напрямую не листает.
const BG_BUCKET = 'card-bg-presets';
const BG_LIST_LIMIT = 60;
const IMAGE_FILE_RE = /\.(webp|png|jpe?g)$/i;

/** Публичные URL пресет-фонов, по возрастанию имени (префикс = порядок).
 *  Fail-soft: сбой листинга репортится и отдаёт пустой список — конструктор
 *  живёт со «Стандартом» и своим фото, рамка важнее карусели. */
async function listCardBackgrounds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin.storage
    .from(BG_BUCKET)
    .list('', { limit: BG_LIST_LIMIT, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  return (data || [])
    .filter((f) => IMAGE_FILE_RE.test(f.name))
    .map((f) => supabaseAdmin.storage.from(BG_BUCKET).getPublicUrl(f.name).data.publicUrl);
}

// The canonical host: the apex 307s here, and the campaign mark is stored
// per host, so a QR pointing at the apex would strand the mark in the wrong jar.
const LANDING = 'https://www.triplanio.com/';

// Marks aligned with the other three viral links (TRIP-329): `viral` in the
// medium so one filter separates paid from viral, and the trip id in
// utm_campaign so "which trips bring people in" is a single field everywhere —
// and reaches `users.signup_utm_campaign`, which has no utm_content twin. The
// format moves into utm_content, which the trip id used to occupy.
function qrUrlFor(tripId: string, format: Format): string {
  return withViralMarks(LANDING, 'share_card', tripId, format);
}

// sentry: manual — returns an SVG image, not the {error,code} JSON contract withHandler renders.
Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonError(401, 'Unauthorized', 'UNAUTHENTICATED', cors);

    const body = await req.json().catch(() => ({}));
    const tripId = body.trip_id;
    const format: Format = body.format === 'post' ? 'post' : 'story';
    const lang = pickLang(body.lang);
    // 'overlay' = the frame ONLY (transparent hole where the map goes), shown in
    // the client preview over the live interactive map. 'card_svg' = the full card
    // SVG with the map placeholder, which the client rasterises in the browser.
    const mode: 'overlay' | 'card_svg' = body.mode === 'overlay' ? 'overlay' : 'card_svg';
    if (!tripId) return Response.json({ error: 'trip_id required' }, { status: 400, headers: cors });

    if (!(await isCallerParticipant(tripId, user.id))) {
      return Response.json({ error: 'forbidden' }, { status: 403, headers: cors });
    }

    // ---- data ----
    const { data: trip } = await supabaseAdmin
      .from('trips').select('title').eq('id', tripId).single();
    if (!trip) return Response.json({ error: 'trip_not_found' }, { status: 404, headers: cors });

    const { data: rawVisits } = await supabaseAdmin
      .from('city_visits')
      .select('position, city_name_en, name_i18n, country_code, latitude, longitude, kind, geonameid, start_date, end_date')
      .eq('trip_id', tripId)
      .order('position');
    const visits = (rawVisits || []) as Visit[];

    const transit = uniqueTransitCities(visits);
    if (transit.length === 0) {
      return Response.json({ code: 'no_transit_cities' }, { headers: cors });
    }

    const { count: memberCount } = await supabaseAdmin
      .from('trip_members').select('id', { count: 'exact', head: true })
      .eq('trip_id', tripId).eq('status', 'active');
    const activeMembers = memberCount || 0;

    const [startISO, endISO] = dateSpan(visits);
    const days = tripDays(startISO, endISO);
    const cities = uniqueCityCount(visits);
    const countries = uniqueCountryCount(visits);
    const distanceKm = routeDistanceKm(visits);
    const participants = activeMembers + 1; // + creator (matches app travel-stats rule)

    // ---- card text/data ----
    const s = cardStrings(lang);
    const from = cityLabel(transit[0], lang);
    const to = cityLabel(transit[transit.length - 1], lang);
    const dp = startISO && endISO ? dateParts(lang, startISO, endISO) : { month: '', day: '', rest: '' };
    const data = {
      title: trip.title || from,
      route: transit.length > 1 ? `${from} - ${to}` : from,
      dateMonth: dp.month,
      dateDay: dp.day,
      dateRest: dp.rest,
      facts: factsLine(lang, { days, countries, cities, friends: participants }), // "friends" slot = participants (members + creator)
      distanceStr: formatNumber(distanceKm),
      distanceLabel: s.distance,
      cta: s.cta,
      tagline: s.tagline,
      promo: s.promo,
      site: s.site,
      brand: BRAND,
    };
    const { w: outW, h: outH } = cardSize(format);
    const slot = mapSlot(format); // map window rect within the card (for the client)

    // ---- overlay mode: the frame SVG only (transparent map hole), drawn by the
    // client over the live interactive preview map. Fonts are embedded (@font-face)
    // so the browser draws the frame with the SAME glyphs as the final render -
    // device-invariant, no dependence on page fonts. ----
    if (mode === 'overlay') {
      const svg = buildCardSvg(format, data, defaultBgDataUri(), null, qrUrlFor(tripId, format), true, fontFaceStyle());
      const backgrounds = await listCardBackgrounds().catch(async (e) => {
        await captureEdgeError(e, 'render-share-card');
        return [] as string[];
      });
      return Response.json({ svg, width: outW, height: outH, slot, backgrounds }, { headers: cors });
    }

    // ---- card_svg mode (default): the FULL card SVG (fonts embedded, map left as
    // the "__MAP__" placeholder) for the client to rasterise in the browser. The
    // client injects its own high-res map snapshot into the placeholder, then draws
    // SVG -> canvas -> PNG. Layout stays authored in ONE place (buildCardSvg); the
    // client only paints. ----
    const svg = buildCardSvg(format, data, defaultBgDataUri(), MAP_PLACEHOLDER, qrUrlFor(tripId, format), false, fontFaceStyle());
    return Response.json({ svg, width: outW, height: outH, slot }, { headers: cors });
  } catch (e) {
    // sentry: manual — this function opts out of withHandler (returns SVG/JSON on
    // its own contract), so its genuine 500 path must self-report here.
    await captureEdgeError(e, 'render-share-card');
    console.error('render-share-card error', (e as Error).message);
    return Response.json({ error: 'internal' }, { status: 500, headers: cors });
  }
});
