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

/** Счётчики, от которых зависит ФОРМА подписи (ru склоняет, en/es — ед./мн.). */
export type CardCounts = { days: number; cities: number; countries: number };

// Вордмарк рядом с логотипом в левом нижнем углу (первая заглавная).
export const BRAND = 'Triplanio';

/**
 * Подпись стоит ПОД числом, поэтому обязана согласоваться с ним: «95 дни» и
 * «5 города» — не опечатка вёрстки, а отсутствие склонения. Формы задаются
 * тройкой [1, 2-4, 5+] для ru и парой [1, N] для en/es; выбор — `plural()`.
 */
type Forms = readonly [string, string, string];
type CardForms = { km: string; days: Forms; cities: Forms; countries: Forms; visited: string };

const FORMS: Record<Lang, CardForms> = {
  ru: {
    km: 'км',
    days: ['день', 'дня', 'дней'],
    cities: ['город', 'города', 'городов'],
    countries: ['страна', 'страны', 'стран'],
    visited: 'Страны',
  },
  en: {
    km: 'km',
    days: ['Day', 'Days', 'Days'],
    cities: ['City', 'Cities', 'Cities'],
    countries: ['Country', 'Countries', 'Countries'],
    visited: 'Countries',
  },
  es: {
    km: 'km',
    days: ['Dia', 'Dias', 'Dias'],
    cities: ['Ciudad', 'Ciudades', 'Ciudades'],
    countries: ['Pais', 'Paises', 'Paises'],
    visited: 'Paises',
  },
};

/**
 * Выбор формы. Русское правило целиком (а не «1 / не 1»): решают ПОСЛЕДНИЕ ДВЕ
 * цифры — 11..14 всегда берут форму «5+» («11 дней», не «11 день»), иначе решает
 * последняя. Для en/es вторая и третья формы совпадают, поэтому та же функция
 * обслуживает все языки без ветвления по языку на месте вызова.
 */
export function plural(n: number, forms: Forms): string {
  const abs = Math.abs(Math.trunc(n));
  const tens = abs % 100;
  if (tens >= 11 && tens <= 14) return forms[2];
  const last = abs % 10;
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export function cardStrings(lang: Lang, counts: CardCounts): CardStrings {
  const f = FORMS[lang] || FORMS.en;
  return {
    km: f.km,
    days: plural(counts.days, f.days),
    cities: plural(counts.cities, f.cities),
    countries: plural(counts.countries, f.countries),
    visited: f.visited,
  };
}

/** Группировка тысяч тонким пробелом: 10584 -> "10 584". */
export function formatNumber(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
