// ISO 3166-1 alpha-2 country code -> continent code.
//
// Static lookup (no DB, no network) used by src/lib/travel-stats.js to count
// distinct continents and group countries. Continent codes are stable keys;
// human labels are translated in the UI via t() (see locales `stats.continent_*`).
//
//   AF Africa · AS Asia · EU Europe · NA North America · SA South America
//   OC Oceania · AN Antarctica
//
// Codes are uppercased on lookup, so callers can pass the geocoder's value as-is.

export const CONTINENT_CODES = ['AF', 'AS', 'EU', 'NA', 'SA', 'OC', 'AN'];

const C = {
  // Africa
  DZ:'AF',AO:'AF',BJ:'AF',BW:'AF',BF:'AF',BI:'AF',CM:'AF',CV:'AF',CF:'AF',TD:'AF',KM:'AF',
  CG:'AF',CD:'AF',CI:'AF',DJ:'AF',EG:'AF',GQ:'AF',ER:'AF',SZ:'AF',ET:'AF',GA:'AF',GM:'AF',
  GH:'AF',GN:'AF',GW:'AF',KE:'AF',LS:'AF',LR:'AF',LY:'AF',MG:'AF',MW:'AF',ML:'AF',MR:'AF',
  MU:'AF',YT:'AF',MA:'AF',MZ:'AF',NA:'AF',NE:'AF',NG:'AF',RE:'AF',RW:'AF',SH:'AF',ST:'AF',
  SN:'AF',SC:'AF',SL:'AF',SO:'AF',ZA:'AF',SS:'AF',SD:'AF',TZ:'AF',TG:'AF',TN:'AF',UG:'AF',
  EH:'AF',ZM:'AF',ZW:'AF',
  // Asia
  AF:'AS',AM:'AS',AZ:'AS',BH:'AS',BD:'AS',BT:'AS',BN:'AS',KH:'AS',CN:'AS',CY:'AS',GE:'AS',
  HK:'AS',IN:'AS',ID:'AS',IR:'AS',IQ:'AS',IL:'AS',JP:'AS',JO:'AS',KZ:'AS',KW:'AS',KG:'AS',
  LA:'AS',LB:'AS',MO:'AS',MY:'AS',MV:'AS',MN:'AS',MM:'AS',NP:'AS',KP:'AS',OM:'AS',PK:'AS',
  PS:'AS',PH:'AS',QA:'AS',SA:'AS',SG:'AS',KR:'AS',LK:'AS',SY:'AS',TW:'AS',TJ:'AS',TH:'AS',
  TL:'AS',TR:'AS',TM:'AS',AE:'AS',UZ:'AS',VN:'AS',YE:'AS',
  // Europe
  AL:'EU',AD:'EU',AT:'EU',BY:'EU',BE:'EU',BA:'EU',BG:'EU',HR:'EU',CZ:'EU',DK:'EU',EE:'EU',
  FO:'EU',FI:'EU',FR:'EU',DE:'EU',GI:'EU',GR:'EU',GG:'EU',HU:'EU',IS:'EU',IE:'EU',IM:'EU',
  IT:'EU',JE:'EU',XK:'EU',LV:'EU',LI:'EU',LT:'EU',LU:'EU',MT:'EU',MD:'EU',MC:'EU',ME:'EU',
  NL:'EU',MK:'EU',NO:'EU',PL:'EU',PT:'EU',RO:'EU',RU:'EU',SM:'EU',RS:'EU',SK:'EU',SI:'EU',
  ES:'EU',SE:'EU',CH:'EU',UA:'EU',GB:'EU',VA:'EU',AX:'EU',SJ:'EU',
  // North America
  AI:'NA',AG:'NA',AW:'NA',BS:'NA',BB:'NA',BZ:'NA',BM:'NA',BQ:'NA',VG:'NA',CA:'NA',KY:'NA',
  CR:'NA',CU:'NA',CW:'NA',DM:'NA',DO:'NA',SV:'NA',GL:'NA',GD:'NA',GP:'NA',GT:'NA',HT:'NA',
  HN:'NA',JM:'NA',MQ:'NA',MX:'NA',MS:'NA',NI:'NA',PA:'NA',PR:'NA',BL:'NA',KN:'NA',LC:'NA',
  MF:'NA',PM:'NA',VC:'NA',SX:'NA',TT:'NA',TC:'NA',US:'NA',VI:'NA',
  // South America
  AR:'SA',BO:'SA',BR:'SA',CL:'SA',CO:'SA',EC:'SA',FK:'SA',GF:'SA',GY:'SA',PY:'SA',PE:'SA',
  SR:'SA',UY:'SA',VE:'SA',
  // Oceania
  AS:'OC',AU:'OC',CK:'OC',FJ:'OC',PF:'OC',GU:'OC',KI:'OC',MH:'OC',FM:'OC',NR:'OC',NC:'OC',
  NZ:'OC',NU:'OC',NF:'OC',MP:'OC',PW:'OC',PG:'OC',PN:'OC',WS:'OC',SB:'OC',TK:'OC',TO:'OC',
  TV:'OC',VU:'OC',WF:'OC',
  // Antarctica
  AQ:'AN',BV:'AN',GS:'AN',HM:'AN',TF:'AN',
};

// NOTE: a few ISO codes are transcontinental or reused (e.g. AS = American Samoa
// here, resolved to Oceania because that key is written last and wins). For a
// travel "continents visited" count we pick one canonical continent per code so
// the number is deterministic.

/** Continent code for an ISO-3166-1 alpha-2 country code, or null if unknown. */
export function continentOf(countryCode) {
  if (!countryCode) return null;
  return C[String(countryCode).trim().toUpperCase()] || null;
}
