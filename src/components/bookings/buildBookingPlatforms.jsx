// Helpers that build platform option lists for ForkPartnerModal.
// Keeps the dialog itself generic and avoids duplicating URL-builders.
//
// All builders accept an optional `t` translator (from useI18nFormat) so that
// labels like "Find on …" / "Book on …" are localized. When `t` is not passed
// we fall back to the platform name (e.g. just "Booking.com") to avoid a crash.

import { DateTime } from 'luxon';
import { faviconUrl } from '@/lib/booking-platforms';
import { countryNameEn } from '@/lib/countryNamesEn';
import { sortVisits } from '@/lib/validation';

function localDate(iso, tz) {
  if (!iso) return '';
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz || 'UTC').toFormat('yyyy-LL-dd');
}

function ensureNextDay(checkin, checkout) {
  if (!checkin) return checkout;
  if (checkout && checkout > checkin) return checkout;
  const d = new Date(checkin); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Helper: localized label "Book on <name>" / "Find on <name>" / "Find flights on <name>"
const bookOn = (t, name) => (t ? t('booking.book_on', { name }) : name);
const findOn = (t, name) => (t ? t('booking.find_on', { name }) : name);
const findFlightsOn = (t, name) => (t ? t('booking.find_flights_on', { name }) : name);
const findTicketsOn = (t, name) => (t ? t('booking.find_tickets_on', { name }) : name);

// Wrap a target URL in a TravelPayouts tp.media redirect (shared marker 654801).
// The target is passed as the encoded `u` param so attribution is preserved even
// for homepage fallbacks.
const tpLink = (campaignId, p, targetUrl) =>
  `https://tp.media/r?campaign_id=${campaignId}&marker=654801&p=${p}&trs=532202&u=${encodeURIComponent(targetUrl)}`;
// Date helpers for partner URLs: dd.LL.yyyy (Ostrovok) and ddLL / DDMM (Aviasales).
const dmyDot = (iso) => (iso ? DateTime.fromISO(iso).toFormat('dd.LL.yyyy') : '');
const ddmm = (iso) => (iso ? DateTime.fromISO(iso).toFormat('ddLL') : '');

// ACTIVITY: Viator (referral deep-link by destinationId) + GetYourGuide; Tripster
// and Sputnik8 are RU-only TravelPayouts partners (marker 654801, provider
// travelpayouts). City name is passed in English (cities.name_en / city_name_en).
// Each dynamic link falls back to the partner homepage (attribution preserved).
export function activityPlatforms(visit, t, lang) {
  const cityEn = visit?.city_name_en || visit?.cities?.name_en || visit?.city_name || '';
  const viatorDest = visit?.cities?.viator_dest_id ?? visit?.viator_dest_id;
  // Viator affiliate ids (public partner ids); destination deep-link host.
  const VIATOR_REF = 'mcid=42383&pid=P00306202&medium=api&api_version=2.0';

  // GetYourGuide affiliate deep-link: location slug (cities.getyourguide_id, e.g.
  // 'sorrento-l391') + partner attribution + the city-visit window as date_from/
  // date_to (plain YYYY-MM-DD dates; appended only when both are present). Falls
  // back to the attributed homepage when the city has no GYG location id.
  const GYG_BASE = 'partner_id=IMHPJIH&utm_medium=local_partners';
  const gygId = visit?.cities?.getyourguide_id ?? visit?.getyourguide_id;
  const gygDates = (visit?.start_date && visit?.end_date)
    ? `&date_from=${visit.start_date}&date_to=${visit.end_date}` : '';
  const gygUrl = gygId
    ? `https://www.getyourguide.com/${gygId}?${GYG_BASE}&cmp=fork_dialog${gygDates}`
    : `https://www.getyourguide.com/?${GYG_BASE}`;

  const list = [
    {
      key: 'viator',
      label: findOn(t, 'Viator'),
      hint: cityEn,
      // Canonical TravelPayouts brand SVG (icon 47); the generic Google favicon
      // fallback is unreliable for viator.com — see GetYourGuide below.
      logo: 'https://img.wway.io/travelpayouts/brands/icon/47@svg',
      url: viatorDest
        ? `https://www.viator.com/x/d${viatorDest}-ttd?${VIATOR_REF}`
        : `https://www.viator.com/?${VIATOR_REF}`,
      provider: 'viator',
    },
    {
      key: 'getyourguide',
      label: findOn(t, 'GetYourGuide'),
      hint: cityEn,
      // Canonical TravelPayouts brand SVG (icon 108). The generic Google
      // favicon fallback no longer resolves for getyourguide.com, so pin the
      // brand icon directly — same pattern as the other TP partners below.
      logo: 'https://img.wway.io/travelpayouts/brands/icon/108@svg',
      url: gygUrl,
      provider: 'getyourguide',
    },
  ];

  // RU-only activity partners (shown only when lang === 'ru').
  if (lang === 'ru') {
    list.push(
      {
        key: 'tripster',
        label: findOn(t, 'Tripster'),
        hint: cityEn,
        logo: 'https://img.wway.io/travelpayouts/brands/icon/11@svg',
        url: cityEn
          ? tpLink(11, 652, `https://experience.tripster.ru/experience/${cityEn}/`)
          : tpLink(11, 652, 'https://experience.tripster.ru/'),
        provider: 'travelpayouts',
      },
      {
        key: 'sputnik8',
        label: findOn(t, 'Sputnik8'),
        hint: cityEn,
        logo: 'https://img.wway.io/travelpayouts/brands/icon/21@svg',
        // '/ru/' is the partner's static segment; only the city slug is dynamic.
        url: cityEn
          ? tpLink(21, 656, `https://www.sputnik8.com/ru/${cityEn.toLowerCase()}`)
          : tpLink(21, 656, 'https://www.sputnik8.com/ru/'),
        provider: 'travelpayouts',
      },
    );
  }

  return list;
}

// HOTEL: Booking.com, Expedia (+ Ostrovok, Yandex Travel for ru UI).
// Booking + Expedia are affiliate deep-links attributed to the Stay22 channel
// (provider='stay22', same name as the dynamic Stay22 list — see Stay22HotelList).
// Deep-links need the English city + English country name; when either is missing
// we fall back to the Stay22 smart-link (attribution preserved).
export function hotelPlatforms(visit, t, lang) {
  const tz = visit?.timezone || 'UTC';
  const checkin = localDate(visit?.start_date, tz);
  const checkout = ensureNextDay(checkin, localDate(visit?.end_date, tz));
  // Canonical English city (city_name_en) + English country (via ISO code).
  const cityEn = visit?.city_name_en || visit?.city_name || '';
  const countryEn = countryNameEn(visit?.country_code);
  const hasGeo = Boolean(cityEn && countryEn);
  const cityQuery = hasGeo ? `${cityEn}, ${countryEn}` : '';
  const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

  // Booking.com affiliate deep-link (affiliate_id/aid 1607597). ss = "City, Country"
  // (en); dates appended when present. Fallback = Stay22 Booking smart-link.
  const bookingUrl = hasGeo
    ? `https://www.booking.com/searchresults.ru.html?${new URLSearchParams({
        affiliate_id: '1607597', aid: '1607597', ss: cityQuery,
        src: 'searchresults', ac_langcode: 'en',
        ...(checkin && { checkin }), ...(checkout && { checkout }),
      }).toString()}`
    : 'https://booking.stay22.com/triplanio/60Is3HmgWd';

  // Expedia affiliate deep-link (PHG). destination = "City Country" (en, %20-encoded);
  // static affiliate params per the partner program. Fallback = Stay22 Expedia link.
  const EXPEDIA_AFF = 'clickref=1100lDa8VoKr&affcid=ES.DIRECT.PHG.1011l45458.0&ref_id=1100lDa8VoKr&my_ad=AFF.ES.DIRECT.PHG.1011l45458.0&afflid=1100lDa8VoKr&affdtl=PHG.1100lDa8VoKr.&button_referral_source=other';
  const expediaUrl = hasGeo
    ? `https://www.expedia.com/Hotel-Search?destination=${encodeURIComponent(`${cityEn} ${countryEn}`)}${checkin ? `&startDate=${checkin}` : ''}${checkout ? `&endDate=${checkout}` : ''}&${EXPEDIA_AFF}`
    : 'https://expedia.stay22.com/triplanio/wVI-072pZ1';

  // RU-market hotel partners (TravelPayouts): exact city via city_name_en slug +
  // country (en) + dates; fall back to the partner homepage when data is missing.
  const cityEnSlug = visit?.city_name_en ? slugify(visit.city_name_en).toLowerCase() : '';
  const ostrovokUrl = (countryEn && cityEnSlug)
    ? `https://ostrovok.ru/hotel/${countryEn}/${cityEnSlug}/${checkin && checkout ? `?dates=${dmyDot(checkin)}-${dmyDot(checkout)}` : ''}`
    : 'https://ostrovok.ru/';
  const yandexUrl = cityEnSlug
    ? `https://travel.yandex.ru/hotels/${cityEnSlug}/${checkin && checkout ? `?checkinDate=${checkin}&checkoutDate=${checkout}` : ''}`
    : 'https://travel.yandex.ru/hotels/';

  return [
    {
      key: 'booking',
      label: bookOn(t, 'Booking.com'),
      hint: cityQuery,
      logo: 'https://img.wway.io/travelpayouts/brands/icon/84@svg',
      url: bookingUrl,
      provider: 'stay22',
    },
    {
      key: 'expedia',
      label: bookOn(t, 'Expedia'),
      hint: cityQuery,
      logo: 'https://img.wway.io/travelpayouts/brands/icon/594@svg',
      url: expediaUrl,
      provider: 'stay22',
    },
    // RU-only partners (.ru sites via TravelPayouts). provider=travelpayouts.
    ...(lang === 'ru' ? [
      {
        key: 'ostrovok',
        label: bookOn(t, 'Островок'),
        hint: cityQuery,
        logo: 'https://img.wway.io/travelpayouts/brands/icon/459@svg',
        url: tpLink(459, 7038, ostrovokUrl),
        provider: 'travelpayouts',
      },
      {
        key: 'yandextravel',
        label: bookOn(t, 'Яндекс Путешествия'),
        hint: cityQuery,
        logo: 'https://img.wway.io/travelpayouts/brands/icon/193@svg',
        url: tpLink(193, 5916, yandexUrl),
        provider: 'travelpayouts',
      },
    ] : []),
  ];
}

// CAR RENTAL: GetRentacar + EconomyBookings — both TravelPayouts affiliate
// partners (provider=travelpayouts). Links are static *.tpx.lt referral links
// (no trip params, no fallback), like Ekta Traveling. Logos are TravelPayouts
// SVG icons.
export function carRentalPlatforms(trip, t) {
  return [
    {
      key: 'getrentacar',
      label: findOn(t, 'GetRentacar'),
      hint: t ? t('service.car_getrentacar_hint') : 'Car rental worldwide',
      logo: 'https://img.wway.io/travelpayouts/brands/icon/222@svg',
      url: 'https://getrentacar.tpx.lt/RB21f57P',
      provider: 'travelpayouts',
    },
    {
      key: 'economybookings',
      label: findOn(t, 'EconomyBookings'),
      hint: t ? t('service.car_getrentacar_hint') : 'Car rental worldwide',
      logo: 'https://img.wway.io/travelpayouts/brands/icon/10@svg',
      url: 'https://economybookings.tpx.lt/EozXdo4z?erid=2VtzqvEF14M',
      provider: 'travelpayouts',
    },
  ];
}

// eSIM: Airalo. URL is country-specific when we can resolve the first transit
// city's country to an English slug (via ISO 3166-1 code). When the trip has
// no transit city or the country is unknown, we fall back to the generic
// Airalo affiliate link.
const AIRALO_FALLBACK = 'https://airalo.tpx.lt/GtyGmpEK';
const AIRALO_COUNTRY_TPL = 'https://tp.media/r?campaign_id=541&marker=654801&p=8310&trs=532202&u=https%3A%2F%2Fwww.airalo.com%2Fes-ES%2F{{country}}-esim';

const YESIM_FALLBACK = 'https://yesim.tpx.lt/YU22rh1A';
const YESIM_COUNTRY_TPL = 'https://tp.media/r?campaign_id=224&marker=654801&p=5998&trs=532202&u=https%3A%2F%2Fyesim.tech%2Fcountry%2F{{country}}%2F';

export function esimPlatforms(visits, t) {
  let countrySlug = null;
  if (Array.isArray(visits) && visits.length > 0) {
    const ordered = sortVisits(visits);
    const firstTransit = ordered.find((v) => v.kind !== 'start' && v.kind !== 'end');
    countrySlug = firstTransit ? countryNameEn(firstTransit.country_code) : null;
  }
  const airaloUrl = countrySlug ? AIRALO_COUNTRY_TPL.replace('{{country}}', countrySlug) : AIRALO_FALLBACK;
  const yesimUrl = countrySlug ? YESIM_COUNTRY_TPL.replace('{{country}}', countrySlug) : YESIM_FALLBACK;
  return [
    {
      key: 'airalo',
      label: bookOn(t, 'Airalo'),
      hint: t ? t('service.esim_choice_airalo_hint') : 'eSIM for travel',
      logo: 'https://www.airalo.com/favicon.ico',
      url: airaloUrl,
      provider: 'travelpayouts',
    },
    {
      key: 'yesim',
      label: bookOn(t, 'Yesim'),
      hint: t ? t('service.esim_choice_yesim_hint') : 'eSIM for travel',
      logo: 'https://yesim.app/favicon.ico',
      url: yesimUrl,
      provider: 'travelpayouts',
    },
  ];
}

// INSURANCE: SafetyWing + Ekta Traveling (both static homepage links, no active
// affiliate tracking → provider NULL) + Sravni.ru & Tripinsurance.ru for the ru
// UI (static *.tpx.lt referral links, provider=travelpayouts). Logos are the
// partners' own brand assets (SafetyWing/Ekta) or TravelPayouts SVG icons (RU).
export function insurancePlatforms(t, lang) {
  return [
    {
      key: 'safetywing',
      label: bookOn(t, 'SafetyWing'),
      hint: t ? t('service.insurance_safetywing_hint') : 'Nomad insurance · from $45/mo',
      logo: 'https://s3-eu-west-1.amazonaws.com/tpd/logos/5b026ad311a7aa000198b534/0x0.png',
      url: 'https://safetywing.com/',
      // No provider → logged as NULL (no active affiliate link).
    },
    {
      key: 'ektatraveling',
      label: bookOn(t, 'Ekta Traveling'),
      hint: t ? t('service.insurance_ektatraveling_hint') : 'Travel & medical insurance',
      logo: 'https://content.flexlinks.com/sharedimages/ProgramSquareLogo/233032.png',
      url: 'https://ektatraveling.com/',
      // No provider → logged as NULL (static homepage link).
    },
    // RU-only partners (.ru via TravelPayouts). provider=travelpayouts.
    ...(lang === 'ru' ? [
      {
        key: 'sravni',
        label: bookOn(t, 'Сравни.ру'),
        hint: t ? t('service.insurance_sravni_hint') : 'Compare insurance',
        logo: 'https://img.wway.io/travelpayouts/brands/icon/49@svg',
        url: 'https://sravni.tpx.lt/CqRGyRjC?erid=2VtzqvjtkhF',
        provider: 'travelpayouts',
      },
      {
        key: 'tripinsurance',
        label: bookOn(t, 'Tripinsurance'),
        hint: t ? t('service.insurance_tripinsurance_hint') : 'Travel insurance',
        logo: 'https://img.wway.io/travelpayouts/brands/icon/55@svg',
        url: 'https://tripinsurance.tpx.lt/JKNaa6My?erid=2VtzqvmNjyb',
        provider: 'travelpayouts',
      },
    ] : []),
  ];
}

// TRANSFER: Skyscanner + Omio (no active affiliate program → homepage links,
// provider NULL) + Aviasales + Яндекс Путешествия (both ru UI, travelpayouts).
export function transferPlatforms(fromVisit, toVisit, t, lang) {
  const from = fromVisit?.city_name || '';
  const to = toVisit?.city_name || '';
  // Aviasales (TravelPayouts) flight search: origin/dest IATA city codes + flight
  // date (DDMM) + 1 pax. The transfer fork has no own date → use the arrival day
  // (toVisit.start_date), fall back to the departure city's last day. If either
  // IATA city code is missing, link to the Aviasales homepage instead.
  // iata now lives on the cities dimension, embedded by getTripDetails; fall back
  // to the legacy flat field for any cached payloads.
  const fromIata = fromVisit?.cities?.iata_code ?? fromVisit?.iata_city_code;
  const toIata = toVisit?.cities?.iata_code ?? toVisit?.iata_city_code;
  const flightDate = toVisit?.start_date || fromVisit?.end_date;
  const aviasalesUrl = (fromIata && toIata && flightDate)
    ? `https://www.aviasales.ru/search/${fromIata}${ddmm(flightDate)}${toIata}1`
    : 'https://www.aviasales.ru/';
  return [
    // Skyscanner / Omio: affiliate program inactive → plain homepage links, no
    // route deep-link (so no from→to hint) and provider omitted → logged NULL.
    {
      key: 'skyscanner',
      label: findFlightsOn(t, 'Skyscanner'),
      logo: faviconUrl('skyscanner.com'),
      url: 'https://skyscanner.com/',
    },
    {
      key: 'omio',
      label: findTicketsOn(t, 'Omio'),
      logo: 'https://img.wway.io/travelpayouts/brands/icon/91@svg',
      url: 'https://www.omio.com/',
    },
    // RU-only partners (.ru via TravelPayouts). provider=travelpayouts.
    ...(lang === 'ru' ? [
      {
        key: 'aviasales',
        label: findFlightsOn(t, 'Aviasales'),
        hint: `${from} → ${to}`,
        logo: 'https://img.wway.io/travelpayouts/brands/icon/100@svg',
        url: tpLink(100, 4114, aviasalesUrl),
        provider: 'travelpayouts',
      },
      {
        // Reuses the hotels' yandextravel key/logo (icon 193). Static tpx.lt
        // referral link (no route deep-link) → keep the from→to hint as context.
        key: 'yandextravel',
        label: findTicketsOn(t, 'Яндекс Путешествия'),
        hint: `${from} → ${to}`,
        logo: 'https://img.wway.io/travelpayouts/brands/icon/193@svg',
        url: 'https://yandex.tpx.lt/dovrPB5u?erid=2Vtzqw6eae5',
        provider: 'travelpayouts',
      },
    ] : []),
  ];
}