import { useEffect } from 'react';

/**
 * Scroll-reveal for the unauthenticated zone — fades `.rv` / `.rv-l` / `.rv-r`
 * blocks up as they enter the viewport by toggling `in` (the CSS lives in
 * site.css, the prototype's own). ONE IntersectionObserver, bidirectional
 * (re-arms a block that scrolls back down). Shared by the landing and the
 * public trip so the reveal behaviour has a single copy (was duplicated
 * verbatim in both). `ready` gates it until the zone CSS + the target nodes
 * exist; re-runs when `ready` flips (e.g. the public page's CTA mounts only
 * after the trip loads).
 */
export function useReveal(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const targets = [...document.querySelectorAll('.rv,.rv-l,.rv-r')];
    if (!targets.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) en.target.classList.add('in');
        else if (en.boundingClientRect.top > 0) en.target.classList.remove('in');
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -5% 0px' });
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ready]);
}
