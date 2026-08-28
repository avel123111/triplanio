import React from 'react';
import { IconBtn } from '@/design/index';
import { Tooltip } from '@/design/Tooltip';
import { useT } from '@/lib/i18n/I18nContext';

// Кнопки поверх карты — ОДНА сборка на ВСЕ поверхности приложения: линза
// «Маршрут», планировщик, Статистика, публичный трип, редактор карты
// share-карточки. Состояние живёт у поверхности, здесь только представление.
//
// ★ СОСТАВ ОБЪЯВЛЯЕТСЯ ОДНИМ СПОСОБОМ — списком `controls` (TRIP-337 → эта
// задача). До этого состав задавали ЧЕТЫРЕ булевых пропа `with*`, и каждый новый
// контрол означал пятый флаг у каждого вызывателя; список читается как «что на
// этой карте есть» и не растёт по ширине. ПОРЯДОК кнопок задаёт РЕЕСТР ниже, а
// не порядок в списке: иначе одни и те же кнопки на двух экранах стоят
// по-разному, и рука не запоминает место.
//
// ★ ПОЗИЦИЯ плашки живёт в КЛАССЕ `.map-ctl` (правый верхний угол, колонкой) —
// один угол на все поверхности, инлайна нет.
//
// ★★ КНОПКА НАЗЫВАЕТ СЛЕДУЮЩЕЕ ДЕЙСТВИЕ — И ИКОНКОЙ, И ИМЕНЕМ, И ПОДСКАЗКОЙ
// (решение Pavel). Раньше правил было три сразу: у проекции и темы иконка
// показывала БУДУЩЕЕ («тёмная карта → солнце»), у старт-финиша НАСТОЯЩЕЕ, у
// фуллскрина не показывала ничего, а поверх этого бренд-заливка `aria-pressed`
// говорила про НАСТОЯЩЕЕ. Два соседних квадрата в одной плашке читались по
// противоположным правилам, а скринридер на тёмной карте произносил «Светлая
// карта, не нажато».
//
// Поэтому здесь кнопки — ДЕЙСТВИЯ, а не тогглы: `aria-pressed` снят намеренно
// (он выражает состояние и спорил бы с иконкой действия), имя кнопки динамическое
// и совпадает с подсказкой. Для скринридера это честный паттерн «Play/Pause»:
// имя всегда описывает то, что произойдёт по нажатию.
//
// ★ ПОДСКАЗКА — `<Tooltip>` ИЗ ДС, А НЕ БРАУЗЕРНЫЙ `title`: у браузерного нет ни
// облика системы, ни управляемого поведения на телефоне (тот же довод, что у
// `NightsStepper` и `TripStartControl`).
/**
 * @param {{
 *   controls?: string[],
 *   projection?: string, onToggleProjection?: any,
 *   scheme?: string, onToggleScheme?: any,
 *   showSE?: boolean, onToggleSE?: any,
 *   fullscreen?: boolean, onToggleFullscreen?: any,
 * }} p
 */
export default function MapControls({
  controls = ['projection', 'theme', 'se'],
  projection, onToggleProjection,
  scheme, onToggleScheme,
  showSE, onToggleSE,
  fullscreen, onToggleFullscreen,
}) {
  const t = useT();
  // Реестр: id → как кнопка выглядит и называется В ТЕКУЩЕМ состоянии. Порядок
  // этого массива И ЕСТЬ порядок кнопок на всех картах.
  const REGISTRY = [
    {
      id: 'projection',
      icon: projection === 'globe' ? 'map' : 'globe',
      label: projection === 'globe' ? t('tse.map_to_flat') : t('tse.map_to_globe'),
      onClick: onToggleProjection,
    },
    {
      id: 'theme',
      icon: scheme === 'DARK' ? 'sun' : 'moon',
      label: t('tse.map_theme_toggle'),
      onClick: onToggleScheme,
    },
    {
      id: 'se',
      icon: showSE ? 'eyeOff' : 'flag',
      label: showSE ? t('tse.map_se_hide') : t('tse.map_se_show'),
      onClick: onToggleSE,
    },
    {
      id: 'fullscreen',
      icon: fullscreen ? 'shrink' : 'expand',
      label: fullscreen ? t('tse.map_fs_exit') : t('tse.map_fs_enter'),
      onClick: onToggleFullscreen,
    },
  ];
  const shown = REGISTRY.filter((b) => controls.includes(b.id));
  if (!shown.length) return null;
  return (
    <div className="map-ctl">
      {shown.map((b) => (
        <Tooltip key={b.id} content={b.label}>
          <IconBtn icon={b.icon} onClick={b.onClick} ariaLabel={b.label} size="sm" />
        </Tooltip>
      ))}
    </div>
  );
}
