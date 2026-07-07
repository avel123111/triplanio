import React, { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { keepFocusInDialog } from '@/lib/dialogFocus';

/**
 * Global host for the event / city side panels — the same "drawer" panels the
 * structure editor uses (EventSourcePanel / CityPanel / EventEditDialog panel),
 * now presentable OUTSIDE the editor (timeline / calendar / budget / overview)
 * so those screens drop the legacy EventModal (TRIP-195).
 *
 * Placement:
 *  - ≤640px: the shared Radix bottom-sheet (`.lp-sheet` / `.sheet-backdrop`),
 *    identical to the editor's mobile panel.
 *  - >640px: a left-anchored drawer that fills the nearest POSITIONED ancestor.
 *    Mount it inside a `position: relative` container that already sits below the
 *    header and right of the menu (e.g. `.trip-content`) so the drawer never
 *    covers the header or the menu — only the content area.
 *
 * `scrim` is the variable screen shading (TRIP-195): the editor opens these same
 * panels WITHOUT a scrim (the map stays interactive), whereas timeline/calendar
 * pass `scrim` so the rest of the content dims. Clicking the scrim does NOT close
 * the drawer (product decision) — close via the panel's own Back/Done or Esc.
 */
export default function EventDrawerHost({ open, onClose, scrim = false, title = '', children }) {
  const drawerRef = useRef(null);

  // ≤640 → bottom sheet, matching the `.lp-sheet` CSS breakpoint (NOT the 768px
  // useIsMobile hook: the sheet styles only kick in at ≤640, so a wider breakpoint
  // would render sheet markup with no matching CSS).
  const [isSheet, setIsSheet] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = () => setIsSheet(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Desktop drawer: move focus into the panel on open, Esc closes.
  useEffect(() => {
    if (!open || isSheet) return;
    drawerRef.current?.focus();
  }, [open, isSheet]);

  if (!open) return null;

  if (isSheet) {
    return (
      <DialogPrimitive.Root open onOpenChange={(o) => { if (!o) onClose?.(); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="sheet-backdrop" />
          <DialogPrimitive.Content
            className="lp-sheet"
            onOpenAutoFocus={keepFocusInDialog}
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              {title}
            </DialogPrimitive.Title>
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };

  return (
    <>
      {scrim && <div className="evd-scrim" aria-hidden />}
      <div ref={drawerRef} tabIndex={-1} onKeyDown={onKey} className="evd-drawer">
        {children}
      </div>
    </>
  );
}
