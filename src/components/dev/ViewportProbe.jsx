import { useEffect, useState } from 'react';

/**
 * TRIP-234 · ViewportProbe — dev-only keyboard/viewport diagnostic overlay.
 *
 * The mobile bottom-sheet keyboard work kept failing because we were editing
 * blind: iOS Safari has no CSS-native keyboard inset, so the ONLY source of
 * truth is `window.visualViewport`, and screenshots don't tell us the numbers.
 * This overlay prints those numbers live on the device so a fix is verified
 * with data, not guesswork.
 *
 * OFF by default (zero cost in prod). Turn it on ON THE PHONE with `?vp=1`
 * (persists), off with `?vp=0`. Pointer-events:none so it never eats taps.
 *
 * Money metric = `kb` (keyboard inset in px) and `input` HIDDEN/ok: when a
 * field is focused, is its bottom edge below the keyboard line, and does the
 * sheet transform up to compensate?
 */
function probeEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('vp');
    if (q === '1') { localStorage.setItem('vpProbe', '1'); }
    if (q === '0') { localStorage.removeItem('vpProbe'); }
    return localStorage.getItem('vpProbe') === '1';
  } catch { return false; }
}

// Last visible sheet surface (vaul drawer / dialog / editor panel / map peek).
function activeSheetEl() {
  const els = document.querySelectorAll('[data-vaul-drawer],.dlg-modal,.sheet,.lp-sheet,.map-route');
  for (let i = els.length - 1; i >= 0; i--) {
    const r = els[i].getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return els[i];
  }
  return null;
}

function read() {
  const vv = window.visualViewport;
  const inner = Math.round(window.innerHeight);
  const vvH = vv ? Math.round(vv.height) : inner;
  const vvTop = vv ? Math.round(vv.offsetTop) : 0;
  const kb = Math.max(0, inner - vvH - vvTop);

  const ae = document.activeElement;
  const isField = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
  let input = 'none';
  if (isField) {
    const b = Math.round(ae.getBoundingClientRect().bottom);
    const kbLine = vvTop + vvH;
    input = `${ae.tagName.toLowerCase()} b=${b} ${b > kbLine + 1 ? 'HIDDEN' : 'ok'}`;
  }

  const sheet = activeSheetEl();
  let sheetInfo = 'none';
  if (sheet) {
    const r = sheet.getBoundingClientRect();
    const cls = (sheet.className || '').toString().split(/\s+/)[0] || sheet.tagName.toLowerCase();
    const tf = getComputedStyle(sheet).transform;
    const ty = tf && tf !== 'none' ? Math.round(Number(tf.split(',')[5]) || 0) : 0;
    sheetInfo = `${cls} t=${Math.round(r.top)} b=${Math.round(r.bottom)} ty=${ty}`;
  }

  return { inner, vvH, vvTop, kb, input, sheet: sheetInfo };
}

export default function ViewportProbe() {
  const [on] = useState(probeEnabled);
  // Off by default → don't walk the DOM / read geometry at all in prod.
  const [s, setS] = useState(() => (on ? read() : null));

  useEffect(() => {
    if (!on) return undefined;
    const tick = () => setS(read());
    const vv = window.visualViewport;
    vv?.addEventListener('resize', tick);
    vv?.addEventListener('scroll', tick);
    window.addEventListener('resize', tick);
    document.addEventListener('focusin', tick);
    document.addEventListener('focusout', tick);
    // iOS mutates geometry mid-focus without firing events reliably — poll.
    const id = setInterval(tick, 250);
    return () => {
      vv?.removeEventListener('resize', tick);
      vv?.removeEventListener('scroll', tick);
      window.removeEventListener('resize', tick);
      document.removeEventListener('focusin', tick);
      document.removeEventListener('focusout', tick);
      clearInterval(id);
    };
  }, [on]);

  if (!on) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, zIndex: 2147483647, pointerEvents: 'none',
      font: '11px/1.35 ui-monospace,Menlo,monospace', whiteSpace: 'pre',
      color: '#0f0', background: 'rgba(0,0,0,.82)', padding: '6px 8px',
      borderBottomRightRadius: 8, maxWidth: '100vw', letterSpacing: '.2px',
    }}>
      {`inner ${s.inner}  vvH ${s.vvH}  vvTop ${s.vvTop}
kb ${s.kb}px
input ${s.input}
sheet ${s.sheet}`}
    </div>
  );
}
