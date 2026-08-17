// @ts-check
import { Drawer } from 'vaul';
import { IconBtn } from '@/design/IconBtn';
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
 */
/** @param {{ open: boolean, onOpenChange: (v: boolean) => void, title?: any, children?: any, className?: string, bodyClassName?: string, titleText?: string }} p */
export function Sheet({ open, onOpenChange, title, children, className = '', bodyClassName = '', titleText }) {
  const t = useT();
  return (
    // repositionInputs={false}: the app's viewport meta uses
    // `interactive-widget=resizes-content`, so the layout viewport already
    // shrinks above the keyboard and this bottom-anchored sheet (bottom:0 +
    // dvh) sits above it natively. Letting vaul ALSO reposition (its default)
    // double-moves the sheet → the "flying / jumps on focus" bug.
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
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
              {/* ★TRIP-344: крестик - тот же объект, что в диалоге, и рисуется
                  тем же примитивом. `asChild` нужен, чтобы vaul повесил свои
                  обработчики на САМУ кнопку, а не на лишнюю обёртку. Ховера у
                  него не было вовсе - теперь приходит с тоном. */}
              <Drawer.Close asChild>
                <IconBtn icon="close" ariaLabel={t('common.close')} />
              </Drawer.Close>
            </div>
          ) : (
            <Drawer.Title className="sr-only">
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
