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
    'te-row',
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
            <div className="te-cityline">
              <span className="te-cityname">{name}</span>
              {country ? <span className="te-country">{country}</span> : null}
              {conf || null}
            </div>
            {dates ? <div className="te-dts">{dates}</div> : null}
          </>
        )}
      </div>
      {variant === 'planner' ? <div className="te-row__pacts">{children}</div> : children}
    </div>
  );
}
