// Detect booking platform from URL domain. Each platform carries a label + a
// domain used to fetch the favicon. (Brand colour tints were removed — the
// URL-detected pill now uses a neutral default background; the favicon is the
// only brand signal.)
export const BOOKING_PLATFORMS = {
  booking:  { label: 'Booking.com', domain: 'booking.com' },
  airbnb:   { label: 'Airbnb',      domain: 'airbnb.com' },
  hotels:   { label: 'Hotels.com',  domain: 'hotels.com' },
  expedia:  { label: 'Expedia',     domain: 'expedia.com' },
  agoda:    { label: 'Agoda',       domain: 'agoda.com' },
  trivago:  { label: 'Trivago',     domain: 'trivago.com' },
  vrbo:     { label: 'Vrbo',        domain: 'vrbo.com' },
  rentalcars: { label: 'Rentalcars', domain: 'rentalcars.com' },
  sixt:       { label: 'Sixt',       domain: 'sixt.com' },
  hertz:      { label: 'Hertz',      domain: 'hertz.com' },
  europcar:   { label: 'Europcar',   domain: 'europcar.com' },
  avis:       { label: 'Avis',       domain: 'avis.com' },
  enterprise: { label: 'Enterprise', domain: 'enterprise.com' },
  discovercars: { label: 'DiscoverCars', domain: 'discovercars.com' },
  kayak:      { label: 'KAYAK',      domain: 'kayak.com' },
  kiwi:       { label: 'Kiwi.com',   domain: 'kiwi.com' },
  skyscanner: { label: 'Skyscanner', domain: 'skyscanner.com' },
  omio:       { label: 'Omio',       domain: 'omio.com' },
  airalo:      { label: 'Airalo',       domain: 'airalo.com' },
  yesim:       { label: 'Yesim',        domain: 'yesim.app' },
  safetywing:  { label: 'SafetyWing',   domain: 'safetywing.com' },
  worldnomads: { label: 'World Nomads', domain: 'worldnomads.com' },
  other:    { label: 'Посмотреть бронирование', labelKey: 'event.view_booking', domain: null },
};

/**
 * Ensure a URL has an http(s) scheme. Returns null for empty/invalid input.
 * Prevents relative-path navigation (e.g. "your.booking.com" being
 * resolved against the current page).
 */
export function normalizeExternalUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function detectPlatformFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`);
    const host = u.hostname.toLowerCase();
    if (host.includes('booking.com')) return 'booking';
    if (host.includes('airbnb.')) return 'airbnb';
    if (host.includes('hotels.com')) return 'hotels';
    if (host.includes('expedia.')) return 'expedia';
    if (host.includes('agoda.')) return 'agoda';
    if (host.includes('trivago.')) return 'trivago';
    if (host.includes('vrbo.') || host.includes('homeaway.')) return 'vrbo';
    if (host.includes('rentalcars.')) return 'rentalcars';
    if (host.includes('sixt.')) return 'sixt';
    if (host.includes('hertz.')) return 'hertz';
    if (host.includes('europcar.')) return 'europcar';
    if (host.includes('avis.')) return 'avis';
    if (host.includes('enterprise.')) return 'enterprise';
    if (host.includes('discovercars.')) return 'discovercars';
    if (host.includes('kayak.')) return 'kayak';
    if (host.includes('kiwi.')) return 'kiwi';
    if (host.includes('skyscanner.')) return 'skyscanner';
    if (host.includes('omio.')) return 'omio';
    return 'other';
  } catch {
    return null;
  }
}

// Returns a favicon URL (via Google's favicon service) for a known platform, or for any host
export function platformLogoUrl(platformKey, fallbackUrl = null) {
  const p = BOOKING_PLATFORMS[platformKey];
  let domain = p?.domain;
  if (!domain && fallbackUrl) {
    try {
      const u = new URL(fallbackUrl.trim().startsWith('http') ? fallbackUrl.trim() : `https://${fallbackUrl.trim()}`);
      domain = u.hostname;
    } catch { /* ignore */ }
  }
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}