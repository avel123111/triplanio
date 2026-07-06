/**
 * shareCardText — localized strings + formatters baked INTO the share-card PNG
 * (TRIP-193). The card is rendered server-side (resvg), so its text can NOT go
 * through the client `t()` / Tolgee — same reason email/notification copy lives
 * in `_shared/emailTemplate.ts`. This is the single source of truth for the
 * card's own words. The surrounding client modal (buttons, errors) stays on
 * `t()` + Tolgee. Language is resolved via the shared `_shared/tgLang.ts`.
 *
 * Per project content rule: use the hyphen "-", never the em dash "—".
 */
import type { Lang } from './tgLang.ts';

type PluralForms = { one: string; few: string; many: string };

type CardStrings = {
  months: string[]; // 12 short month labels, uppercased where the locale wants it
  distance: string; // "<n> km ..." suffix, e.g. "км в пути"
  cta: string; // handwritten hook, e.g. "а куда рванёшь ты?"
  tagline: string; // "спланируй свой трип"
  site: string; // "triplanio.com"
  day: PluralForms;
  country: PluralForms;
  city: PluralForms;
  friend: PluralForms;
};

export const BRAND = 'TRIPLANIO';

const STRINGS: Record<Lang, CardStrings> = {
  ru: {
    months: ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЯ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'],
    distance: 'км в пути',
    cta: 'а куда рванёшь ты?',
    tagline: 'спланируй свой трип',
    site: 'triplanio.com',
    day: { one: 'день', few: 'дня', many: 'дней' },
    country: { one: 'страна', few: 'страны', many: 'стран' },
    city: { one: 'город', few: 'города', many: 'городов' },
    friend: { one: 'друг', few: 'друга', many: 'друзей' },
  },
  en: {
    months: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
    distance: 'km on the road',
    cta: 'where will you go?',
    tagline: 'plan your trip',
    site: 'triplanio.com',
    day: { one: 'day', few: 'days', many: 'days' },
    country: { one: 'country', few: 'countries', many: 'countries' },
    city: { one: 'city', few: 'cities', many: 'cities' },
    friend: { one: 'friend', few: 'friends', many: 'friends' },
  },
  es: {
    months: ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'],
    distance: 'km de viaje',
    cta: 'y tu, ¿a donde vas?',
    tagline: 'planifica tu viaje',
    site: 'triplanio.com',
    day: { one: 'dia', few: 'dias', many: 'dias' },
    country: { one: 'pais', few: 'paises', many: 'paises' },
    city: { one: 'ciudad', few: 'ciudades', many: 'ciudades' },
    friend: { one: 'amigo', few: 'amigos', many: 'amigos' },
  },
};

export function cardStrings(lang: Lang): CardStrings {
  return STRINGS[lang] || STRINGS.en;
}

/** Pick the plural form for `n` in `lang`. RU uses one/few/many; en/es one/other. */
function plural(lang: Lang, n: number, forms: PluralForms): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (lang === 'ru') {
    if (abs > 10 && abs < 20) return forms.many;
    if (d === 1) return forms.one;
    if (d >= 2 && d <= 4) return forms.few;
    return forms.many;
  }
  return n === 1 ? forms.one : forms.few;
}

/** "22 дня · 4 страны · 6 городов · 3 друга" (friends omitted when 0). */
export function factsLine(
  lang: Lang,
  n: { days: number; countries: number; cities: number; friends: number },
): string {
  const s = cardStrings(lang);
  const parts = [
    `${n.days} ${plural(lang, n.days, s.day)}`,
    `${n.countries} ${plural(lang, n.countries, s.country)}`,
    `${n.cities} ${plural(lang, n.cities, s.city)}`,
  ];
  if (n.friends > 0) parts.push(`${n.friends} ${plural(lang, n.friends, s.friend)}`);
  return parts.join(' · ');
}

/** Group thousands with a regular space: 10584 -> "10 584". */
export function formatNumber(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Date range label, e.g. "СЕН. 11 - 3 ОКТ 2026". Same month/year collapse to a
 * compact form. Dates are ISO (YYYY-MM-DD); parsed as UTC to avoid tz drift.
 */
export function dateRangeLabel(lang: Lang, startISO: string, endISO: string): string {
  const s = cardStrings(lang);
  const a = new Date(startISO);
  const b = new Date(endISO);
  const mA = s.months[a.getUTCMonth()];
  const mB = s.months[b.getUTCMonth()];
  const dA = a.getUTCDate();
  const dB = b.getUTCDate();
  const year = b.getUTCFullYear();
  return `${mA}. ${dA} - ${dB} ${mB} ${year}`;
}
