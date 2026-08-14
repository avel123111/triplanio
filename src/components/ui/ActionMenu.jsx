// @ts-check
import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Icon } from '@/design/icons';
import { Tile } from '@/design/Tile';
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
 *   { icon?, label, tone?, danger?, disabled?, onSelect }  — an action row
 *   { separator: true }                                    — a divider
 * Falsy entries are ignored, so callers can build the list conditionally.
 *
 * `tone` (an event/role tile tone) upgrades the mobile-sheet row to a colored
 * leading `<Tile>` + trailing chevron (`.sheet-row--tile`) — used by the bottom-nav
 * "+" add menu. Without `tone` the row stays the bare icon+label form. Desktop
 * (`.mi`) ignores `tone`; the "+" menu only ever renders on mobile.
 *
 *   <ActionMenu
 *     title="Actions"
 *     trigger={<IconBtn icon="more" size="sm" ariaLabel="Actions" />}
 *     items={[
 *       { icon: 'send', label: 'Resend', onSelect: resend },
 *       { separator: true },
 *       { icon: 'trash', label: 'Remove', danger: true, onSelect: remove },
 *     ]}
 *   />
 */
/** @param {{ trigger: any, items?: any[], align?: 'start'|'center'|'end', side?: 'top'|'right'|'bottom'|'left', sideOffset?: number, width?: number, title?: string }} p */
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
          {/* TRIP-391 объект 1 → объект 6: .sheet-row — ПУНКТ меню-шита, не кнопка-примитив. */}
          {list.map((it, i) => (it.separator ? (
            <div key={i} className="sheet-sep" />
          ) : (
            <button
              key={i}
              type="button"
              className={'sheet-row' + (it.tone ? ' sheet-row--tile' : '') + (it.danger ? ' sheet-row--danger' : '')}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onSelect?.(); }}
            >
              {it.tone
                ? <Tile tone={it.tone} icon={it.icon} />
                : (it.icon ? <Icon name={it.icon} size={18} /> : null)}
              <span className="grow">{it.label}</span>
              {it.tone ? <Icon name="chev" size={18} /> : null}
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
              <span className="grow">{it.label}</span>
            </DropdownMenu.Item>
          )))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default ActionMenu;
