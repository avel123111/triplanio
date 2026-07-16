// Keyboard-safe sheet height on iOS.
//
// A `position: fixed` bottom sheet is anchored to the bottom of the viewport, so
// when the on-screen keyboard opens the sheet sits above it — but `dvh`/`vh` do
// NOT reliably shrink for the keyboard on iOS Safari (a fixed element keeps
// resolving them against the full viewport), so a tall sheet grows past the top
// of the screen and its header slides off. We publish the ACTUAL visible height
// from `visualViewport` as `--vvh`; sheets cap their `max-height` to it so they
// always fit the space above the keyboard (header stays put, body scrolls).
//
// We deliberately do NOT move the sheet's position here — vaul + the sheet's
// `bottom: 0` already sit it above the keyboard. This var is height-only.
export function initKeyboardInset() {
  if (typeof window === 'undefined') return () => {};
  const root = document.documentElement;
  const vv = window.visualViewport;
  if (!vv) { root.style.setProperty('--vvh', '100dvh'); return () => {}; }

  let raf = 0;
  const apply = () => {
    raf = 0;
    root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
  };
  const onChange = () => { if (!raf) raf = requestAnimationFrame(apply); };

  apply();
  vv.addEventListener('resize', onChange);
  vv.addEventListener('scroll', onChange);
  return () => {
    vv.removeEventListener('resize', onChange);
    vv.removeEventListener('scroll', onChange);
    if (raf) cancelAnimationFrame(raf);
  };
}
