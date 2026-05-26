// Detect booking platform from URL domain
// Each platform has a brand color and a domain used to fetch favicon
export const BOOKING_PLATFORMS = {
  booking:  { label: 'Booking.com', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',   domain: 'booking.com' },
  airbnb:   { label: 'Airbnb',      color: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',   domain: 'airbnb.com' },
  hotels:   { label: 'Hotels.com',  color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',       domain: 'hotels.com' },
  expedia:  { label: 'Expedia',     color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300', domain: 'expedia.com' },
  agoda:    { label: 'Agoda',       color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300', domain: 'agoda.com' },
  trivago:  { label: 'Trivago',     color: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300', domain: 'trivago.com' },
  vrbo:     { label: 'Vrbo',        color: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',   domain: 'vrbo.com' },
  rentalcars: { label: 'Rentalcars', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300', domain: 'rentalcars.com' },
  sixt:       { label: 'Sixt',       color: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300', domain: 'sixt.com' },
  hertz:      { label: 'Hertz',      color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300', domain: 'hertz.com' },
  europcar:   { label: 'Europcar',   color: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',     domain: 'europcar.com' },
  avis:       { label: 'Avis',       color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',             domain: 'avis.com' },
  enterprise: { label: 'Enterprise', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', domain: 'enterprise.com' },
  discovercars: { label: 'DiscoverCars', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',     domain: 'discovercars.com' },
  kayak:      { label: 'KAYAK',      color: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300', domain: 'kayak.com' },
  kiwi:       { label: 'Kiwi.com',   color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',             domain: 'kiwi.com' },
  skyscanner: { label: 'Skyscanner', color: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',             domain: 'skyscanner.com' },
  omio:       { label: 'Omio',       color: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',         domain: 'omio.com' },
  other:    { label: 'Посмотреть бронирование', color: 'bg-secondary text-foreground',                         domain: null },
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