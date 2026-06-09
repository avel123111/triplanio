// Native-app-style bottom sheets on mobile.
//
// On iOS Safari a `position: fixed` element is positioned against the LAYOUT
// viewport, which does not shrink when the on-screen keyboard opens — so a
// bottom sheet gets shoved up the page / floats over the keyboard. We track the
// VISUAL viewport instead and publish two CSS vars on <html>:
//   --kb  : keyboard inset in px (height the keyboard covers at the bottom)
//   --vvh : current visible viewport height in px
// Sheets/dialogs anchor to `bottom: var(--kb)` and cap their height to `--vvh`,
// so they sit right above the keyboard and never jump.
export function initKeyboardInset() {
  if (typeof window === 'undefined') return () => {};
  const root = document.documentElement;
  const vv = window.visualViewport;
  if (!vv) { root.style.setProperty('--vvh', '100dvh'); return () => {}; }

  let raf = 0;
  const apply = () => {
    raf = 0;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--kb', kb + 'px');
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
