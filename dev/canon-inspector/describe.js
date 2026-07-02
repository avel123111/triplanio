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
