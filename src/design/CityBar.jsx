// @ts-check
import React from 'react';

// ----- CityBar ----- (TRIP-321 линза «Календарь» — апрув Pavel)
// Цветная полоса города календаря: полоса-прогон с именем города, одна и та же
// в СЕТКЕ МЕСЯЦА и в ШАПКЕ НЕДЕЛИ. Один объект, до этого нарисованный дважды
// своими классами (`.ncal-daytop-s` и `.ncal-wk-cseg`). Тон — из палитры городов
// (`CITY_TONES`, оси `--cc/--cc-soft/--cc-ink`), выставляется инлайном по
// индексу, ровно как `Swatch` берёт `--sw`, а активный `Seg` — `--hl*`.
//
// ★ ОСИ `variant` У ПОЛОСЫ НЕТ — и это не упрощение задним числом. Обличий было
// два: `bar` (тонкая полоса-цвет без имени) и `strip` (полоса с именем). В
// продукте `bar` не звали НИ РАЗУ: обе поверхности календаря рисуют прогон с
// именем (`CalendarLens.jsx` — сетка месяца и шапка недели), единственный его
// рендер жил в витрине `/kit`, то есть ось существовала ради самой витрины.
// Пока тело полосы было прозрачным, разница ещё читалась кантом сверху; после
// перевода полосы на плотный тон от `bar` остался ровно «`strip` без полей и
// скругления». Ось на одно значение — мёртвый API, поэтому обличье сведено в
// сам `.citybar`, а модификатор `--strip` снят (объявления перенесены в базу).
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

/**
 * ★ ВСЕ ПРОПЫ НЕОБЯЗАТЕЛЬНЫ — и это не косметика типа. Форма `@param {object}`
 * с перечислением ключей делает объект РОВНО из перечисленных и ТРЕБУЕТ каждый:
 * декоративный сегмент без `onClick` — законный вызов, но давал TS2741 в экране
 * под `// @ts-check`. Та же ловушка «запечатанного набора», что разобрана в
 * шапке `Layout.jsx`: тип не должен требовать то, у чего есть осмысленный дефолт.
 * @param {{ tone?: number, label?: any, onClick?: any,
 *           ariaLabel?: string, className?: string, style?: any }} p
 */
export const CityBar = ({ tone = 0, label, onClick, ariaLabel, className = '', style }) => {
  const El = /** @type {any} */ (onClick ? 'button' : 'div');
  return (
    <El
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
      className={['citybar', 'row', 'row--j-center', className].filter(Boolean).join(' ')}
      style={{
        // inline-style-exempt: тон города приходит данными (индекс → CSS-переменные --cc*), классом не выразить — как `tint` у Swatch
        ...cityToneVars(tone), ...style,
      }}
    >
      {label != null && <span className="citybar__lbl">{label}</span>}
    </El>
  );
};
