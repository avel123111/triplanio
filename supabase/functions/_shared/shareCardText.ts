/**
 * shareCardText — локализованные строки, ЗАПЕЧЁННЫЕ в share-карточку (TRIP-193→443).
 * Карточку рендерит edge, её текст НЕ идёт через клиентский `t()`/Tolgee — это
 * единственный источник слов самой карточки. Chrome вокруг (кнопки/ошибки) живёт
 * на клиентском `t()`. Язык резолвится через `_shared/tgLang.ts`.
 *
 * Правило проекта: дефис "-", не длинное тире.
 */
import type { Lang } from './tgLang.ts';

type CardStrings = {
  km: string; // подпись расстояния
  days: string;
  cities: string;
  countries: string;
  visited: string; // «Visited Countries», перенос строки — "\n"
  planLine1: string;
  planLine2: string;
  scanLine1: string;
  scanLine2: string;
  myTrip: string; // рукописное на полароиде
};

export const BRAND = 'TRIPLANIO';

const STRINGS: Record<Lang, CardStrings> = {
  ru: {
    km: 'км', days: 'дни', cities: 'города', countries: 'страны',
    visited: 'Посещено\nстран',
    planLine1: 'Спланируй', planLine2: 'своё путешествие',
    scanLine1: 'Сканируй', scanLine2: 'код',
    myTrip: 'Моё путешествие!',
  },
  en: {
    km: 'km', days: 'Days', cities: 'Cities', countries: 'Countries',
    visited: 'Visited\nCountries',
    planLine1: 'Plan your', planLine2: 'own adventure',
    scanLine1: 'Scan to', scanLine2: 'explore',
    myTrip: 'My trip!',
  },
  es: {
    km: 'km', days: 'Dias', cities: 'Ciudades', countries: 'Paises',
    visited: 'Paises\nvisitados',
    planLine1: 'Planifica tu', planLine2: 'propia aventura',
    scanLine1: 'Escanea', scanLine2: 'para ver',
    myTrip: 'Mi viaje!',
  },
};

export function cardStrings(lang: Lang): CardStrings {
  return STRINGS[lang] || STRINGS.en;
}

/** Группировка тысяч тонким пробелом: 10584 -> "10 584". */
export function formatNumber(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
