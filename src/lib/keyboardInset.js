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
    const kbRaw = window.innerHeight - vv.height; // real keyboard height (iOS: innerHeight stays full)
    if (kbRaw > 60) {
      // Keyboard open. Two vars:
      //  --kb  = distance to lift the sheet's bottom so it lands on the keyboard top,
      //          pan-corrected (offsetTop is how far iOS has already scrolled up).
      //  --vvh = the ACTUAL visible height above the keyboard (px). The sheet caps its
      //          max-height to THIS — not to dvh, which on iOS never shrinks for the
      //          keyboard, so the sheet stayed full-height and its header slid off-top.
      root.style.setProperty('--kb', Math.max(0, Math.round(kbRaw - vv.offsetTop)) + 'px');
      root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    } else {
      // Keyboard closed → clear both so sheets keep their default geometry unchanged.
      root.style.removeProperty('--kb');
      root.style.removeProperty('--vvh');
    }
  };
  const schedule = () => { if (!raf) raf = window.requestAnimationFrame(measure); };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  measure();
}
