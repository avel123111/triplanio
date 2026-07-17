import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * C6 · Sheet — canonical mobile bottom-sheet (Lumo `.sheet`).
 *
 * Built on vaul's `Drawer` (which itself wraps Radix Dialog, so we keep the
 * focus-trap, Esc / outside-click and scroll-lock we had before). vaul owns the
 * gesture + animation: the whole surface is draggable with native momentum,
 * velocity-based dismiss, and a spring settle — replacing the old grip-only
 * hand-rolled drag. `repositionInputs` (default) lifts the sheet above the iOS
 * keyboard instead of the page jumping/shrinking, so inputs behave.
 *
 * Used as the mobile shell for menus (ActionMenu) and pickers (SearchSelect)
 * under the mobile breakpoint. On desktop those components render their anchored
 * variants instead.
 *
 *   <Sheet open={open} onOpenChange={setOpen} title="Actions">
 *     ...rows...
 *   </Sheet>
 *
 * Persistent-peek variant (map lens · TRIP-234) — the SAME vaul engine in a
 * different mode: pass `snapPoints` + `modal={false}` + `dismissible={false}`
 * for a non-modal sheet that sits over live content (the map stays interactive
 * underneath), never dismisses, and rests at snap heights (peek ↔ expanded)
 * instead of the single-height modal drag. vaul owns the snap physics, so the
 * consumer no longer hand-rolls a grip drag. `modal={false}` drops the backdrop
 * + scroll-lock + focus-trap; `bare` renders children without the `.sheet-b`
 * padding wrapper (the consumer brings its own header/body).
 *
 *   <Sheet open modal={false} dismissible={false}
 *          snapPoints={['148px', 0.62]} activeSnapPoint={snap} setActiveSnapPoint={setSnap} bare>
 *     ...head + scrollable list...
 *   </Sheet>
 */
export function Sheet({
  open, onOpenChange, title, children, className = '', bodyClassName = '', titleText,
  snapPoints, activeSnapPoint, setActiveSnapPoint, modal = true, dismissible = true, bare = false,
}) {
  const t = useT();
  return (
    // repositionInputs={false}: the app's viewport meta uses
    // `interactive-widget=resizes-content`, so the layout viewport already
    // shrinks above the keyboard and this bottom-anchored sheet (bottom:0 +
    // dvh) sits above it natively. Letting vaul ALSO reposition (its default)
    // double-moves the sheet → the "flying / jumps on focus" bug.
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      repositionInputs={false}
      modal={modal}
      dismissible={dismissible}
      snapPoints={snapPoints}
      activeSnapPoint={activeSnapPoint}
      setActiveSnapPoint={setActiveSnapPoint}
    >
      <Drawer.Portal>
        {/* Modal sheets darken the page behind them; the non-modal peek variant
            has no backdrop so the live content (map) stays visible + clickable. */}
        {modal && <Drawer.Overlay className="sheet-backdrop" />}
        {/* vaul does NOT auto-focus into the sheet on open, so the mobile keyboard
            stays down until the user taps a field (no jump / iOS zoom on open). */}
        <Drawer.Content className={'sheet' + (className ? ' ' + className : '')} aria-describedby={undefined}>
          {/* Visual drag affordance only — the whole sheet is draggable (vaul), so
              this carries no handlers. */}
          <div className="sheet-grip" aria-hidden><i /></div>
          {title ? (
            <div className="sheet-h">
              <Drawer.Title asChild><h3>{title}</h3></Drawer.Title>
              {/* No close affordance when the sheet can't be dismissed (peek variant). */}
              {dismissible && <Drawer.Close className="close" aria-label={t('common.close')}><X size={16} /></Drawer.Close>}
            </div>
          ) : (
            <Drawer.Title style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              {titleText || t('common.menu')}
            </Drawer.Title>
          )}
          {bare ? children : <div className={'sheet-b' + (bodyClassName ? ' ' + bodyClassName : '')}>{children}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export default Sheet;
