/**
 * render-share-card (TRIP-193)
 *
 * Generates a shareable story/post image for a trip: branded background, a map
 * sticker with the real route, key numbers, QR to the landing page. Rendered
 * server-side (resvg-wasm) and cached in the `share-cards` bucket by a content
 * hash, so repeat shares are free and the 10/hour limit only counts real renders.
 *
 * POST { trip_id, format?: 'story'|'post', lang?: 'ru'|'en'|'es' }
 *   auth: JWT; caller must be an active participant of the trip.
 * 200 { url, cached, width, height }
 *   | { code: 'rate_limited', retry_after_seconds }
 *   | { code: 'no_transit_cities' }
 * 4xx: Unauthorized / trip_not_found / forbidden
 *
 * verify_jwt: defaults to TRUE (user function; NOT listed in config.toml).
 */
import { corsFor } from '../_shared/cors.ts';
import { getRequestUser, supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';
import { recordHit, underLimit } from '../_shared/rateLimit.ts';
import { pickLang } from '../_shared/tgLang.ts';
import {
  BRAND, cardStrings, dateRangeLabel, factsLine, formatNumber,
} from '../_shared/shareCardText.ts';
import {
  cityLabel, dateSpan, routeDistanceKm, tripDays,
  uniqueCityCount, uniqueCountryCount, uniqueTransitCities, type Visit,
} from './stats.ts';
import { buildStaticMapUrl, fetchStaticMap } from './mapbox.ts';
import { buildCardSvg, mapSize, TEMPLATE_VERSION, type Format } from './template.ts';
import { base64, defaultBgDataUri, renderPng } from './render.ts';

const BUCKET = 'share-cards';
const RATE_MAX = 10;
const RATE_WINDOW = 3600;
// TEMP (TRIP-193): rate limit disabled for testing. Flip back to `true` before
// launch - the check/record logic below is kept intact, just gated by this flag.
const RATE_LIMIT_ENABLED = false;

const LANDING = 'https://www.triplanio.com/';

function qrUrlFor(tripId: string, format: Format): string {
  const p = new URLSearchParams({
    utm_source: 'share_card',
    utm_medium: format,
    utm_campaign: 'trip_share',
    utm_content: tripId,
  });
  return `${LANDING}?${p.toString()}`;
}

async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });

    const body = await req.json().catch(() => ({}));
    const tripId = body.trip_id;
    const format: Format = body.format === 'post' ? 'post' : 'story';
    const lang = pickLang(body.lang);
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

    // ---- content hash / cache ----
    const hashInput = JSON.stringify({
      v: TEMPLATE_VERSION, format, lang,
      title: trip.title || '',
      cities: transit.map((c) => [c.geonameid ?? c.city_name_en, c.latitude, c.longitude, c.position]),
      allPts: visits.map((v) => [v.latitude, v.longitude]),
      dates: [startISO, endISO], participants,
    });
    const hash = await sha1Hex(hashInput);
    const path = `${tripId}/${hash}.png`;
    const OUT_SIZE: Record<Format, { w: number; h: number }> = {
      story: { w: 1080, h: 1920 },
      post: { w: 1080, h: 1350 },
    };
    const { w: outW, h: outH } = OUT_SIZE[format];

    const { data: existing } = await supabaseAdmin.storage.from(BUCKET).list(tripId, { search: `${hash}.png`, limit: 1 });
    if (existing && existing.length > 0) {
      const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
      return Response.json({ url: pub.publicUrl, cached: true, width: outW, height: outH }, { headers: cors });
    }

    // ---- rate limit: CHECK only here; the hit is recorded AFTER a successful
    // render+upload (below), so a failed render never burns the user's quota. ----
    if (RATE_LIMIT_ENABLED && !(await underLimit('share_card', user.id, RATE_MAX, RATE_WINDOW))) {
      return Response.json({ code: 'rate_limited', retry_after_seconds: RATE_WINDOW }, { headers: cors });
    }

    // ---- render ----
    const s = cardStrings(lang);
    const from = cityLabel(transit[0], lang);
    const to = cityLabel(transit[transit.length - 1], lang);
    const data = {
      title: trip.title || from,
      route: transit.length > 1 ? `${from} - ${to}` : from,
      dateLabel: startISO && endISO ? dateRangeLabel(lang, startISO, endISO) : '',
      facts: factsLine(lang, { days, countries, cities, friends: participants }), // "friends" slot = participants (members + creator)
      distanceStr: formatNumber(distanceKm),
      distanceLabel: s.distance,
      cta: s.cta,
      tagline: s.tagline,
      site: s.site,
      brand: BRAND,
    };

    const mapDims = mapSize(format);
    const mapToken = Deno.env.get('MAPBOX_TOKEN') || '';
    const routePts = transit
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => ({ lat: Number(c.latitude), lng: Number(c.longitude) }));
    const mapBin = await fetchStaticMap(buildStaticMapUrl(routePts, mapDims.w, mapDims.h, mapToken));
    const mapDataUri = mapBin ? `data:image/png;base64,${base64(mapBin)}` : null;

    const bg = defaultBgDataUri();
    const svg = buildCardSvg(format, data, bg, mapDataUri, qrUrlFor(tripId, format));
    const png = await renderPng(svg, outW);

    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
      .upload(path, png, { contentType: 'image/png', upsert: true });
    if (upErr) {
      console.error('share-card upload failed', upErr.message);
      return Response.json({ error: 'storage_failed' }, { status: 500, headers: cors });
    }
    if (RATE_LIMIT_ENABLED) await recordHit('share_card', user.id); // count only a genuinely rendered card
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    return Response.json({ url: pub.publicUrl, cached: false, width: outW, height: outH }, { headers: cors });
  } catch (e) {
    console.error('render-share-card error', (e as Error).message);
    return Response.json({ error: 'internal' }, { status: 500, headers: cors });
  }
});
