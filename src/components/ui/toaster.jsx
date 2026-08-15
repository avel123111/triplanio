import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import {
  Toast,
  ToastBody,
  ToastClose,
  ToastProvider,
  ToastViewport,
} from "@/components/ui/toast";

// Per-variant auto-dismiss timing. Errors/warnings linger longer so the user
// can read the unexpected message; success/info clear quickly. A toast may
// override this with an explicit `duration` (ms) in its options.
const DURATION = { error: 8000, destructive: 8000, warning: 8000 };
const DEFAULT_DURATION = 5000;
function durationFor(tt) {
  return typeof tt.duration === "number"
    ? tt.duration
    : DURATION[tt.variant] ?? DEFAULT_DURATION;
}

// Gap (px) between cards once the deck is fanned into a column.
const GAP = 12;
// Cards kept visible in the collapsed deck; deeper ones fade out behind.
const MAX_DECK = 3;

// The toasts are dealt as a DECK, not a row: newest in front, older ones
// peeking behind it, scaled down. Hover / keyboard-focus fans the deck into a
// readable column. All motion is CSS (transitions on transform/opacity keyed by
// `--i` = depth and `--y` = summed heights of the cards in front). This
// component only owns the bookkeeping the cascade cannot see: which card is
// entering/leaving, each card's depth, and the measured stack offset.
export function Toaster() {
  const { toasts, dismiss } = useToast();

  // Auto-dismiss: schedule a one-shot timer per open toast, once. Manual close
  // (or the toast leaving the store) clears its timer. Idempotent across the
  // frequent re-renders of the toast store.
  const timers = useRef(new Map());
  useEffect(() => {
    const liveIds = new Set();
    toasts.forEach((tt) => {
      if (tt.open === false) return;
      liveIds.add(tt.id);
      if (timers.current.has(tt.id)) return;
      const handle = setTimeout(() => {
        timers.current.delete(tt.id);
        dismiss(tt.id);
      }, durationFor(tt));
      timers.current.set(tt.id, handle);
    });
    // Drop timers for toasts that are gone or already closed.
    timers.current.forEach((handle, id) => {
      if (!liveIds.has(id)) {
        clearTimeout(handle);
        timers.current.delete(id);
      }
    });
  }, [toasts, dismiss]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  // Entry animation: a freshly-added toast renders one frame in its `enter`
  // (off-edge, faded) pose, then flips to `visible` so the CSS transition plays.
  // `seen` tracks which ids have been through that first frame.
  const seen = useRef(new Set());
  const [entered, setEntered] = useState(() => new Set());
  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    seen.current.forEach((id) => { if (!live.has(id)) seen.current.delete(id); });

    const fresh = toasts.filter((t) => !seen.current.has(t.id));
    fresh.forEach((t) => seen.current.add(t.id));

    setEntered((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      const changed = next.size !== prev.size;
      if (!fresh.length) return changed ? next : prev;
      // Flip the fresh toasts to `visible` on the next frame (after the browser
      // has painted their `enter` pose) so the transition has a from-state.
      requestAnimationFrame(() => setEntered((cur) => {
        const n = new Set(cur);
        fresh.forEach((t) => n.add(t.id));
        return n;
      }));
      return next;
    });
  }, [toasts]);

  // Stack geometry: measure the OPEN cards front-to-back and write each card's
  // depth (`--i`) + the offset it must travel to sit in the fanned column
  // (`--y` = summed heights of every card in front of it). Runs every render
  // (heights depend on content) and on resize (width change re-wraps text).
  const nodes = useRef(new Map());
  const [, bump] = useReducer((x) => x + 1, 0);
  useLayoutEffect(() => {
    const open = toasts.filter((t) => t.open !== false);
    let cum = 0;
    open.forEach((t, i) => {
      const el = nodes.current.get(t.id);
      if (!el) return;
      el.style.setProperty("--i", String(i));
      el.style.setProperty("--y", `${cum}px`);
      cum += el.offsetHeight + GAP;
    });
  });
  useEffect(() => {
    window.addEventListener("resize", bump);
    return () => window.removeEventListener("resize", bump);
  }, []);

  const openIndex = new Map(
    toasts.filter((t) => t.open !== false).map((t, i) => [t.id, i]),
  );

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, open, onOpenChange: _onOpenChange, ...props }) {
        const leaving = open === false;
        const state = leaving ? "leave" : (entered.has(id) ? "visible" : "enter");
        const deep = !leaving && openIndex.get(id) >= MAX_DECK;
        return (
          <Toast
            key={id}
            ref={(el) => { if (el) nodes.current.set(id, el); else nodes.current.delete(id); }}
            data-state={state}
            data-deep={deep ? "" : undefined}
            {...props}
          >
            <ToastBody title={title} description={description} />
            {action}
            <ToastClose onClick={() => dismiss(id)} />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
