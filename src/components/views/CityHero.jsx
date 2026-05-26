import React, { useState, useEffect } from 'react';

// Map country code → preferred Wikipedia language code
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

async function fetchCityImage(cityName, langs) {
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
      if (src) return src;
    } catch {
      // try next lang
    }
  }
  return null;
}

/**
 * City image thumbnail used inside CityHeaderCard.
 * Renders as a rectangle with only the top-left corner rounded (rounded-tl-2xl).
 * No padding or margin — caller controls dimensions via className.
 */
export default function CityHero({ visit, className = '' }) {
  const [imgUrl, setImgUrl] = useState(null);

  useEffect(() => {
    if (!visit?.city_name) return;
    let cancelled = false;
    fetchCityImage(visit.city_name, getLangCandidates(visit)).then(src => {
      if (!cancelled && src) setImgUrl(src);
    });
    return () => { cancelled = true; };
  }, [visit?.city_name, visit?.country_code]);

  // Stable hue from city name for gradient fallback
  const hue = visit?.city_name
    ? [...visit.city_name].reduce((s, c) => s + c.charCodeAt(0), 0) % 360
    : 200;

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {imgUrl ? (
        <img
          src={imgUrl}
          alt={visit.city_name}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          onError={() => setImgUrl(null)}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, hsl(${hue}, 55%, 52%), hsl(${(hue + 50) % 360}, 45%, 35%))`,
          }}
        />
      )}
    </div>
  );
}