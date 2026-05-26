// Helpers that build platform option lists for BookingChoiceDialog.
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

// HOTEL: Booking.com, Airbnb
export function hotelPlatforms(visit, t) {
  const tz = visit?.timezone || 'UTC';
  const checkin = localDate(visit?.start_datetime, tz);
  const checkout = ensureNextDay(checkin, localDate(visit?.end_datetime, tz));
  const cityQuery = `${visit?.city_name || ''}${visit?.country ? ', ' + visit.country : ''}`;
  const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  const airbnbSlug = [visit?.city_name, visit?.country].filter(Boolean).map(slugify).filter(Boolean).join('--')
    || encodeURIComponent(visit?.city_name || '');

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
    },
    {
      key: 'yesim',
      label: bookOn(t, 'Yesim'),
      hint: t ? t('service.esim_choice_yesim_hint') : 'eSIM for travel',
      logo: 'https://yesim.app/favicon.ico',
      color: 'border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200 hover:bg-teal-100 dark:hover:bg-teal-900/40',
      url: yesimUrl,
    },
  ];
}

// TRANSFER: Skyscanner (flights) + Omio (multi-modal) + Kiwi
export function transferPlatforms(fromVisit, toVisit, t) {
  const from = fromVisit?.city_name || '';
  const to = toVisit?.city_name || '';
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
  ];
}