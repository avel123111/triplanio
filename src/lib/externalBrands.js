/**
 * External third-party brand colours.
 *
 * These intentionally live OUTSIDE the design system: we cannot recolour
 * partner / integration brands (Telegram, booking platforms, …) to our tokens.
 * Centralised here so each brand colour has ONE source and the lint guard can
 * whitelist this module instead of flagging the literals at every call site.
 *
 * Partner/booking brand colours also live in design/index.jsx (PARTNERS) and
 * components/bookings/buildBookingPlatforms.jsx — those are external too.
 */
export const BRAND = {
  telegram: '#0088cc',
};

/** Telegram-tinted surface helpers (hex8 alpha overlays of the brand colour). */
export const telegram = {
  fg:     BRAND.telegram,
  bg:     `${BRAND.telegram}22`, // ~13% tint — icon chips / surfaces
  bgSoft: `${BRAND.telegram}11`, // ~7%  tint — large soft panels
  border: `${BRAND.telegram}33`, // ~20% — hairline on tinted panels
};
