import { SheetRoot, SheetSurface, SheetTitle } from '@/components/ui/sheetShell';

/**
 * LpSheet — the shared mobile shell for the in-place editor panels (the `.lp-sheet`
 * skin): a bare, full-height sheet that hosts a panel which brings its OWN
 * header / Back button (CityPanel, EventSourcePanel, AddBookingPanel, …).
 *
 * Single-sourced here so the two callers can't drift: on phones (≤640) BOTH the
 * structure editor (TripStructureEdit) and the global EventDrawerHost render their
 * mobile panel through this. Previously each hand-rolled the identical
 * Drawer.Root→Portal→Overlay→Content markup.
 *
 * Движение принадлежит шву `ui/sheetShell` (единственный дом vaul): слайд,
 * свайп-вниз-на-закрытие и подъём над клавиатурой. Грипа у этой поверхности
 * нет намеренно — она полноэкранная (`top: 0`), «бровь» обещала бы шторку по
 * содержимому; закрывают её кнопка «Назад» самой панели, свайп и тап по фону.
 *
 * The breakpoint (sheet vs each host's own desktop layout) stays in the caller —
 * this is only the mobile shell.
 */
export default function LpSheet({ open, onClose, title = '', children }) {
  return (
    <SheetRoot open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      {/* vaul wraps Radix Dialog, which requires a Title for a11y — kept sr-only
          since the hosted panel renders its own visible heading. */}
      <SheetSurface className="lp-sheet" grip={false} aria-describedby={undefined}>
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {children}
      </SheetSurface>
    </SheetRoot>
  );
}
