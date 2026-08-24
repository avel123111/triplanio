// @ts-check
import React from 'react';

// ----- CityBar ----- (TRIP-321 линза «Календарь» — апрув Pavel)
// Цветная полоса города календаря: верхняя полоса дня в СЕТКЕ МЕСЯЦА и полоса
// города в ШАПКЕ НЕДЕЛИ. Один объект, до этого нарисованный дважды своими
// классами (`.ncal-daytop-s` и `.ncal-wk-cseg`). Тон — из палитры городов
// (`CITY_TONES`, оси `--cc/--cc-soft/--cc-ink`), выставляется инлайном по
// индексу, ровно как `Swatch` берёт `--sw`, а активный `Seg` — `--hl*`.
//
// ★ ОСЬ `variant`: `bar` — тонкая полоса-цвет БЕЗ имени (месяц; имя ведёт
// отдельный слой-прогон поверх ячеек), `strip` — полоса С именем по центру
// (шапка недели, колонка шире). Клик открывает панель города (`onClick` → база
// `<button>`; без него — `<div>`, декоративный сегмент).
//
// ★ ЖИВЁТ СВОИМ МОДУЛЕМ (как `Chip`/`Seg`/`Swatch`): точка входа в ДС одна
// (баррель), палитра городов — тоже здесь (единственный источник цвета города,
// его же читает точка в правом виджете).

// Палитра городов — существующие токены событий (`--ev-*`/`--ai`/`--warm`), без
// новых оттенков. Индекс города (по имени) → триада; читатели: сама полоса и
// точка города в виджете.
export const CITY_TONES = [
  { bar: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', ink: 'var(--ev-activity-ink)' },
  { bar: 'var(--ev-hotel)',    soft: 'var(--ev-hotel-soft)',    ink: 'var(--ev-hotel-ink)'    },
  { bar: 'var(--ev-car)',      soft: 'var(--ev-car-soft)',      ink: 'var(--ev-car-ink)'      },
  { bar: 'var(--ai)',          soft: 'var(--ai-soft)',          ink: 'var(--ai-ink)'          },
  { bar: 'var(--warm)',        soft: 'var(--warm-soft)',        ink: 'var(--warm-ink)'        },
  { bar: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', ink: 'var(--ev-transfer-ink)' },
];
/** Индекс города → триада тона (циклично, безопасно к отрицательным). */
export const cityTone = (idx = 0) => CITY_TONES[((idx % CITY_TONES.length) + CITY_TONES.length) % CITY_TONES.length];
/** Стиль-переменные тона для инлайна (`--cc*`). */
export const cityToneVars = (idx = 0) => {
  const t = cityTone(idx);
  return { '--cc': t.bar, '--cc-soft': t.soft, '--cc-ink': t.ink };
};

/** @typedef {'bar'|'strip'} CityBarVariant */
export const CityBar = ({ tone = 0, variant = 'bar', label, onClick, ariaLabel, className = '', style }) => {
  const El = /** @type {any} */ (onClick ? 'button' : 'div');
  return (
    <El
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
      className={['citybar', variant !== 'bar' && `citybar--${variant}`, className].filter(Boolean).join(' ')}
      style={{
        // inline-style-exempt: тон города приходит данными (индекс → CSS-переменные --cc*), классом не выразить — как `tint` у Swatch
        ...cityToneVars(tone), ...style,
      }}
    >
      {label != null && <span className="citybar__lbl">{label}</span>}
    </El>
  );
};

/** @type {readonly CityBarVariant[]} */
export const CITYBAR_VARIANTS = ['strip'];
