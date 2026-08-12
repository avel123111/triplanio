#!/usr/bin/env node
/**
 * CI guard 2q (TRIP-404) — i18n key families referenced ONLY dynamically, which
 * the static sweeps in check-i18n (2d) cannot see, so a "dead key" cleanup
 * deletes them while they are still alive. This is exactly TRIP-299: a sweep
 * dropped 606 keys, 22 of them live, and prod rendered 104 raw keys in the Inbox
 * — including the "Pro payment failed" notice.
 *
 * check-i18n's checks C and D anchor on a STATIC LITERAL — a quoted `ns.key` in
 * the backend, a `t('ns.key')` in src. The two families below have no such
 * literal, so they need their own anchor:
 *
 *  1. n8n-EMITTED EVENTS. After the TRIP-356 cutover the edge functions stop
 *     inserting `i18n_title_key: 'notif.tpl_*'` and instead `emit('<event>')` to
 *     n8n, which renders the text from the Tolgee `n8n` namespace. The KEY is
 *     never a literal in the repo — only the EVENT NAME is. For every
 *     `emit('<event>')` this guard requires the `n8n.<event>.*` family to exist
 *     and resolve in every locale. An empty family (a typo, or a wiped family)
 *     is itself the failure. No `emit(` exists in the tree yet — the check is
 *     inert until the cutover lands; its behaviour is pinned by the test fixture.
 *
 *  2. DB-DYNAMIC HISTORY KEYS. Old notification rows keep their key in
 *     `notifications.i18n_title_key` (`notif.tpl_*`); the Inbox renders history
 *     via `t(n.i18n_title_key)`, where the key comes from the DB, not from src.
 *     After the cutover most `notif.tpl_*` lose their last static literal but
 *     stay alive for history until Phase 3 relocalises it. They are pinned here
 *     by an EXPLICIT list — the reviewable control: to stop protecting a key you
 *     edit PROTECTED_KEYS, which shows in the diff. There is deliberately NO
 *     exempt marker — an escape here would re-open the exact hole (a key
 *     silently allowed to vanish), and the whole point is that a full deletion
 *     (from every locale) still fails, which a prefix-scan could not catch.
 *
 * Locales = the on-disk locale dirs (all of en/es/ru; a 4th language auto-joins,
 * and is then required too). Paths are read relative to cwd, so the test drives
 * the guard by running it from a fixture tree. Stdlib only (lives in the `guards`
 * job, which has no `npm ci`). Exit: 0 ok, 1 violation, 2 internal error.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = 'src/lib/i18n/locales';
const FUNCTIONS_DIR = 'supabase/functions';
const N8N_NS = 'n8n';

// (2) DB-dynamic history keys — no static reference by construction. The whole
// `notif.tpl_*` family: the 15 orphaned after the TRIP-356 cutover PLUS the 5
// still held by PG-trigger literals (`tpl_invite_*`, `tpl_booking_added_*`),
// listed too so the family is protected as one thing. Drop entries here only
// when Phase 3 relocalises notification history and `notif.*` can go.
export const PROTECTED_KEYS = [
  'notif.tpl_booking_added_batch_msg',
  'notif.tpl_booking_added_msg',
  'notif.tpl_booking_added_title',
  'notif.tpl_invite_declined_msg',
  'notif.tpl_invite_declined_title',
  'notif.tpl_invite_msg',
  'notif.tpl_invite_title',
  'notif.tpl_joined_msg',
  'notif.tpl_joined_title',
  'notif.tpl_member_left_msg',
  'notif.tpl_member_left_title',
  'notif.tpl_member_removed_msg',
  'notif.tpl_member_removed_title',
  'notif.tpl_pro_activated_msg',
  'notif.tpl_pro_activated_title',
  'notif.tpl_pro_payment_failed_msg',
  'notif.tpl_pro_payment_failed_title',
  'notif.tpl_role_changed_admin_msg',
  'notif.tpl_role_changed_title',
  'notif.tpl_role_changed_viewer_msg',
];

function isCommentLine(text) {
  const s = text.trim();
  return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
}

function* walk(dir, extRe) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, extRe);
    else if (extRe.test(e.name)) yield p;
  }
}

// locale -> namespace -> Set(bareKey). A file that fails to parse contributes its
// namespace with no keys (check-i18n 2d is what reports broken JSON).
function readLocales() {
  const byLocale = new Map();
  if (!existsSync(LOCALES_DIR)) return byLocale;
  for (const loc of readdirSync(LOCALES_DIR, { withFileTypes: true })) {
    if (!loc.isDirectory()) continue;
    const byNs = new Map();
    byLocale.set(loc.name, byNs);
    for (const f of readdirSync(join(LOCALES_DIR, loc.name))) {
      if (!f.endsWith('.json')) continue;
      const ns = f.slice(0, -'.json'.length);
      let keys = [];
      try {
        keys = Object.keys(JSON.parse(readFileSync(join(LOCALES_DIR, loc.name, f), 'utf8')));
      } catch { /* 2d reports invalid JSON */ }
      byNs.set(ns, new Set(keys));
    }
  }
  return byLocale;
}

// Split a full key `ns.bare` on its FIRST dot: namespaces are file stems (no
// dots), keys may contain dots (`n8n.invite_created.title` -> ns=n8n,
// bare=invite_created.title).
function splitKey(full) {
  const i = full.indexOf('.');
  return [full.slice(0, i), full.slice(i + 1)];
}

// Locales where `ns.bare` is not defined, i.e. t() would fall through to the raw
// key. Empty array = resolves everywhere.
function missingLocales(byLocale, ns, bare) {
  const out = [];
  for (const [loc, byNs] of byLocale) {
    if (!byNs.get(ns)?.has(bare)) out.push(loc);
  }
  return out;
}

// Distinct event names from `emit('<event>')` / emit("<event>") in edge functions.
function emittedEvents() {
  const events = new Set();
  const re = /\bemit\(\s*(['"])([a-z0-9_]+)\1/g;
  for (const file of walk(FUNCTIONS_DIR, /\.ts$/)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (isCommentLine(line)) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) events.add(m[2]);
    }
  }
  return events;
}

export function collectErrors() {
  const byLocale = readLocales();
  const locales = [...byLocale.keys()];
  if (!locales.length) {
    return { fatal: `no locales found under ${LOCALES_DIR}/ — nothing to protect` };
  }

  const errors = [];
  const events = emittedEvents();

  // (1) n8n emit families.
  for (const event of [...events].sort()) {
    const family = n8nFamily(byLocale, event);
    if (!family.size) {
      errors.push(`emit('${event}') has no '${N8N_NS}.${event}.*' key in any locale — add the family or fix the event name`);
      continue;
    }
    for (const bare of [...family].sort()) {
      const missing = missingLocales(byLocale, N8N_NS, bare);
      if (missing.length) {
        errors.push(`emit('${event}') needs "${N8N_NS}.${bare}" — missing in locale(s): ${missing.join(', ')}`);
      }
    }
  }

  // (2) explicit protected list.
  for (const full of PROTECTED_KEYS) {
    const [ns, bare] = splitKey(full);
    const missing = missingLocales(byLocale, ns, bare);
    if (missing.length) {
      errors.push(`protected key "${full}" missing in locale(s): ${missing.join(', ')}`);
    }
  }

  return { errors, eventCount: events.size };
}

// Bare keys of the n8n namespace belonging to event E (bare === E or E.<sub>),
// unioned across every locale so a family present in one locale but wiped in
// another is still seen.
function n8nFamily(byLocale, event) {
  const prefix = `${event}.`;
  const out = new Set();
  for (const [, byNs] of byLocale) {
    for (const bare of byNs.get(N8N_NS) ?? []) {
      if (bare === event || bare.startsWith(prefix)) out.add(bare);
    }
  }
  return out;
}

function main() {
  let result;
  try {
    result = collectErrors();
  } catch (e) {
    console.error(`::error::i18n dynamic-keys guard internal error: ${e.message}`);
    return 2;
  }
  if (result.fatal) {
    console.error(`::error::i18n dynamic-keys guard: ${result.fatal}`);
    return 2;
  }
  if (result.errors.length) {
    console.error('::error::i18n dynamic-keys guard failed (TRIP-299: keys referenced only from the DB / n8n must not be deleted):');
    for (const e of result.errors) console.error(`  ✗ ${e}`);
    return 1;
  }
  console.log(`check-i18n-dynamic-keys: ${result.eventCount} emit() event(s), ${PROTECTED_KEYS.length} protected key(s) — all resolve in every locale — OK`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
