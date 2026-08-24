import React from 'react';

// ─── CityRow ────────────────────────────────────────────────────────────────
// Shared, presentational city-row SKELETON used by BOTH the create-flow planner
// (StepCities → PlannerCityRow) and the structural editor (TripStructureEdit →
// GridNode). It emits the editor's existing `.te-row` markup + inner primitives
// (.te-grip / .te-row__num / .te-citycell / .te-cityline / .te-cityname /
// .te-country / .te-dts) so all existing CSS keeps working unchanged — the only
// per-screen differences are the trailing action cells (passed as `children`)
// and the variant modifier. This collapses the old flex-vs-grid duplication
// (the planner's bespoke `.te-row--plan` component) into one layout source.
//
// Behaviour stays with the caller: drag/DnD (useRouteDnD), date math, editing
// state, conflicts and transfers are owned by the host; CityRow only lays out.
//
// Props:
//   variant       'planner' | 'editor' — adds `.te-row--plan` for the planner
//                 (standalone card + its own columns); editor keeps the bare
//                 `.te-row` 6-col grid from `.te-table .te-row`.
//   dragging      adds `.is-dragging` (lift state).
//   invalid       adds `.te-row--bad` (red border) — planner only (unresolved city).
//   onArm         row onPointerDown — arms the pointer-drag (host's armDrag).
//   onClick       row onClick — editor opens the city panel; planner: undefined.
//   grip          ReactNode — the grip element WITH its own handlers (the host
//                 keeps onClick-stop + keyboard reorder so they never drift).
//   lead          ReactNode — the number / flag / waypoint node before the city.
//   name,country  city name + (optional) country shown on the .te-cityline.
//   conf          ReactNode — optional conflict badge (editor) on the cityline.
//   dates         ReactNode|string — the .te-dts line (range / layover / hint).
//   editingSlot   ReactNode — when set, REPLACES the name/dates with this
//                 (planner: the CityPicker for an empty/new row).
//   stopCellPointer  stop pointerdown on the citycell so typing/clicking inside
//                 it never arms the drag (planner).
//   children      trailing action cells (planner: stepper + delete, wrapped in
//                 `.te-row__pacts`; editor: stepper + hotel + activity cells,
//                 rendered as direct grid cells to fill the 96px columns).
/**
 * ⚠️ АННОТАЦИЯ ОБЯЗАТЕЛЬНА (TRIP-388). Без неё TS выводит тип из ДЕСТРУКТУРИЗАЦИИ
 * и делает ОБЯЗАТЕЛЬНЫМ каждый проп без дефолта - при `checkJs: false` невидимо,
 * вскрывается только у вызывателя под `// @ts-check`.
 *
 * Набор ЗАКРЫТЫЙ намеренно: остаток пропов никуда не уезжает (`...rest` тут нет),
 * поэтому лишний проп был бы молчаливым no-op, а не «прокинулся на носитель».
 *
 * Каждый `?` - заявление «без этого компонент работает», и каждый проверен
 * УСТРОЙСТВОМ КОДА, а не намерением:
 *   дефолт в сигнатуре   variant · dragging · pressing · invalid · stopCellPointer · className
 *   стоит под условием   country `{country ? … : null}` · conf `{conf || null}`
 *                        dates `{dates ? … : null}` · editingSlot `{editingSlot || (…)}`
 *                        name - НЕ безусловное содержимое: он живёт в ветке
 *                        `{editingSlot || (…)}`, и планировщик в режиме выбора
 *                        города передаёт `undefined` явно (`ManualPlanner:185`)
 *   не передаётся вовсе  onClick - у ряда планировщика клика нет (см. список
 *                        пропов выше); замерено прогоном с `// @ts-check` в
 *                        `ManualPlanner`: обязательный `onClick` = TS2741
 *   read-only ряд        onArm - у ряда наблюдателя перестановки нет вовсе
 *                        (TRIP-459), обработчик не передаётся; `grip` при этом
 *                        всё равно ПРИХОДИТ - пустой ячейкой, потому что он
 *                        занимает первую колонку сетки (`--te-cols: 16px …`) и
 *                        без него номер города уехал бы в 16px, разойдясь с
 *                        шапкой колонок. То есть `?` появился у `onArm`, а
 *                        `grip` остался обязательным СОДЕРЖИМЫМ - это разные
 *                        причины, и они не схлопываются
 * Остальные обязательны: `grip`/`lead`/`children` - безусловное содержимое корня.
 *
 * @param {{ variant?: 'planner'|'editor', dragging?: boolean, pressing?: boolean,
 *           invalid?: boolean, onArm?: any, onClick?: any, grip: any, lead: any,
 *           name?: any, country?: any, conf?: any, dates?: any, editingSlot?: any,
 *           stopCellPointer?: boolean, className?: string, children: any }} p
 */
export default function CityRow({
  variant = 'planner',
  dragging = false,
  pressing = false,
  invalid = false,
  onArm,
  onClick,
  grip,
  lead,
  name,
  country,
  conf,
  dates,
  editingSlot,
  stopCellPointer = false,
  className = '',
  children,
}) {
  const cls = [
    'grid te-row',
    variant === 'planner' ? 'te-row--plan' : '',
    dragging ? 'is-dragging' : '',
    pressing ? 'is-pressing' : '',
    invalid ? 'te-row--bad' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} onPointerDown={onArm} onClick={onClick}>
      {grip}
      {lead}
      <div className="te-citycell" onPointerDown={stopCellPointer ? (e) => e.stopPropagation() : undefined}>
        {editingSlot || (
          <>
            <div className="row row--g3 te-cityline">
              <span className="trunc te-cityname">{name}</span>
              {country ? <span className="te-country">{country}</span> : null}
              {conf || null}
            </div>
            {dates ? <div className="row row--g3 te-dts">{dates}</div> : null}
          </>
        )}
      </div>
      {variant === 'planner' ? <div className="row row--inline row--g4 te-row__pacts">{children}</div> : children}
    </div>
  );
}
