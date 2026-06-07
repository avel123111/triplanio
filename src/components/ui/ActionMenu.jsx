import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Icon } from '@/design/icons';

/**
 * C5 · ActionMenu — the canonical action / "…" / kebab menu for the whole app.
 *
 * Replaces every hand-rolled dropdown (local useState + outside-click + absolute
 * div): MembersLens row menu, ScreenAccount language listbox, TripView MoreMenu.
 * Built on the (previously unused) Radix dropdown-menu primitive and styled with
 * the Lumo `.menu` classes in app.css. Closes on Esc / outside-click and is
 * keyboard-navigable for free.
 *
 * Usage:
 *   <ActionMenu align="end" width={220} trigger={
 *     <button className="icon-btn menu-trig"><Icon name="more" /></button>
 *   }>
 *     <ActionItem icon="send" onSelect={resend}>Resend</ActionItem>
 *     <ActionSeparator />
 *     <ActionItem icon="trash" danger onSelect={remove}>Remove</ActionItem>
 *   </ActionMenu>
 */
export function ActionMenu({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  sideOffset = 6,
  width,
  open,
  onOpenChange,
}) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
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
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function ActionItem({ icon, danger, disabled, onSelect, children }) {
  return (
    <DropdownMenu.Item
      className={'mi' + (danger ? ' mi--danger' : '')}
      disabled={disabled}
      onSelect={onSelect}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      <span style={{ flex: 1 }}>{children}</span>
    </DropdownMenu.Item>
  );
}

export function ActionSeparator() {
  return <DropdownMenu.Separator className="sep" />;
}

export default ActionMenu;
