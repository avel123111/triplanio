// Native-app-style bottom sheets on mobile.
//
// On iOS Safari a `position: fixed` element is positioned against the LAYOUT
// viewport, which does not shrink (nor scroll) when the on-screen keyboard opens
// — so a bottom sheet gets shoved up the page / floats over the keyboard, and a
// pinned full-height shell (.flow-page) flies up off-screen because the browser
// scrolls the VISUAL viewport (offsetTop) to reveal the focused field while the
// fixed shell stays glued to layout y=0. We track the VISUAL viewport instead
// and publish CSS vars on <html>:
//   --kb  : keyboard inset in px (height the keyboard covers at the bottom)
//   --vvh : current visible viewport height in px
//   --vvw : current visible viewport width in px
//   --vvt : visual-viewport offsetTop in px (how far it scrolled down)
//   --vvl : visual-viewport offsetLeft in px (zoom panning)
// Sheets/dialogs anchor to `bottom: var(--kb)` and cap their height to `--vvh`,
// so they sit right above the keyboard and never jump. A fixed shell overlays
// the visible region exactly via top:var(--vvt)/left:var(--vvl)/width:var(--vvw)/
// height:var(--vvh), so it follows the keyboard scroll / zoom pan instead of
// flying up.
export function initKeyboardInset() {
  if (typeof window === 'undefined') return () => {};
  const root = document.documentElement;
  const vv = window.visualViewport;
  if (!vv) {
    root.style.setProperty('--vvh', '100dvh');
    root.style.setProperty('--vvw', '100vw');
    root.style.setProperty('--vvt', '0px');
    root.style.setProperty('--vvl', '0px');
    return () => {};
  }

  let raf = 0;
  const apply = () => {
    raf = 0;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--kb', kb + 'px');
    root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    root.style.setProperty('--vvw', Math.round(vv.width) + 'px');
    root.style.setProperty('--vvt', Math.max(0, Math.round(vv.offsetTop)) + 'px');
    root.style.setProperty('--vvl', Math.max(0, Math.round(vv.offsetLeft)) + 'px');
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
