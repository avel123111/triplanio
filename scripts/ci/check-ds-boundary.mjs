#!/usr/bin/env node
/**
 * Guard: the two-design-system boundary (TRIP-447 Ф2, wired into CI in Ф9).
 *
 * The unauthenticated zone (landing, public shared-trip, and from Ф6 the
 * auth / join / legal pages) has its OWN design system — public/site.css and
 * the primitives in SiteChrome. It must NOT reach into the APP design system:
 * pulling `Btn` / `Card` / `Avatar` / `Field` / `src/design/app.css` into these
 * pages is exactly the leak this epic exists to close (a public page dragging
 * the whole app DS — and app.css tokens — onto a route that shouldn't load
 * them).
 *
 * WHAT IT FORBIDS. An import from `@/design` (or `src/design`, or `@/design/
 * app.css`) in any unauthenticated-zone file — with ONE explicit allowance:
 * `@/design/icons`. The icon set is a glyph library, not a visual component,
 * and the site chrome already depends on it (measured on dev).
 *
 * WHAT IT ALLOWS (by not matching them): `@/design/icons`, the map layer
 * (`@/components/views/MapView` — one Mapbox instance per session), the consent
 * banner, and everything under `src/lib/**`. None of these is an `@/design`
 * VISUAL component, so none trips the rule. Extending the allow-list needs
 * Pavel's approval + a line in the handoff (§5).
 *
 * ★ RED BY CONSTRUCTION until Ф6. Today PublicTrip.jsx still imports `Avatar`
 * from `@/design/index`; the pages are rewritten off the app DS in Ф6. So this
 * guard reports that one violation now and turns green once Ф6 lands — which is
 * why it is NOT yet in the CI workflow (checklist: "включается в CI в Ф9").
 *
 * Run: `npm run check:ds-boundary`. Exit: 0 clean, 1 violation(s), 2 internal.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The unauthenticated zone. Directories are scanned recursively for JS/JSX.
const ROOTS = [
  'src/components/site',
  'src/pages/Landing',
  'src/pages/PublicTrip.jsx',
];

// The one design-system import the site zone may keep.
const ALLOWED = new Set(['@/design/icons']);

/** A design-system import source we forbid (anything else is fine). */
function isForbiddenSource(src) {
  if (ALLOWED.has(src)) return false;
  // Any import of the app design system, however it is spelled: `@/design`,
  // `@/design/index`, `@/design/app.css`, `src/design/...`, or a relative
  // `../design[/...]`. Strip the `@/` alias, then match a `design` path segment.
  return /(^|\/)design(\/|$)/.test(src.replace(/^@\//, ''));
}

function walk(path, out) {
  let st;
  try { st = statSync(path); } catch { return; }
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) walk(join(path, name), out);
  } else if (/\.(jsx?|tsx?)$/.test(path)) {
    out.push(path);
  }
}

// Both `import … from 'x'` and the side-effect `import 'x'` (e.g. app.css) —
// the CSS side-effect form is exactly what §5 forbids, so it must be caught too.
const IMPORT_RE = /import\s+(?:[^'"]*\bfrom\s*)?['"]([^'"]+)['"]/g;

function main() {
  const files = [];
  for (const root of ROOTS) walk(root, files);

  const violations = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const source = m[1];
      if (isForbiddenSource(source)) {
        const line = src.slice(0, m.index).split('\n').length;
        violations.push({ file, line, source });
      }
    }
  }

  if (violations.length) {
    console.error('check-ds-boundary: app design system imported inside the site zone.');
    console.error('Allowed from @/design here: only @/design/icons (see §5 of the handoff).');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  imports "${v.source}"`);
    }
    process.exit(1);
  }
  console.log(`check-ds-boundary: clean (${files.length} files scanned).`);
}

try {
  main();
} catch (err) {
  console.error(`check-ds-boundary: internal error — ${err?.message || err}`);
  process.exit(2);
}
