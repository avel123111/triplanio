#!/usr/bin/env node
/**
 * CI guard 2j — the analytics seam has ONE door per side, and it stays that way.
 *
 * Three invariants, one theme: every event and every identity goes through a
 * single module, so the rules that live there (consent, the readiness gate, the
 * uid, the first-touch source) cannot be walked around. All three failures are
 * INVISIBLE — the app looks and behaves identically, and only a Network tab or a
 * months-later audit shows the difference. That is why they need a machine and
 * not a reviewer.
 *
 *   A. `posthog-js` is imported only by `src/lib/analytics.js` and
 *      `src/lib/destinations/posthog.js` (TRIP-335, TRIP-407).
 *      The expensive one. `$identify` is the event that CREATES the person, and
 *      PostHog attaches its own `$initial_*` block to it — including an explicit
 *      `$initial_utm_source: null`. That property is set-once and a null IS a
 *      written value, so whoever identifies FIRST decides the acquisition
 *      channel of that account FOREVER. A second, bare `posthog.identify(uid)`
 *      anywhere — a new login button, a new screen — would silently cost us the
 *      channel of every account it touched, unrepairably. The same import ban
 *      keeps `capture` behind `track()` (gated on the client being ready),
 *      `reset` behind `resetIdentity()`, and `group` / `setPersonProperties`
 *      behind their own gates.
 *
 *   B. `posthog.init()` is called only from `src/lib/destinations/posthog.js`
 *      (TRIP-311, TRIP-502). The client is created in exactly one place — the
 *      PostHog destination adapter, which boots it opted out by config and hands
 *      it the visitor's answer through the SDK's own opt-in/opt-out.
 *      A second init would start a rogue client, out of step with that answer.
 *
 *   C. The PostHog ingestion key / host appear only in
 *      `supabase/functions/_shared/analytics.ts` (TRIP-213 Ф2).
 *      Server-born events (the Stripe purchase, the North Star) must carry
 *      `distinct_id = uid` — that is what lands them on the same person as the
 *      browser. An edge function POSTing on its own would be free to send any
 *      distinct_id, and revenue filed against the wrong person is worse than
 *      revenue not filed at all.
 *
 * Rules A–C are a banned import per file. D and F (TRIP-456, TRIP-493) instead
 * read WHERE a call sits — the attribution CALL SITES the unauthenticated-zone
 * port (Ф6) rewrites Login.jsx around. Guarded only by prose before; this turns
 * that prose into a machine, since a rewrite is exactly when prose stops being
 * read. (A rule E — "every provider sign-in stashes the marks in sessionStorage
 * first" — existed until TRIP-502: the address is the carrier across the OAuth
 * border now, so the stash and its rule are gone.)
 *
 *   D. The ONE `supabase.auth.signUp` call carries `signup_attribution`
 *      (TRIP-335). It is the single carrier of campaign marks across the
 *      "confirmation email → another device" border — the link is often opened
 *      on a phone, where the in-memory snapshot of the visit does not exist.
 *      Drop it and the attribution of EVERY email registration dies silently.
 *      There must be exactly ONE signUp in the browser tree: a second is a
 *      second birthplace of an account, i.e. two different attribution stories,
 *      so it fails on its own message. Zero means the carrier vanished (or the
 *      seam moved) — an empty room, not "clean" (TRIP-282).
 *
 *   F. `postLoginPath()` is called only at MODULE SCOPE (TRIP-493). Where a
 *      person lands after signing in is decided in ONE named helper per kind of
 *      door, never inline at the door itself: `postLoginHref()` (navigation we
 *      perform — carries the campaign marks in the address) and
 *      `postLoginRedirectTo()` (the address handed to Supabase, checked against
 *      its Redirect URL list). Inline `window.location.href = postLoginPath()`
 *      is how the marks were lost: the rule "this destination carries the marks"
 *      was written at three call sites and simply not written at the fourth, and
 *      nothing anywhere noticed. Brace depth is the machine form of "one place":
 *      a helper sits at depth 0, anything inside a component or a handler does
 *      not. Zero call sites means the seam moved — an empty room, not "clean".
 *
 * A self-consistency invariant over the whole tree (not a diff), the twin of
 * `check-invoke-seam.mjs` (2i). Tested by `check-analytics-seam.test.mjs`.
 *
 * Exit: 0 ok, 1 violation, 2 internal error / the seam itself moved.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// `dev/` too: canon-inspector is dynamically imported INTO the app, so code
// there runs in the browser exactly like src/ does.
const BROWSER_ROOTS = ['src', 'dev'];
const EDGE_ROOTS = ['supabase/functions'];

// Every spelling that hands back a working client. The SUBPATH is not decoration:
// `posthog-js/react` is a real installed entry point (`usePostHog()`) onto the
// very same singleton, so `from 'posthog-js/react'` is the most idiomatic way a
// React dev reaches it — and a pattern anchored on the bare name never sees it.
// `import(…)` likewise: lazy-loading is this repo's house style (invokeFn,
// canon-inspector), and it is the natural way to defer the analytics bundle.
const POSTHOG_MODULE = /(?:\bfrom|\brequire\s*\(|\bimport\s*\(?)\s*['"]posthog-js(?:\/[^'"]*)?['"]/;

// The script-tag escape hatch: the global reaches the same client without
// importing anything. `?.` and `globalThis` are in for the reason rule B gives
// for accepting `?.` — optional chaining is the house style of the calls sitting
// next to these. The bracket form is what gets written when TS has no type for
// `window.posthog`.
const POSTHOG_GLOBAL = /\b(?:window|globalThis)\s*(?:(?:\?\.|\.)\s*posthog\b|(?:\?\.)?\s*\[\s*['"]posthog['"])/;

const RULES = [
  {
    id: 'A',
    roots: BROWSER_ROOTS,
    pattern: new RegExp(`${POSTHOG_MODULE.source}|${POSTHOG_GLOBAL.source}`),
    allow: ['src/lib/analytics.js', 'src/lib/destinations/posthog.js'],
    title: 'posthog-js reached outside the analytics seam',
    fix: [
      'Events go through `track()`, identity through `identifyUser()` / `resetIdentity()`,',
      'the trip group through `groupTrip()` — all exported from @/lib/analytics.',
      'A bare posthog.identify() elsewhere permanently blanks the acquisition channel of',
      'every account it touches: $initial_* is set-once and PostHog already wrote a null',
      'into it on the event that created the person (TRIP-335).',
    ],
  },
  {
    id: 'B',
    roots: BROWSER_ROOTS,
    // Both spellings. `posthog?.init(` is the house style of the calls next to it
    // (`posthog?.capture?.`), so it is the MORE likely way a second init gets
    // written — matching only the plain dot would let the realistic case through.
    pattern: /\bposthog\s*(\?\.|\.)\s*init\s*\(/,
    allow: ['src/lib/destinations/posthog.js'],
    title: 'posthog.init() outside the destination adapter',
    fix: [
      'The client is created in one place: boot() in @/lib/destinations/posthog.js.',
      'An init anywhere else is a rogue client, out of step with the consent state the',
      'adapter holds (opted out until consent, TRIP-311/TRIP-502). Add new analytics',
      'destinations under src/lib/destinations and wire them through applyConsent().',
    ],
  },
  {
    id: 'C',
    roots: EDGE_ROOTS,
    // The write key or the ingestion host — either one is enough to post events
    // from an edge function without going through the shared emitter.
    pattern: /POSTHOG_PROJECT_KEY|POSTHOG_HOST|\bi\.posthog\.com\b/,
    allow: ['supabase/functions/_shared/analytics.ts'],
    title: 'PostHog ingestion reached outside the shared server emitter',
    fix: [
      'Emit server-side events with `captureServer(event, uid, props, groups)` from',
      '../_shared/analytics.ts. It pins `distinct_id` to the uid, which is what makes a',
      'server event (the Stripe purchase) land on the same person as the browser.',
    ],
  },
];

/**
 * Drop // line and block comments so a mention in prose cannot trip the guard —
 * this seam is described in several docblocks, including this file's own.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
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

/**
 * Structural view for the call-site rules (D/F): blank comment and string
 * BODIES, length- and newline-preserving, so a brace inside a string can't skew
 * depth and a call named in a comment can't be read as a call. Fuller than
 * stripComments (which only kills comments): handles ' " ` and // as well.
 */
function maskCode(src) {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? src.length : j + 2;
      for (; i < j; i++) if (src[i] !== '\n') out[i] = ' ';
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out[i++] = ' ';
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\' && src[i + 1]) {
          out[i] = ' ';
          out[i + 1] = src[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) out[i++] = ' ';
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Index of the `)` matching the `(` at `open`, or -1 if unbalanced. */
function matchParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')' && --d === 0) return i;
  }
  return -1;
}

/** Brace-nesting depth at each index (masked source: no braces in strings). */
function depthArray(s) {
  const d = new Array(s.length);
  let cur = 0;
  for (let i = 0; i < s.length; i++) {
    d[i] = cur;
    if (s[i] === '{') cur++;
    else if (s[i] === '}') cur = Math.max(0, cur - 1);
  }
  return d;
}

const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

try {
  // "Nothing to check" must never print the same verdict as "checked, clean"
  // (TRIP-282). A missing allowed file means the seam moved or the guard is being
  // run from the wrong directory — either way it is now watching an empty room
  // and would pass anything.
  // Deduped: consent.js is allowed by both A and B, and reporting it twice would
  // read like two different files are gone.
  const missing = [...new Set(RULES.flatMap((r) => r.allow))].filter((f) => !existsSync(f));
  if (missing.length) {
    console.error('::error::check-analytics-seam cannot run — the files it guards are not here:');
    for (const f of missing) console.error(`  ? ${f}`);
    console.error('\nRun it from the repo root. If the seam genuinely moved, update the allow');
    console.error('lists in this guard in the same commit — otherwise it guards nothing, quietly.');
    process.exit(2);
  }

  const failures = [];
  for (const rule of RULES) {
    const allow = new Set(rule.allow);
    const offenders = rule.roots
      .filter(existsSync)
      .flatMap((root) => walk(root))
      .map(rel)
      .filter((f) => !allow.has(f))
      .filter((f) => rule.pattern.test(stripComments(readFileSync(f, 'utf8'))));
    if (offenders.length) failures.push({ rule, offenders });
  }

  // ── D & E — attribution call sites ────────────────────────────────────────
  const callSiteFailures = [];
  const browserFiles = BROWSER_ROOTS.filter(existsSync).flatMap((r) => walk(r)).map(rel);

  // Rule D — the ONE birthplace of an account carries the campaign marks.
  const SIGNUP = /\.auth\s*\.\s*signUp\s*\(/g;
  const signups = [];
  for (const f of browserFiles) {
    const code = maskCode(readFileSync(f, 'utf8'));
    for (const m of code.matchAll(SIGNUP)) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(code, open);
      const args = close === -1 ? code.slice(open) : code.slice(open, close + 1);
      signups.push({ file: f, hasMarks: /signup_attribution/.test(args) });
    }
  }
  if (signups.length === 0) {
    callSiteFailures.push({
      id: 'D',
      title: 'no supabase.auth.signUp() found — the campaign-mark carrier vanished (or the seam moved)',
      lines: [
        'signUp is the single carrier of `signup_attribution` across the confirmation-email',
        'border; with none, the attribution of every email registration is unguarded. If the',
        'call was genuinely renamed/removed, update this guard in the same commit (TRIP-335).',
      ],
    });
  } else if (signups.length > 1) {
    callSiteFailures.push({
      id: 'D',
      title: `${signups.length} supabase.auth.signUp() calls — an account has ONE birthplace`,
      lines: [
        ...signups.map((s) => `  ✗ ${s.file}`),
        'Two signUp sites are two different attribution stories. Keep one, in Login.jsx,',
        'carrying `signup_attribution: getSignupMarks() || undefined` (TRIP-335).',
      ],
    });
  } else if (!signups[0].hasMarks) {
    callSiteFailures.push({
      id: 'D',
      title: 'supabase.auth.signUp() does not carry signup_attribution',
      lines: [
        `  ✗ ${signups[0].file}`,
        'Add `signup_attribution: getSignupMarks() || undefined` to the signUp `data` — it is',
        'the ONLY carrier of campaign marks across the confirmation-email border, read back in',
        'AuthContext to fill users.signup_utm_* (TRIP-335). Without it email attribution dies.',
      ],
    });
  }

  // Rule F — the post-login destination is decided in one named helper, not inline.
  const POST_LOGIN = /postLoginPath\s*\(/g;
  const POST_LOGIN_HOME = 'src/lib/postLoginPath.js'; // where it is DEFINED
  const inlineDestinations = [];
  let postLoginCalls = 0;
  for (const f of browserFiles) {
    if (f === POST_LOGIN_HOME) continue;
    const code = maskCode(readFileSync(f, 'utf8'));
    const depth = depthArray(code);
    for (const m of code.matchAll(POST_LOGIN)) {
      postLoginCalls++;
      // Depth 0 = module scope = a named helper. Anything deeper is a call site
      // deciding the destination for itself, which is the thing being banned.
      if (depth[m.index] > 0) inlineDestinations.push(`  ✗ ${f}:${lineOf(code, m.index)}`);
    }
  }
  if (postLoginCalls === 0) {
    callSiteFailures.push({
      id: 'F',
      title: 'no postLoginPath() call left — the post-login destination seam moved',
      lines: [
        'Nobody decides where a signed-in person lands, which cannot be true of a working',
        'app: the seam was renamed or moved. Update this guard in the same commit, or it',
        'watches an empty room and passes anything (TRIP-282).',
      ],
    });
  } else if (inlineDestinations.length) {
    callSiteFailures.push({
      id: 'F',
      title: 'postLoginPath() called inline — the post-login destination has more than one author',
      lines: [
        ...inlineDestinations,
        'Route it through the module-scope helper for its kind of door: postLoginHref() for',
        'navigation we perform (it carries the campaign marks in the address), or',
        'postLoginRedirectTo() for an address handed to Supabase. An inline call writes the',
        '"carries the marks" rule a second time — and the next door will be the one that',
        'forgets it, exactly as One Tap did (TRIP-493).',
      ],
    });
  }

  if (failures.length || callSiteFailures.length) {
    for (const { rule, offenders } of failures) {
      console.error(`::error::2j analytics seam (${rule.id}) — ${rule.title}:`);
      for (const f of offenders) console.error(`  ✗ ${f}`);
      for (const line of rule.fix) console.error(`  ${line}`);
      console.error('');
    }
    for (const { id, title, lines } of callSiteFailures) {
      console.error(`::error::2j analytics seam (${id}) — ${title}:`);
      for (const line of lines) console.error(`  ${line}`);
      console.error('');
    }
    process.exit(1);
  }

  console.log('check-analytics-seam: one door per side (events, identity, server) + attribution call sites — OK');
  process.exit(0);
} catch (e) {
  console.error(`::error::check-analytics-seam internal error: ${e.message}`);
  process.exit(2);
}
