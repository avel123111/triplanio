// keepFocusInDialog — the SINGLE onOpenAutoFocus handler shared by every Radix
// dialog / sheet / drawer shell (ui/dialog, ui/Sheet, EventDrawerHost, and the
// stats/editor sheet surfaces). One owner of "where focus lands when a dialog
// opens", so the behaviour can't drift between shells. (TRIP-202)
//
// Why not Radix's default: it moves focus to the first focusable element, which
// on mobile is often a search input → the keyboard pops and yanks the fixed
// bottom-sheet up the screen (iOS zoom). The previous fix was `e.preventDefault()`
// alone — but that LEAVES focus on the background trigger while Radix marks the
// rest of the page `aria-hidden`, producing the console warning "Blocked
// aria-hidden on an element because its descendant retained focus" and a real
// screen-reader bug (focus sits on a hidden element).
//
// This moves focus to the dialog CONTENT container itself (a non-input element):
//   • focus lands INSIDE the portal, which is not aria-hidden → no violation;
//   • no input is focused → no keyboard / no iOS zoom (behaviour preserved).
export function keepFocusInDialog(e) {
  e.preventDefault();
  const node = e.currentTarget;
  if (node && typeof node.focus === 'function') node.focus();
}
