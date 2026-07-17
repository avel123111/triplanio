import { Drawer } from 'vaul';

/**
 * LpSheet — the shared mobile shell for the in-place editor panels (the `.lp-sheet`
 * skin): a bare, full-height vaul Drawer that hosts a panel which brings its OWN
 * header / Back button (CityPanel, EventSourcePanel, AddBookingPanel, …).
 *
 * Single-sourced here so the two callers can't drift: on phones (≤640) BOTH the
 * structure editor (TripStructureEdit) and the global EventDrawerHost render their
 * mobile panel through this. Previously each hand-rolled the identical
 * Drawer.Root→Portal→Overlay→Content markup.
 *
 * vaul owns the slide / drag / swipe-down-to-dismiss and lifts the sheet above the
 * keyboard; backdrop tap and the panel's own Back button also close it.
 * `repositionInputs={false}`: the viewport meta (`interactive-widget=
 * resizes-content`) already lifts a bottom-anchored sheet above the keyboard;
 * letting vaul reposition too double-moves it (the "flying" bug).
 *
 * The breakpoint (sheet vs each host's own desktop layout) stays in the caller —
 * this is only the mobile shell.
 */
const SR_ONLY = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' };

export default function LpSheet({ open, onClose, title = '', children }) {
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { if (!o) onClose?.(); }} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-backdrop" />
        {/* vaul wraps Radix Dialog, which requires a Title for a11y — kept sr-only
            since the hosted panel renders its own visible heading. */}
        <Drawer.Content className="lp-sheet" aria-describedby={undefined}>
          <Drawer.Title className="sr-only" style={SR_ONLY}>{title}</Drawer.Title>
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
