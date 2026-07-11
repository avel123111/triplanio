import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Shared route drag-and-drop engine — extracted verbatim from TripStructureEdit so
 * the structural editor and the trip-creation flow share ONE implementation of the
 * reorder interaction (no second copy to drift).
 *
 * Owns: pointer-drag (mouse = whole row draggable immediately; touch/pen = 430ms
 * long-press to arm), the FLIP slide animation of non-dragged rows, the live
 * preview order while dragging, and keyboard a11y reorder. Anchor rows (trip
 * start/finish) are pinned at the ends via the host-supplied `isAnchor`.
 *
 * The host owns the data layer and passes:
 *   • ordered        — the rows in their current order (each has `id`, `kind`).
 *   • isAnchor(node) — true for rows that must stay pinned at the list ends.
 *   • onCommitOrder(orderedIds) — apply the new order (optimistic recompute +
 *                                 whatever persistence the host needs). Called for
 *                                 both drag-drop and keyboard moves, identically.
 *
 * Returns the engine the host wires into its rows:
 *   { draggingId, overGap, displayNodes, setRowRef, armDrag, moveNodeById, justDraggedRef }
 */
export function useRouteDnD({ ordered, isAnchor, onCommitOrder }) {
  const [draggingId, setDraggingId] = useState(null); // stable id of the dragged row (survives list re-index across renders — the index doesn't)
  const [overGap, setOverGap] = useState(null);   // insertion position (index in `ordered`) the row would drop into
  const [pressingId, setPressingId] = useState(null); // touch long-press feedback: row being held before the drag arms
  const endDrag = () => { setDraggingId(null); setOverGap(null); };
  const justDraggedRef = useRef(false); // suppress the click that fires right after a drag

  // FLIP refs: animate non-dragged rows smoothly to their new slot during drag.
  const rowElRefs = useRef(new Map());     // node id -> row element
  const prevRectsRef = useRef(new Map());  // node id -> top, captured just before a reorder
  const setRowRef = (id) => (el) => { if (el) rowElRefs.current.set(id, el); else rowElRefs.current.delete(id); };
  const captureRects = () => { const m = new Map(); rowElRefs.current.forEach((el, id) => { if (el) m.set(id, el.getBoundingClientRect().top); }); prevRectsRef.current = m; };

  // Pointer-drag state. dragInfoRef holds the LIVE gesture (id, where the row was
  // grabbed, whether it actually moved). liveRef mirrors render values the window
  // listeners need; dragHandlersRef holds the per-render move/end closures behind
  // two STABLE dispatchers so add/removeEventListener pair up correctly.
  const dragInfoRef = useRef(null);
  const liveRef = useRef({ ordered: [], displayNodes: [] });
  const dragHandlersRef = useRef({ move: () => {}, end: () => {} });
  const stableMove = useRef((e) => dragHandlersRef.current.move(e)).current;
  const stableEnd = useRef((e) => dragHandlersRef.current.end(e)).current;
  // Non-passive touchmove blocker — preventDefault is the only thing that stops
  // iOS Safari from scrolling the page during a drag (iOS ignores a mid-gesture
  // touch-action change, so the row press wouldn't move without this).
  const blockTouchScroll = useRef((e) => { try { e.preventDefault(); } catch { /* passive */ } }).current;

  // FLIP: after the preview order changes, slide each row from where it WAS to
  // where it is now — the list rearranges smoothly. The lifted (dragged) row is
  // skipped: its transform follows the pointer and is managed inline.
  useLayoutEffect(() => {
    const prev = prevRectsRef.current;
    if (!prev || prev.size === 0) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { prevRectsRef.current = new Map(); return; }
    const draggedId = dragInfoRef.current?.id;
    rowElRefs.current.forEach((el, id) => {
      if (!el || id === draggedId) return;
      const prevTop = prev.get(id);
      if (prevTop == null) return;
      const dy = prevTop - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      el.getBoundingClientRect(); // force reflow so the next line animates
      el.style.transition = 'transform .26s cubic-bezier(0.34, 1.28, 0.5, 1)';
      el.style.transform = '';
    });
    prevRectsRef.current = new Map();
  }, [draggingId, overGap]);

  // Live preview order while dragging: the dragged node is shown already moved to
  // the hovered slot (FLIP animates the shuffle). Anchors stay pinned at the ends.
  const displayNodes = (() => {
    if (draggingId == null || overGap == null) return ordered;
    // Resolve the dragged row against the CURRENT list on every render: the id is
    // stable, its index isn't. `ordered` is rebuilt from the trip cache each render,
    // so a background refetch mid-drag can shift or drop rows. Every branch returns a
    // valid array, so the preview can never index into a hole (was the crash source).
    const from = ordered.findIndex((n) => n.id === draggingId);
    if (from < 0) return ordered;                                 // dragged row is no longer in the list
    if (overGap === from || overGap === from + 1) return ordered; // dropping back where it sits → no-op
    const arr = ordered.slice();
    const [m] = arr.splice(from, 1);
    if (arr.length === 0) return ordered;                         // nothing left to pin against
    const lo = isAnchor(arr[0]) ? 1 : 0;
    const hi = isAnchor(arr[arr.length - 1]) ? arr.length - 1 : arr.length;
    const t = Math.max(lo, Math.min(hi, overGap > from ? overGap - 1 : overGap));
    arr.splice(t, 0, m);
    return arr;
  })();

  // Keyboard reorder (a11y): move a row one slot up/down, clamped inside the
  // anchors. Same commit path as drag, so the new order + dates show instantly.
  const moveNodeById = (id, dir) => {
    const idx = ordered.findIndex((n) => n.id === id);
    if (idx < 0 || isAnchor(ordered[idx])) return;
    const arr = ordered.slice();
    const [node] = arr.splice(idx, 1);
    const lo = isAnchor(arr[0]) ? 1 : 0;
    const hi = isAnchor(arr[arr.length - 1]) ? arr.length - 1 : arr.length;
    const j = Math.max(lo, Math.min(hi, idx + dir));
    if (j === idx) return;
    arr.splice(j, 0, node);
    captureRects();
    onCommitOrder(arr.map((n) => n.id));
  };

  // Arm a pointer drag from ANYWHERE on the row. It becomes a real drag only once
  // the pointer crosses a small threshold, so a plain tap still opens the row.
  // Presses on inner controls (steppers, booking cells, links) are ignored.
  const armDrag = (e, nodeId) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target?.closest?.('.te-stepper, .te-step, .te-cellbtn, .te-actchip, .te-hotelicon, .te-addmini, a, input, select, textarea')) return;
    const rowEl = rowElRefs.current.get(nodeId);
    if (!rowEl) return;
    const cx = e.clientX, cy = e.clientY;
    const begin = (touchArmed) => {
      const rect = rowEl.getBoundingClientRect();
      dragInfoRef.current = { id: nodeId, startX: cx, startY: cy, grabOffset: cy - rect.top, ty: 0, activated: !!touchArmed, lastTarget: null };
      // Touch/pen: the long-press has armed the drag → lift the row IMMEDIATELY
      // (activated:true, no second move-threshold) so "drag started" is obvious,
      // and take the gesture off the browser's scroll handler (touch-action:none) +
      // capture the pointer so the following moves drag the row instead of scrolling
      // the page. Without the capture the browser treats the move as a scroll, fires
      // pointercancel, and the drag dies immediately.
      if (touchArmed) { setDraggingId(nodeId); setOverGap(null); document.body.style.userSelect = 'none'; }
      if (e.pointerType !== 'mouse') {
        rowEl.style.touchAction = 'none';
        try { rowEl.setPointerCapture(e.pointerId); } catch { /* capture not supported */ }
        window.addEventListener('touchmove', blockTouchScroll, { passive: false });
      }
      window.addEventListener('pointermove', stableMove);
      window.addEventListener('pointerup', stableEnd, { once: true });
      window.addEventListener('pointercancel', stableEnd, { once: true });
    };
    // Mouse: whole card draggable immediately (drag activates after a 5px move, so a
    // plain click still opens the row). Touch/pen: long-press (300ms) on the row
    // arms the drag — any scroll/lift before then cancels, so the list still scrolls
    // normally and there's no accidental reordering.
    if (e.pointerType === 'mouse') { begin(false); return; }
    // Touch: show the "pressing" depress state the instant the finger lands, so the
    // hold registers visibly (the old timer gave zero feedback → felt broken).
    setPressingId(nodeId);
    let timer = null;
    const clear = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      setPressingId(null);
      window.removeEventListener('pointermove', preMove);
      window.removeEventListener('pointerup', preUp);
      window.removeEventListener('pointercancel', preUp);
    };
    const preMove = (ev) => { if (Math.hypot(ev.clientX - cx, ev.clientY - cy) > 9) clear(); };
    const preUp = () => clear();
    window.addEventListener('pointermove', preMove, { passive: true });
    window.addEventListener('pointerup', preUp, { once: true });
    window.addEventListener('pointercancel', preUp, { once: true });
    timer = setTimeout(() => {
      clear();                                  // drop pre-arm listeners + clear the press state
      try { navigator.vibrate?.(12); } catch { /* haptic optional */ }
      begin(true);                              // hand off press → lift
    }, 400);
  };

  // Per-render move/end closures (read live values), reached via the stable
  // dispatchers above so the window listeners pair up across re-renders.
  dragHandlersRef.current.move = (e) => {
    const info = dragInfoRef.current; if (!info) return;
    if (!info.activated) { // promote arm → real drag once past the threshold
      if (Math.hypot(e.clientX - info.startX, e.clientY - info.startY) < 5) return;
      info.activated = true;
      setDraggingId(info.id); setOverGap(null);
      document.body.style.userSelect = 'none';
    }
    const rowEl = rowElRefs.current.get(info.id);
    if (rowEl) {
      const naturalTop = rowEl.getBoundingClientRect().top - info.ty;
      info.ty = (e.clientY - info.grabOffset) - naturalTop;
      rowEl.style.transition = 'none';
      rowEl.style.transform = `translateY(${info.ty}px) scale(1.03)`;
    }
    // Hit-test: first row (excluding the lifted one) whose midpoint is below the
    // pointer = insertion gap; below all → move-to-end (ordered.length).
    const ord = liveRef.current.ordered || [];
    let target = ord.length;
    for (let i = 0; i < ord.length; i++) {
      const nd = ord[i]; if (nd.id === info.id) continue;
      const el = rowElRefs.current.get(nd.id); if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { target = i; break; }
    }
    if (target !== info.lastTarget) { info.lastTarget = target; captureRects(); setOverGap(target); }
  };
  dragHandlersRef.current.end = () => {
    window.removeEventListener('pointermove', stableMove);
    window.removeEventListener('touchmove', blockTouchScroll);
    document.body.style.userSelect = '';
    const info = dragInfoRef.current;
    // Restore the row's normal touch behaviour (scroll) after a touch drag/arm.
    const armedEl = info && rowElRefs.current.get(info.id);
    if (armedEl) armedEl.style.touchAction = '';
    if (!info || !info.activated) { // a tap, not a drag → let the row click open the row
      dragInfoRef.current = null;
      return;
    }
    // A real drag happened → suppress the click that fires after pointerup, then commit.
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 60);
    const rowEl = rowElRefs.current.get(info.id);
    const order = (liveRef.current.displayNodes || []).map((n) => n.id);
    if (rowEl) { // spring the lifted row from its pointer position into its slot
      rowEl.style.transition = 'transform .44s cubic-bezier(0.34, 1.3, 0.5, 1)';
      rowEl.style.transform = 'translateY(0) scale(1)';
    }
    // Commit AFTER the settle so the final DOM order lands without a visible jump.
    setTimeout(() => {
      if (dragInfoRef.current !== info) return;
      onCommitOrder(order);
      if (rowEl) { rowEl.style.transition = ''; rowEl.style.transform = ''; }
      dragInfoRef.current = null;
      endDrag();
    }, 230);
  };

  // Mirror live render values for the window listeners (they can't close over
  // post-early-return locals directly).
  liveRef.current = { ordered, displayNodes };

  return { draggingId, overGap, pressingId, displayNodes, setRowRef, armDrag, moveNodeById, justDraggedRef };
}
