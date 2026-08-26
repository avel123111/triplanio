import { useEffect } from 'react';

/**
 * Scroll-reveal for the unauthenticated zone — fades `.rv` / `.rv-l` / `.rv-r`
 * blocks up as they enter the viewport by adding `in` (the CSS lives in
 * site.css, the prototype's own). ONE IntersectionObserver, ONE-directional:
 * a block reveals once and is then un-observed, so it never re-hides. The old
 * bidirectional re-arm (remove `in` when a block scrolled back) made long pages
 * feel janky — sections re-animated their translateY as you scrolled up/down
 * (the demo trip surfaced it: ~12 re-flips per scroll sweep). Shared by the
 * landing, public trip and demo so the reveal behaviour has a single copy.
 * `ready` gates it until the zone CSS + the target nodes exist; re-runs when
 * `ready` flips (e.g. the public page's CTA mounts only after the trip loads).
 */
export function useReveal(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const targets = [...document.querySelectorAll('.rv,.rv-l,.rv-r')];
    if (!targets.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target); // reveal once — never re-hide (no scroll jank)
        }
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -5% 0px' });
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ready]);
}
