#!/usr/bin/env node
// Deterministic formatter for locale JSON (TRIP-134, Tolgee CI sync).
//
// `tolgee pull` emits keys in Tolgee's internal order with no trailing newline, so
// raw pull output churns the git diff even when nothing changed. This rewrites each
// locale file with keys sorted (recursively), 2-space indent and a trailing newline
// — the repo's canonical shape — so a pull-PR diff shows ONLY real translation
// changes. It is a pure formatter: it never adds, drops or edits a value.
//
// NOT the rejected flat→namespace reshape: the Tolgee CLI splits `ns.key` into
// per-namespace files natively (project uses namespaces). This only normalises order.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Recursively sort object keys (stable, locale-independent code-unit order) so the
// serialisation is identical regardless of the order Tolgee returned them in.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

// Canonical text for one locale file: sorted keys, 2-space indent, trailing newline.
export function normalizeJsonText(text) {
  return `${JSON.stringify(sortKeys(JSON.parse(text)), null, 2)}\n`;
}

// Rewrite every *.json under <root>/<lang>/ in place. Returns the list of files
// whose on-disk bytes changed (for logging).
export function normalizeLocaleDir(root) {
  const changed = [];
  for (const lang of readdirSync(root)) {
    const langDir = join(root, lang);
    if (!statSync(langDir).isDirectory()) continue;
    for (const file of readdirSync(langDir)) {
      if (!file.endsWith('.json')) continue;
      const path = join(langDir, file);
      const before = readFileSync(path, 'utf8');
      const after = normalizeJsonText(before);
      if (after !== before) { writeFileSync(path, after); changed.push(`${lang}/${file}`); }
    }
  }
  return changed;
}

// CLI: `node scripts/ci/normalize-locale-json.mjs [localesRoot]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || 'src/lib/i18n/locales';
  const changed = normalizeLocaleDir(root);
  console.log(`normalize-locale-json: ${changed.length} file(s) reformatted under ${root}`);
  for (const f of changed) console.log(`  ${f}`);
}
