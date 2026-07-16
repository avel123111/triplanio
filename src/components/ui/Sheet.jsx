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
 * `useSheetSwipe`. `repositionInputs` (default) lifts the sheet above the iOS
 * keyboard instead of the page jumping/shrinking, so inputs behave.
 *
 * Used as the mobile shell for menus (ActionMenu) and pickers (SearchSelect)
 * under the mobile breakpoint. On desktop those components render their anchored
 * variants instead.
 *
 *   <Sheet open={open} onOpenChange={setOpen} title="Actions">
 *     ...rows...
 *   </Sheet>
 */
export function Sheet({ open, onOpenChange, title, children, className = '', bodyClassName = '', titleText }) {
  const t = useT();
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-backdrop" />
        {/* vaul does NOT auto-focus into the sheet on open, so the mobile keyboard
            stays down until the user taps a field (no jump / iOS zoom on open). */}
        <Drawer.Content className={'sheet' + (className ? ' ' + className : '')} aria-describedby={undefined}>
          {/* Visual drag affordance only — the whole sheet is draggable (vaul), so
              this carries no handlers. */}
          <div className="sheet-grip" aria-hidden><i /></div>
          {title ? (
            <div className="sheet-h">
              <Drawer.Title asChild><h3>{title}</h3></Drawer.Title>
              <Drawer.Close className="close" aria-label={t('common.close')}><X size={16} /></Drawer.Close>
            </div>
          ) : (
            <Drawer.Title style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              {titleText || t('common.menu')}
            </Drawer.Title>
          )}
          <div className={'sheet-b' + (bodyClassName ? ' ' + bodyClassName : '')}>{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export default Sheet;
