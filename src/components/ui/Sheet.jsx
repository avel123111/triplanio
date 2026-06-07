import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

/**
 * C6 · Sheet — canonical mobile bottom-sheet (Lumo `.sheet`).
 *
 * Thin wrapper over Radix Dialog so we get focus-trap, Esc / outside-click and
 * scroll-lock for free. Used as the mobile shell for menus (ActionMenu) and
 * pickers (SearchSelect) under the mobile breakpoint. On desktop those
 * components render their anchored variants instead.
 *
 *   <Sheet open={open} onOpenChange={setOpen} title="Actions">
 *     ...rows...
 *   </Sheet>
 */
export function Sheet({ open, onOpenChange, title, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-backdrop" />
        {/* Don't auto-focus into the sheet on open: on mobile that pops the
            keyboard for a search field, which yanks the fixed sheet up the
            screen and triggers iOS zoom. Focus is taken on user tap instead. */}
        <Dialog.Content className="sheet" aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="sheet-grip"><i /></div>
          {title ? (
            <div className="sheet-h">
              <Dialog.Title asChild><h3>{title}</h3></Dialog.Title>
              <Dialog.Close className="close" aria-label="Close"><X size={16} /></Dialog.Close>
            </div>
          ) : (
            <Dialog.Title className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              {title || 'Menu'}
            </Dialog.Title>
          )}
          <div className="sheet-b">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default Sheet;
