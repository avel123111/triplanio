import { useEffect, useRef } from "react";
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
const durationFor = (tt) =>
  typeof tt.duration === "number" ? tt.duration : (DURATION[tt.variant] ?? DEFAULT_DURATION);

// Hide toasts whose `open` flag has been flipped to false by the reducer.
// Our Toast primitive is a plain <div> (not Radix' Toast.Root), so the
// `open=false` data attribute alone wouldn't remove the DOM - we filter
// here. The close button below dispatches DISMISS_TOAST, which flips `open`
// to false and triggers a re-render via the toast store listener.
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

  return (
    <ToastProvider>
      {toasts
        // eslint-disable-next-line no-unused-vars
        .filter((tt) => tt.open !== false)
        .map(function ({ id, title, description, action, open: _open, onOpenChange: _onOpenChange, ...props }) {
          return (
            <Toast key={id} {...props}>
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
