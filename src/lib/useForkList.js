// useForkList — the state contract behind every "fork" search list (TRIP-293).
//
// The list CHROME was unified in TRIP-287 (forkList.jsx: toolbar, states, pager),
// but the STATE stayed forked: hotels kept it in useStay22Bundle as one object,
// activities kept nine separate useState calls inside the component. Same-looking
// "Reset" buttons, different meanings — the activity one silently left the text
// query in place, so on a text-only miss it appeared dead.
//
// This hook is the missing half: one place that owns what a fork list's state IS
// and what the four transitions MEAN.
//
//  · filters      — ALL client-side knobs in ONE object (text, price, sort, flags).
//  · applied      — the optional SERVER filter snapshot (hotels reload the pool on
//                   guests/platform; activities have none and leave this null).
//  · resetAll()   — filters := base (whole-object replace, never a list of setters),
//                   server filters dropped, page 1, selection/hover cleared.
//  · applyFilters / applyServer — change the visible set → back to page 1 and drop
//                   the stale selection/hover, which may now point outside the set.
//  · city change / panel close → resetAll, so the next city opens clean.
//
// `baseFilters` MUST be a module-level constant: it is both the initial state and
// the reset target, captured once. That single fact is what makes the TRIP-293 bug
// unrepresentable — a new filter added to the base is reset for free, and one that
// is NOT in the base fails the pure `applyForkFilters(pool, base) === pool` test.

import { useCallback, useEffect, useRef, useState } from 'react';

export function useForkList({ visitId = null, enabled = true, baseFilters }) {
  // Captured once (useRef initial value) so an inline literal from a caller can't
  // make "reset" mean something different on a later render.
  const baseRef = useRef(baseFilters);
  const [filters, setFilters] = useState(() => ({ ...baseRef.current }));
  const [applied, setApplied] = useState(null);
  const [page, setPage] = useState(1);
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  // A changed result set invalidates the page you were on and any card you had
  // picked — both paths below funnel through this.
  const rewind = useCallback(() => { setPage(1); setSelectedId(null); setHoveredId(null); }, []);

  // CLIENT filters (text / price / sort / flags): instant over the pool.
  const applyFilters = useCallback((patch) => { setFilters((s) => ({ ...s, ...patch })); rewind(); }, [rewind]);
  // SERVER filters: reload the pool (the query is keyed on this snapshot).
  const applyServer = useCallback((snap) => { setApplied(snap); rewind(); }, [rewind]);

  const resetAll = useCallback(() => {
    setFilters({ ...baseRef.current });
    setApplied(null);
    rewind();
  }, [rewind]);

  // Target city changed (or the panel closed) → next open starts clean.
  useEffect(() => { resetAll(); }, [visitId, enabled, resetAll]);

  return {
    filters, applied, page, hoveredId, selectedId,
    setPage, setHoveredId, setSelectedId,
    applyFilters, applyServer, resetAll,
  };
}
