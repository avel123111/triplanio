// @ts-check
// Toggles `has-keyboard` on <html> while the on-screen keyboard is up, so CSS can
// hide bottom chrome that would otherwise rise above the keyboard and collide
// with the Chrome/iOS autofill bar: the floating mobile nav (`.mbnav`) and the
// sheet action-footer (`.dlg__foot` / `.lp-f`).
//
// The signal is VIEWPORT GEOMETRY, not input focus. The app's viewport meta uses
// `interactive-widget=resizes-content`, so the keyboard SHRINKS the visual
// viewport; we flag it open when the height drops well below the tallest height
// seen in the current orientation. Focus (`:has(:focus)`) was the first attempt
// and it was racy: on mobile, tapping the bottom nav can restore focus to the
// last field, which re-hid the nav the instant it was pressed. Geometry does not
// move when you tap a button, so the nav stays put. Reuses the `has-` html-class
// state namespace the nav already uses for `has-bottom-dock` (rule #6: no new
// prefix) — a document-level boolean flag, same shape.
//
// ponytail: a minimal DOM-level watcher (no lib) — the one honest signal for a
// keyboard that resizes content is the resize itself. Upgrade path: the
// VirtualKeyboard API (`navigator.virtualKeyboard`) once broadly supported.

// A drop bigger than this (px) counts as "keyboard is up". Keeps the URL-bar
// show/hide (~60–100px) from flipping it; a soft keyboard is ~260–320px.
const OPEN_DELTA = 120;

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
    root.classList.toggle('has-keyboard', baseline - h > OPEN_DELTA);
  };

  vv.addEventListener('resize', update);
  // Orientation flips the height; drop the flag and re-seat the baseline once
  // the new size settles so a rotate doesn't read as a keyboard.
  window.addEventListener('orientationchange', () => {
    root.classList.remove('has-keyboard');
    setTimeout(() => { baseline = vv.height; update(); }, 300);
  });
  update();
}
