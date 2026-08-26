#!/usr/bin/env node
/**
 * CI guard 2ad (TRIP-456) — the unauthenticated zone navigates through the
 * ROUTER, so a campaign mark survives an in-app hop.
 *
 * WHY. The campaign mark of a visit is a snapshot of the entry address, taken
 * ONCE at module load (`analyticsEnv.js` → `entrySearch`) and living in the
 * document's memory. A full document reload throws that snapshot away, and with
 * it the `gclid` / `utm_*` this visitor arrived on — the exact mark the landing
 * and public-trip pages exist to produce. An in-app `<a href="/somewhere">`
 * IS a full reload. So internal navigation between app routes must go through
 * the router (`<Link>` / `nav()`), which keeps the document — and the snapshot —
 * alive. The prototype the Ф6 port copies from uses plain `<a href>` everywhere;
 * ported verbatim, every internal link would silently strip attribution
 * (TRIP-329, the same lesson `JoinTrip.jsx` carries in a comment).
 *
 * WHAT IT FLAGS. A string-literal `href` to an internal absolute path
 * (`href="/trips"`, `href="/login"`) in a site-zone file. That is the one shape
 * that reloads the document AND is an in-app route.
 *
 * WHAT IT DOES **NOT** FORBID — named here so the next agent does not "fix"
 * correct code:
 *   • external links — `https://…`, `http://…`, `mailto:…`, `tel:…` (leave the
 *     app anyway; nothing in-memory to keep);
 *   • in-page anchors — `href="#features"` (the document does not reload);
 *   • a DYNAMIC href — `href={SITE}` in PublicTrip.jsx is an ABSOLUTE address of
 *     our own origin and a DELIBERATE full reload: the mark rides the address
 *     via `withVisitCampaign`, not the in-memory snapshot. Any `href={…}`
 *     expression is out of scope (only string literals are read);
 *   • a hard `window.location.href = …` AFTER a session is set or cleared
 *     (`handleLogin`, One Tap, `finishToLogin`) — deliberate, and there is
 *     nothing left to lose once the session exists. A blanket ban on
 *     `window.location.href` would redden correct code, so it is not attempted.
 *
 * ★ TODAY the zone has exactly TWO legitimate internal `<a href>`:
 * `SiteChrome.jsx` → `/privacy` and `/terms`. Those pages are STATIC HTML served
 * by a `vercel.json` rewrite (there is no React route for them yet), so `<Link>`
 * would 404. They ship a diff-visible marker, same idiom as `prefix-exempt` in
 * 2ac — the marker's presence in the diff IS the sign-off:
 *
 *     {/* nav-exempt: /terms — статический HTML до Ф6 (vercel.json rewrite), <Link> дал бы 404 * /}
 *
 * In Ф6 both pages become app routes (TRIP-451), the markers come off, and the
 * guard begins to watch them.
 *
 * A self-consistency invariant over the site zone (not a diff), the sibling of
 * 2j. Tested by `check-site-nav.test.mjs`.
 *
 * Exit: 0 ok, 1 violation, 2 internal error / the zone moved.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The whole unauthenticated zone — every page that produces or carries a
// campaign mark, NOT only the ones already on site.css. Login.jsx and
// JoinTrip.jsx are where the attribution machinery is densest (the one signUp,
// the three provider redirects, postLoginRedirect), so they are watched NOW
// even though their CSS port waits for Ф6; the legal pages (/terms, /privacy)
// join when they stop being static HTML (Ф6). A mix of dirs and files; each
// entry MUST exist — a vanished path means the zone was quietly narrowed and
// the guard is watching an empty room, which must fail loudly, not pass
// (TRIP-282). The test pins Login.jsx/JoinTrip.jsx in the perimeter so a future
// edit that drops them from this list turns a suite RED.
const SITE_ZONE = [
  'src/components/site',
  'src/pages/Landing',
  'src/pages/PublicTrip.jsx',
  'src/pages/Login.jsx',
  'src/pages/JoinTrip.jsx',
  'src/pages/Demo',
];

// A string-literal href to an internal absolute path: `href="/x"`. The `/(?!\/)`
// excludes protocol-relative `//cdn…` (external); the `(?<!\.)` excludes the DOM
// property assignment `link.href = '/site.css'` (useSiteCss), which is not a
// JSX attribute. Anchors (`#…`) and externals never start with a single `/`.
const INTERNAL_HREF = /(?<!\.)\bhref\s*=\s*(["'])(\/(?!\/)[^"']*)\1/g;

// `nav-exempt: /path` markers, read from RAW text (they live in comments, which
// the offender scan strips).
const EXEMPT = /nav-exempt:\s*(\/\S+)/g;

/** Blank // line and block comments so a link named in prose (or a commented-out
 * tag) cannot trip the guard — length- and newline-preserving, so a match index
 * still maps to the RAW line number (a plain drop would shrink the line count). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (file) => file.split('\\').join('/');
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

try {
  const missing = SITE_ZONE.filter((p) => !existsSync(p));
  if (missing.length) {
    console.error('::error::check-site-nav cannot run — the site-zone paths it guards are not here:');
    for (const p of missing) console.error(`  ? ${p}`);
    console.error('\nRun it from the repo root. If the zone genuinely moved, update SITE_ZONE in');
    console.error('this guard in the same commit — otherwise it guards nothing, quietly.');
    process.exit(2);
  }

  const files = SITE_ZONE.flatMap((p) => (statSync(p).isDirectory() ? walk(p) : [p])).map(rel);

  const offenders = [];
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    const exempt = new Set([...raw.matchAll(EXEMPT)].map((m) => m[1]));
    const code = stripComments(raw);
    for (const m of code.matchAll(INTERNAL_HREF)) {
      const path = m[2];
      if (exempt.has(path)) continue;
      offenders.push({ file: f, line: lineOf(code, m.index), path });
    }
  }

  if (offenders.length) {
    console.error('::error::2ad site-nav — internal <a href> reloads the document and drops the campaign mark:');
    for (const o of offenders) console.error(`  ✗ ${o.file}:${o.line} — href="${o.path}"`);
    console.error('    → navigate through the router (<Link to> / nav()), which keeps the entrySearch');
    console.error('      snapshot alive (TRIP-329). A static route with no React page yet (a vercel.json');
    console.error('      rewrite) ships /* nav-exempt: <path> — причина */ next to the link, in the diff.');
    process.exit(1);
  }

  console.log(`check-site-nav: ${files.length} site-zone files — internal links go through the router — OK`);
  process.exit(0);
} catch (e) {
  console.error(`::error::check-site-nav internal error: ${e.message}`);
  process.exit(2);
}
