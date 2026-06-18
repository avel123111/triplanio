// Helpers that build platform option lists for ForkPartnerModal.
// Keeps the dialog itself generic and avoids duplicating URL-builders.
//
// All builders accept an optional `t` translator (from useI18nFormat) so that
// labels like "Find on …" / "Book on …" are localized. When `t` is not passed
// we fall back to the platform name (e.g. just "Booking.com") to avoid a crash.

import { DateTime } from 'luxon';
import { platformLogoUrl } from '@/lib/booking-platforms';
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
  const q = encodeURIComponent(cityEn);
  const viatorDest = visit?.cities?.viator_dest_id ?? visit?.viator_dest_id;
  // Viator affiliate ids (public partner ids); destination deep-link host.
  const VIATOR_REF = 'mcid=42383&pid=P00306202&medium=api&api_version=2.0';

  const list = [
    {
      key: 'viator',
      label: findOn(t, 'Viator'),
      hint: cityEn,
      logo: platformLogoUrl('viator', 'viator.com'),
      url: viatorDest
        ? `https://www.viator.com/x/d${viatorDest}-ttd?${VIATOR_REF}`
        : `https://www.viator.com/?${VIATOR_REF}`,
      provider: 'viator',
    },
    {
      key: 'getyourguide',
      label: findOn(t, 'GetYourGuide'),
      hint: cityEn,
      logo: platformLogoUrl('getyourguide', 'getyourguide.com'),
      url: cityEn ? `https://www.getyourguide.com/s/?q=${q}` : 'https://www.getyourguide.com/',
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

// HOTEL: Booking.com, Airbnb (+ Ostrovok, Yandex Travel for ru UI)
export function hotelPlatforms(visit, t, lang) {
  const tz = visit?.timezone || 'UTC';
  const checkin = localDate(visit?.start_date, tz);
  const checkout = ensureNextDay(checkin, localDate(visit?.end_date, tz));
  // Referral links use the canonical English city name (city_name_en) when
  // available — Booking/Airbnb match better on English; falls back to the
  // localized display name.
  const cityEn = visit?.city_name_en || visit?.city_name || '';
  const cityQuery = `${cityEn}${visit?.country ? ', ' + visit.country : ''}`;
  const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  const airbnbSlug = [cityEn, visit?.country].filter(Boolean).map(slugify).filter(Boolean).join('--')
    || encodeURIComponent(cityEn);

  // RU-market hotel partners (TravelPayouts): exact city via city_name_en slug +
  // country (en) + dates; fall back to the partner homepage when data is missing.
  const countryEn = countryNameEn(visit?.country_code);
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
      logo: platformLogoUrl('booking'),
      color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40',
      url: `https://www.booking.com/searchresults.html?${new URLSearchParams({
        ss: cityQuery, lang: 'en-us', group_adults: '2', no_rooms: '1', group_children: '0',
        ...(checkin && { checkin }), ...(checkout && { checkout }),
      }).toString()}`,
    },
    {
      key: 'airbnb',
      label: bookOn(t, 'Airbnb'),
      hint: cityQuery,
      logo: platformLogoUrl('airbnb'),
      color: 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/40',
      url: `https://www.airbnb.com/s/${airbnbSlug}/homes?${new URLSearchParams({
        adults: '2', ...(checkin && { checkin }), ...(checkout && { checkout }),
      }).toString()}`,
    },
    // RU-only partners (.ru sites via TravelPayouts). provider=travelpayouts.
    ...(lang === 'ru' ? [
      {
        key: 'ostrovok',
        label: bookOn(t, 'Островок'),
        hint: cityQuery,
        logo: 'https://img.wway.io/travelpayouts/brands/icon/459@svg',
        color: 'border-cyan-200 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200 hover:bg-cyan-100 dark:hover:bg-cyan-900/40',
        url: tpLink(459, 7038, ostrovokUrl),
        provider: 'travelpayouts',
      },
      {
        key: 'yandextravel',
        label: bookOn(t, 'Яндекс Путешествия'),
        hint: cityQuery,
        logo: 'https://img.wway.io/travelpayouts/brands/icon/193@svg',
        color: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/40',
        url: tpLink(193, 5916, yandexUrl),
        provider: 'travelpayouts',
      },
    ] : []),
  ];
}

// CAR RENTAL: Rentalcars + DiscoverCars search by city
export function carRentalPlatforms(trip, t) {
  const cityQuery = trip?.title || '';
  return [
    {
      key: 'rentalcars',
      label: findOn(t, 'Rentalcars'),
      hint: cityQuery,
      logo: platformLogoUrl('rentalcars'),
      color: 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/40 text-yellow-900 dark:text-yellow-200 hover:bg-yellow-100 dark:hover:bg-yellow-900/40',
      url: `https://www.rentalcars.com/`,
    },
    {
      key: 'discovercars',
      label: findOn(t, 'DiscoverCars'),
      hint: cityQuery,
      logo: platformLogoUrl('discovercars'),
      color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40',
      url: `https://www.discovercars.com/`,
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
      color: 'border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/40 text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/40',
      url: airaloUrl,
      provider: 'travelpayouts',
    },
    {
      key: 'yesim',
      label: bookOn(t, 'Yesim'),
      hint: t ? t('service.esim_choice_yesim_hint') : 'eSIM for travel',
      logo: 'https://yesim.app/favicon.ico',
      color: 'border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200 hover:bg-teal-100 dark:hover:bg-teal-900/40',
      url: yesimUrl,
      provider: 'travelpayouts',
    },
  ];
}

// INSURANCE: SafetyWing (nomad health insurance) + Ekta Traveling (affiliate)
// SafetyWing is still a direct URL (affiliate TBD); Ekta Traveling is an active affiliate link.
export function insurancePlatforms(t) {
  return [
    {
      key: 'safetywing',
      label: bookOn(t, 'SafetyWing'),
      hint: t ? t('service.insurance_safetywing_hint') : 'Nomad insurance · from $45/mo',
      logo: platformLogoUrl('safetywing'),
      color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40',
      url: 'https://safetywing.com/nomad-insurance/',
    },
    {
      key: 'ektatraveling',
      label: bookOn(t, 'Ekta Traveling'),
      hint: t ? t('service.insurance_ektatraveling_hint') : 'Travel & medical insurance',
      logo: platformLogoUrl('ektatraveling', 'ektatraveling.com'),
      color: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40',
      url: 'https://ektatraveling.tpx.lt/ej8OjLU3',
      provider: 'travelpayouts',
    },
  ];
}

// TRANSFER: Skyscanner (flights) + Omio (multi-modal) + Kiwi (+ Aviasales for ru UI)
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
    {
      key: 'skyscanner',
      label: findFlightsOn(t, 'Skyscanner'),
      hint: `${from} → ${to}`,
      logo: platformLogoUrl('skyscanner'),
      color: 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/40',
      url: `https://www.skyscanner.com/transport/flights/${encodeURIComponent(from)}/${encodeURIComponent(to)}/`,
    },
    {
      key: 'omio',
      label: findTicketsOn(t, 'Omio'),
      hint: `${from} → ${to}`,
      logo: platformLogoUrl('omio'),
      color: 'border-pink-200 dark:border-pink-800 bg-pink-50 dark:bg-pink-950/40 text-pink-800 dark:text-pink-200 hover:bg-pink-100 dark:hover:bg-pink-900/40',
      url: `https://www.omio.com/search-frontend/results/${encodeURIComponent(from)}/${encodeURIComponent(to)}`,
    },
    {
      key: 'kiwi',
      label: findOn(t, 'Kiwi.com'),
      hint: `${from} → ${to}`,
      logo: platformLogoUrl('kiwi'),
      color: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/40',
      url: `https://www.kiwi.com/en/search/results/${encodeURIComponent(from)}/${encodeURIComponent(to)}`,
    },
    // RU-only partner (.ru site via TravelPayouts). provider=travelpayouts.
    ...(lang === 'ru' ? [
      {
        key: 'aviasales',
        label: findFlightsOn(t, 'Aviasales'),
        hint: `${from} → ${to}`,
        logo: 'https://img.wway.io/travelpayouts/brands/icon/100@svg',
        color: 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/40',
        url: tpLink(100, 4114, aviasalesUrl),
        provider: 'travelpayouts',
      },
    ] : []),
  ];
}