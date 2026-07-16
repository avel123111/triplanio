// Single source of truth for the visible viewport rectangle while the on-screen
// keyboard is open, published as `--vv-top` / `--vv-h` on :root (px).
//
// Why (TRIP-234): on iOS Safari the keyboard does NOT resize the layout viewport
// and it PANS the visual viewport (moves it up, `offsetTop`) to reveal the focused
// field — so a `position:fixed` sheet (anchored to the layout viewport) gets pushed
// off the top / floats. `dvh` / `interactive-widget` are Chromium-only no-ops here.
// The only correct fix is to stop anchoring the sheet to the page and anchor it to
// the VISIBLE VIEWPORT instead: one rectangle = { top: offsetTop, height }. A fixed
// sheet set to `top: var(--vv-top); height: var(--vv-h)` then exactly overlays the
// area above the keyboard, pan-compensated, with no separate keyboard-height math.
//
// Vars are set ONLY while a keyboard is open (>60px), and cleared otherwise, so
// sheets keep their default bottom-sheet geometry (hug content) when it's closed.
export function initKeyboardInset() {
  const vv = typeof window !== 'undefined' && window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let raf = 0;
  const measure = () => {
    raf = 0;
    const keyboard = window.innerHeight - vv.height; // >0 only when a keyboard shows
    if (keyboard > 60) {
      root.style.setProperty('--vv-top', Math.round(vv.offsetTop) + 'px');
      root.style.setProperty('--vv-h', Math.round(vv.height) + 'px');
    } else {
      root.style.removeProperty('--vv-top');
      root.style.removeProperty('--vv-h');
    }
  };
  const schedule = () => { if (!raf) raf = window.requestAnimationFrame(measure); };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  measure();
}
