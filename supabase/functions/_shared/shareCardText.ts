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
  visited: string; // подпись ряда «Countries» внутри рамки (одна строка)
};

// Вордмарк рядом с логотипом в левом нижнем углу (первая заглавная).
export const BRAND = 'Triplanio';

const STRINGS: Record<Lang, CardStrings> = {
  ru: {
    km: 'км', days: 'дни', cities: 'города', countries: 'страны',
    visited: 'Страны',
  },
  en: {
    km: 'km', days: 'Days', cities: 'Cities', countries: 'Countries',
    visited: 'Countries',
  },
  es: {
    km: 'km', days: 'Dias', cities: 'Ciudades', countries: 'Paises',
    visited: 'Paises',
  },
};

export function cardStrings(lang: Lang): CardStrings {
  return STRINGS[lang] || STRINGS.en;
}

/** Группировка тысяч тонким пробелом: 10584 -> "10 584". */
export function formatNumber(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
