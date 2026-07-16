// Single source of truth for the on-screen keyboard inset, published as the
// `--kb` CSS variable on :root (px). Mobile bottom sheets read it to sit above
// the keyboard.
//
// Why this exists (TRIP-234): on iOS Safari the keyboard does NOT resize the
// layout viewport, and `interactive-widget=resizes-content` / `dvh` are
// Chromium-only no-ops there. The ONLY reliable signal is `window.visualViewport`.
// We measure the keyboard overlap = layout height − (visible height + pan offset)
// and expose it once, globally, so every sheet uses the same number instead of
// each rolling its own (and fighting each other / vaul).
//
// Pair with vaul's `noBodyStyles`: vaul otherwise pins `body{position:fixed}` for
// scroll-lock, which makes iOS PAN the fixed sheet when an input is focused — that
// pan is what made earlier sheets "fly". With no body-lock there is no pan, so
// lifting the sheet by exactly `--kb` lands it flush on the keyboard.
export function initKeyboardInset() {
  const vv = typeof window !== 'undefined' && window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let raf = 0;
  const measure = () => {
    raf = 0;
    // Clamp ≥0; round to avoid sub-pixel thrash. offsetTop covers any residual pan.
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--kb', kb + 'px');
  };
  const schedule = () => { if (!raf) raf = window.requestAnimationFrame(measure); };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  measure();
}
