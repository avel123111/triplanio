import React, { createContext, useContext, useEffect } from 'react';

// ─── Global screen-title bar (.tscreen-h in the Lumo V3 mockup) ──────────────
//
// The bar is rendered ONCE by the trip shell (TripView / TripStructureEdit),
// just under the gradient hero, offset to the sidebar so it reads as the
// "lower part" of the global trip header. It shows the current screen's name
// on the left and an optional actions slot on the right.
//
// Screens that own primary actions (Documents → upload, Members → invite,
// Budget → add expense / FX) project their buttons INTO this bar without the
// shell needing to know about them: they call `useTripScreenActions(<buttons/>)`
// and the active lens' buttons appear on the right. Screens with no global
// action (timeline, calendar, chat, map, settings) simply show the title.
//
// Why a context instead of props: the shell switches lenses by swapping the
// body subtree; the action buttons live with their lens (and its handlers /
// dialogs), so they register from inside the lens and unregister on unmount.

export const TripScreenBarCtx = createContext({ setActions: () => {} });

/**
 * Register the right-hand action node for the current screen. Pass the JSX once;
 * list the values it closes over in `deps` so it refreshes when they change.
 * Clears automatically on unmount (lens switch).
 */
export function useTripScreenActions(node, deps = []) {
  const { setActions } = useContext(TripScreenBarCtx);
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * The screen-title bar itself.
 *   title   — screen name (string)
 *   sub     — optional muted suffix (e.g. "· сводка")
 *   actions — right-hand node (from context state in TripView, or passed
 *             directly by the editor)
 *   leading — optional node rendered before the title (editor uses none)
 */
export default function TripScreenBar({ title, sub, actions, leading }) {
  return (
    <div className="trip-screenbar">
      {leading}
      <span className="trip-screenbar__title">{title}</span>
      {sub && <span className="trip-screenbar__sub">{sub}</span>}
      <span className="trip-screenbar__sp" />
      {actions && <div className="trip-screenbar__actions">{actions}</div>}
    </div>
  );
}
