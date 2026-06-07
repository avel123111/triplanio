import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Icon } from '@/design/icons';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet } from '@/components/ui/Sheet';

/**
 * C5 · ActionMenu — the canonical action / "…" / kebab menu for the whole app.
 *
 * Responsive: on desktop it's an anchored Radix dropdown (Lumo `.menu`); under
 * the mobile breakpoint it becomes a bottom-sheet (Lumo `.sheet`) with big tap
 * rows. Both render from the same `items` array, so callers declare actions
 * once. Closes on Esc / outside-click; keyboard-navigable on desktop.
 *
 * items: array of
 *   { icon?, label, danger?, disabled?, onSelect }  — an action row
 *   { separator: true }                              — a divider
 * Falsy entries are ignored, so callers can build the list conditionally.
 *
 *   <ActionMenu
 *     title="Actions"
 *     trigger={<button className="icon-btn menu-trig"><Icon name="more" /></button>}
 *     items={[
 *       { icon: 'send', label: 'Resend', onSelect: resend },
 *       { separator: true },
 *       { icon: 'trash', label: 'Remove', danger: true, onSelect: remove },
 *     ]}
 *   />
 */
export function ActionMenu({ trigger, items = [], align = 'end', side = 'bottom', sideOffset = 6, width, title }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const list = items.filter(Boolean);

  if (isMobile) {
    const triggerEl = React.cloneElement(trigger, {
      onClick: (e) => { trigger.props?.onClick?.(e); setOpen(true); },
    });
    return (
      <>
        {triggerEl}
        <Sheet open={open} onOpenChange={setOpen} title={title}>
          {list.map((it, i) => (it.separator ? (
            <div key={i} className="sheet-sep" />
          ) : (
            <button
              key={i}
              type="button"
              className={'sheet-row' + (it.danger ? ' sheet-row--danger' : '')}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onSelect?.(); }}
            >
              {it.icon ? <Icon name={it.icon} size={18} /> : null}
              <span style={{ flex: 1 }}>{it.label}</span>
            </button>
          )))}
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu"
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={8}
          style={width ? { width } : undefined}
        >
          {list.map((it, i) => (it.separator ? (
            <DropdownMenu.Separator key={i} className="sep" />
          ) : (
            <DropdownMenu.Item
              key={i}
              className={'mi' + (it.danger ? ' mi--danger' : '')}
              disabled={it.disabled}
              onSelect={it.onSelect}
            >
              {it.icon ? <Icon name={it.icon} size={16} /> : null}
              <span style={{ flex: 1 }}>{it.label}</span>
            </DropdownMenu.Item>
          )))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default ActionMenu;
