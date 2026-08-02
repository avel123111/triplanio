/**
 * External third-party brand colours.
 *
 * These intentionally live OUTSIDE the design system: we cannot recolour
 * partner / integration brands (Telegram, booking platforms, …) to our tokens.
 * Centralised here so each brand colour has ONE source and the lint guard can
 * whitelist this module instead of flagging the literals at every call site.
 * That is the whole point of the module, so a partner colour goes HERE — not
 * next to the component that happens to draw it (TRIP-321).
 */
export const BRAND = {
  telegram: '#0088cc',
};

/**
 * Booking / travel partners, keyed by the substring that identifies them in a
 * booking URL. `short` is the monogram drawn when the site's favicon fails to
 * load; `color` is the brand fill behind it.
 */
export const PARTNERS = {
  'booking.com': { color: '#003580', label: 'Booking',    short: 'B' },
  'airbnb':      { color: '#ff385c', label: 'Airbnb',     short: 'A' },
  'marriott':    { color: '#a8945c', label: 'Marriott',   short: 'M' },
  'agoda':       { color: '#fe424d', label: 'Agoda',      short: 'A' },
  'renfe':       { color: '#7a1f3a', label: 'Renfe',      short: 'R' },
  'cp.pt':       { color: '#2f6ba8', label: 'CP',         short: 'CP' },
  'lufthansa':   { color: '#05164d', label: 'Lufthansa',  short: 'L' },
  'tap':         { color: '#c81f3a', label: 'TAP',        short: 'T' },
  'expedia':     { color: '#fcc60a', label: 'Expedia',    short: 'E' },
  'rentalcars':  { color: '#222e72', label: 'RentalCars', short: 'R' },
  'sixt':        { color: '#ff6600', label: 'Sixt',       short: 'S' },
  'holafly':     { color: '#5ac6c1', label: 'Holafly',    short: 'H' },
};

/** Partner whose key appears in `url`, or null. */
export const detectPartner = (url) => {
  if (!url) return null;
  const u = url.toLowerCase();
  for (const [k, v] of Object.entries(PARTNERS)) if (u.includes(k)) return { key: k, ...v };
  return null;
};

/** Telegram-tinted surface helpers (hex8 alpha overlays of the brand colour). */
export const telegram = {
  fg:     BRAND.telegram,
  bg:     `${BRAND.telegram}22`, // ~13% tint — icon chips / surfaces
  bgSoft: `${BRAND.telegram}11`, // ~7%  tint — large soft panels
  border: `${BRAND.telegram}33`, // ~20% — hairline on tinted panels
};
