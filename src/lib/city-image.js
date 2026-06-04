/**
 * City image utilities.
 *
 * `useCityImageForVisits` returns, on the fly, the Wikipedia/Wikimedia cover
 * image for the FIRST transit city of a trip (the same source used by
 * `CityHero`). Nothing is persisted - the image is just fetched in the
 * browser and cached for the page's lifetime.
 */

import { useEffect, useState } from 'react';

// Map country code → preferred Wikipedia language code.
// Kept in sync with components/views/CityHero.jsx - same heuristic.
const COUNTRY_TO_LANG = {
  RU: 'ru', BY: 'ru', KZ: 'ru', UA: 'uk',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es',
  FR: 'fr', BE: 'fr',
  DE: 'de', AT: 'de', CH: 'de',
  IT: 'it', PT: 'pt', BR: 'pt', NL: 'nl', PL: 'pl', JP: 'ja', CN: 'zh',
  TR: 'tr', GR: 'el',
};

function getLangCandidates(visit) {
  const langs = ['en'];
  const code = visit?.country_code?.toUpperCase();
  const native = code && COUNTRY_TO_LANG[code];
  if (native && native !== 'en') langs.unshift(native);
  if (!langs.includes('ru')) langs.push('ru');
  return langs;
}

// In-memory cache so we don't re-fetch the same city on every render / route change.
const imageCache = new Map(); // key: `${lang0}|${cityName}` → url|null

async function fetchCityImage(cityName, langs) {
  const cacheKey = `${langs.join(',')}|${cityName}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  for (const lang of langs) {
    try {
      const q = encodeURIComponent(cityName);
      const res = await fetch(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${q}?redirect=true`,
        { headers: { Accept: 'application/json' } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const src = data?.originalimage?.source || data?.thumbnail?.source;
      if (src) {
        imageCache.set(cacheKey, src);
        return src;
      }
    } catch {
      // try next lang
    }
  }
  imageCache.set(cacheKey, null);
  return null;
}

/**
 * Pick the "first intermediate" visit for the cover image:
 *   1. first visit with kind === 'transit'
 *   2. otherwise, first visit with a city_name
 */
export function pickCoverVisit(visits = []) {
  if (!Array.isArray(visits) || visits.length === 0) return null;
  // Sort by start_datetime so "first transit" = chronologically first intermediate city,
  // not whatever order the list happened to be in.
  const sorted = [...visits].sort((a, b) => {
    const ta = a?.start_date ? new Date(a.start_date).getTime() : Number.POSITIVE_INFINITY;
    const tb = b?.start_date ? new Date(b.start_date).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  return (
    sorted.find(v => v?.city_name && v?.kind === 'transit') ||
    sorted.find(v => v?.city_name) ||
    null
  );
}

/**
 * React hook: returns the cover image URL for a trip's visits (fetched live
 * from Wikipedia for the first transit city), or null until it resolves /
 * if nothing is available.
 */
export function useCityImageForVisits(visits) {
  const coverVisit = pickCoverVisit(visits);
  const [imgUrl, setImgUrl] = useState(() => {
    // Synchronously serve from cache if available, to avoid a flash.
    if (!coverVisit?.city_name) return null;
    const cacheKey = `${getLangCandidates(coverVisit).join(',')}|${coverVisit.city_name}`;
    return imageCache.has(cacheKey) ? imageCache.get(cacheKey) : null;
  });

  useEffect(() => {
    if (!coverVisit?.city_name) {
      setImgUrl(null);
      return;
    }
    let cancelled = false;
    fetchCityImage(coverVisit.city_name, getLangCandidates(coverVisit)).then(src => {
      if (!cancelled) setImgUrl(src || null);
    });
    return () => { cancelled = true; };
  }, [coverVisit?.city_name, coverVisit?.country_code]);

  return imgUrl;
}

/**
 * @deprecated Legacy synchronous API - always returns null.
 * Use `useCityImageForVisits` in React components instead.
 */
export function getCityFallbackImage() {
  return null;
}