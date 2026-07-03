// TRIP-165 · Canon inspector — element descriptor for the export list.
//
// Preview-only: the tool never edits source. It emits, per queued change, a
// descriptor an engineer can use to locate the element and apply the canon in
// a normal PR (a .t-* class on the element, or moving its component selector
// between co-selector lists in app.css).

// A short, reasonably stable CSS path from <body> down to the element.
export function cssPath(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node.tagName !== 'BODY' && parts.length < 6) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
      parts.unshift(part);
      break; // an id is unique enough — stop here
    }
    const cls = (node.getAttribute('class') || '')
      .split(/\s+/)
      .filter((c) => c && !c.startsWith('ci-'))
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('');
    part += cls;
    const parent = node.parentElement;
    if (parent) {
      const sibs = [...parent.children].filter((s) => s.tagName === node.tagName);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

// A class selector for ONE node (all its non-ci classes, ANDed), or '' if none.
function classSel(node) {
  const cs = (node.getAttribute('class') || '')
    .split(/\s+/)
    .filter((c) => c && !c.startsWith('ci-'));
  return cs.length ? '.' + cs.map((c) => CSS.escape(c)).join('.') : '';
}

// The element's own selector (its classes, or tag name as fallback).
function ownSelector(el) {
  return classSel(el) || el.tagName.toLowerCase();
}

// Nearest ANCESTOR that is a repeating list-item — one with a sibling sharing a
// class (another trip card, another stat cell…). Tests each class separately so a
// per-item modifier doesn't hide the shared block class (`.s.c-trip` next to
// `.s.c-city` → the repeating class is `.s`). Returns `.<class>`, or '' if the
// element isn't inside a repeating item.
function repeatingItemSelector(el) {
  let node = el.parentElement;
  let steps = 0;
  while (node && node.tagName !== 'BODY' && steps < 8) {
    const parent = node.parentElement;
    const classes = (node.getAttribute('class') || '')
      .split(/\s+/)
      .filter((c) => c && !c.startsWith('ci-'));
    if (parent && classes.length) {
      for (const c of classes) {
        const sel = '.' + CSS.escape(c);
        if ([...parent.children].some((s) => s !== node && s.matches(sel))) return sel;
      }
    }
    node = node.parentElement;
    steps += 1;
  }
  return '';
}

// A selector grouping "elements like this one" for the "все похожие" scope.
// TRIP-183: a bare class (e.g. `.sub`, `.v`) over-matched — editing a trip-card
// subtitle also hit an unrelated `.sub` elsewhere on the page. Now the own class
// is SCOPED to the nearest repeating list-item container (the trip card, the row),
// so "all similar" means the same role within each repeating item — not every
// element with that class site-wide. Falls back to the bare own selector when the
// element isn't inside a repeating item.
export function groupSelector(el) {
  const own = ownSelector(el);
  const item = repeatingItemSelector(el);
  return item ? `${item} ${own}` : own;
}

// Full descriptor recorded for one queued change.
export function describe(el) {
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
  return {
    tag: el.tagName.toLowerCase(),
    className: el.getAttribute('class') || '',
    path: cssPath(el),
    text,
  };
}
