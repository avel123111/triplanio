import React from 'react';
import { IconBtn } from '@/design/index';
import { useT } from '@/lib/i18n/I18nContext';

// On-map control buttons shared by EVERY map surface: projection (flat ↔ globe),
// theme (day ↔ night), start/finish visibility and (opt-in) fullscreen. Only the
// icon changes per state; state lives in the parent, this is presentation only.
//
// ★TRIP-337 (унификация карты): это ЕДИНСТВЕННАЯ сборка контролов карты. Каждый
// экран объявляет свой набор пер-контрольными флагами `with*` (сеты сохранены):
// planner/map-lens/edit — проекция+тема+SE (дефолты); Statistics — проекция+
// фуллскрин (`withTheme={false} withSE={false} withFullscreen`). Раньше Statistics
// рисовал свой кластер `.map-ctl` руками — теперь через этот же компонент.
//
// ★TRIP-337: позиция плашки живёт в КЛАССЕ `.map-ctl` (правый верхний, колонкой) —
// инлайна больше нет; один угол на все поверхности.
export default function MapControls({
  projection, onToggleProjection, scheme, onToggleScheme, showSE, onToggleSE,
  fullscreen, onToggleFullscreen,
  withProjection = true, withTheme = true, withSE = true, withFullscreen = false,
}) {
  const t = useT();
  // ★TRIP-344 (канонизация состояния): у кнопок ПОЯВИЛСЯ индикатор «включено»
  // через `aria-pressed` — раньше состояния не было вовсе (только смена иконки),
  // теперь активное = канон `.icon-btn[aria-pressed]` (бренд-заливка). Семантика
  // «нажато» та же, что у карт-тогглов `ShareMapPreview`: globe / LIGHT / показ SE.
  //
  // ★ ПРАВИЛО ЭПИКА: `aria-pressed` → СТАБИЛЬНОЕ имя. `aria-label` называет РЕЖИМ
  // («Вид глобус» / «Светлая карта» / «Показ старт-финиш») и не меняется на клик,
  // вкл/выкл несёт `aria-pressed` — иначе скринридер врёт («Плоская карта,
  // нажато») и имя кнопки прыгает при переключении (ревью Codex, P2). Динамический
  // `title` (тултип, описывает СЛЕДУЮЩЕЕ действие) остаётся зрячим подсказчиком.
  const buttons = [
    withProjection && { key: 'proj', label: t('tse.map_proj_aria'), title: projection === 'globe' ? t('tse.map_flat') : t('tse.map_globe'), icon: projection === 'globe' ? 'map' : 'globe', onClick: onToggleProjection, on: projection === 'globe' },
    withTheme && { key: 'theme', label: t('tse.map_light_aria'), title: scheme === 'DARK' ? t('tse.map_light') : t('tse.map_dark'), icon: scheme === 'DARK' ? 'sun' : 'moon', onClick: onToggleScheme, on: scheme === 'LIGHT' },
    withSE && { key: 'se', label: t('tse.map_se_aria'), title: t('tse.map_startend'), icon: showSE ? 'flag' : 'eyeOff', onClick: onToggleSE, on: showSE },
    // Fullscreen — aria-label = стабильный режим (иначе скринридер прыгает при
    // вкл/выкл), состояние несёт aria-pressed. Только Statistics включает его.
    withFullscreen && { key: 'fs', label: t('stats.map_fullscreen'), title: t('stats.map_fullscreen'), icon: 'expand', onClick: onToggleFullscreen, on: fullscreen },
  ].filter(Boolean);
  return (
    <div className="map-ctl">
      {buttons.map((b) => (
        <IconBtn key={b.key} icon={b.icon} onClick={b.onClick} title={b.title} ariaLabel={b.label}
          ariaPressed={b.on} size="sm" />
      ))}
    </div>
  );
}
