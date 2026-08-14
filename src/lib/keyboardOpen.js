// @ts-check
// Single source of truth for "the on-screen keyboard is up" (mobile). Exposes
// the state two ways so each consumer uses the RIGHT one:
//   • `data-keyboard` attribute on <html> — for CSS that hides NON-canon chrome
//     by state (the floating nav `.mbnav`, the editor-panel footer `.lp-f`). A
//     document-state DATA ATTRIBUTE, not a class, on purpose: a new state class
//     would grow the design-floor class count (guard 2o), and root state is a
//     data attribute in every design system (`data-theme`, …) anyway.
//   • `useKeyboardOpen()` hook — for a CANON design-system primitive that must
//     own its own DOM instead of being restyled from outside (the sheet footer
//     `.dlg__foot`, owned by <Dialog>). Reaching into a canon primitive from an
//     outer selector is the coupling the design floor (guard 2o `reach`) forbids,
//     so the primitive hides ITSELF via this hook.
//
// The signal is VIEWPORT GEOMETRY, not input focus. The app's viewport meta uses
// `interactive-widget=resizes-content`, so the keyboard SHRINKS the visual
// viewport; we flag it open when the height drops well below the tallest height
// seen in the current orientation. Focus was the first attempt and it was racy:
// on mobile, tapping the bottom nav can restore focus to the last field, which
// re-hid the nav the instant it was pressed. Geometry does not move when you tap
// a button.
//
// ponytail: a minimal DOM-level watcher (no lib) — the one honest signal for a
// keyboard that resizes content is the resize itself. Upgrade path: the
// VirtualKeyboard API (`navigator.virtualKeyboard`) once broadly supported.
import { useSyncExternalStore } from 'react';

// A drop bigger than this (px) counts as "keyboard is up". Keeps the URL-bar
// show/hide (~60–100px) from flipping it; a soft keyboard is ~260–320px.
const OPEN_DELTA = 120;

let open = false;
const subscribers = new Set();

/** @param {() => void} cb */
function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
const getSnapshot = () => open;

/** React hook: true while the soft keyboard is up. For a canon primitive that
 *  must hide its own chrome (e.g. <Dialog>'s footer) rather than be reached
 *  into from CSS. */
export function useKeyboardOpen() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

let started = false;

export function startKeyboardOpenWatch() {
  if (started || typeof window === 'undefined') return;
  const vv = window.visualViewport;
  // No VisualViewport → skip: chrome just stays put (the old, pre-feature look).
  if (!vv) return;
  started = true;

  const root = document.documentElement;
  let baseline = vv.height; // tallest height this orientation = no keyboard

  const update = () => {
    const h = vv.height;
    if (h > baseline) baseline = h;          // grow baseline (URL bar hides, rotate)
    const next = baseline - h > OPEN_DELTA;
    if (next !== open) { open = next; subscribers.forEach((cb) => cb()); }
    root.toggleAttribute('data-keyboard', next);
  };

  vv.addEventListener('resize', update);
  // Orientation flips the height; drop the flag and re-seat the baseline once
  // the new size settles so a rotate doesn't read as a keyboard.
  window.addEventListener('orientationchange', () => {
    root.removeAttribute('data-keyboard');
    if (open) { open = false; subscribers.forEach((cb) => cb()); }
    setTimeout(() => { baseline = vv.height; update(); }, 300);
  });
  update();
}
