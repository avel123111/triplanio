#!/usr/bin/env node
/**
 * Design-system guard.
 *
 * Scans src/ for values that bypass the design tokens and reports them in two
 * tiers:
 *   • TYPOGRAPHY  — ENFORCED. Raw font sizes (text-[Npx], font-size:Npx,
 *     inline fontSize:<number>) must come from --fs-* tokens. A violation
 *     fails the check (exit 1). Typography is fully migrated, so this protects
 *     it from regressing.
 *   • COLOR       — REPORT ONLY (for now). Raw hex + raw Tailwind palette
 *     classes. Colours are still being migrated to the Lumo system, so these
 *     are listed but do NOT fail. Flip COLOR_ENFORCED to true once the Lumo
 *     colour pass lands.
 *
 * Whitelisted files legitimately carry raw values (external brand colours,
 * Mapbox/canvas paint that needs concrete hex, SVG illustration fills, the
 * token-definition stylesheets, and work explicitly deferred).
 *
 * Run: npm run check:design
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const COLOR_ENFORCED = false; // ← flip to true after the Lumo colour migration

const ROOT = 'src';

// Files allowed to contain raw COLOUR values (hex / palette classes).
const COLOR_WHITELIST = [
  'src/lib/externalBrands.js',                         // external brand registry
  'src/components/bookings/buildBookingPlatforms.jsx', // partner brand styles
  'src/lib/avatarRamp.js',                             // avatar colour source
  'src/pages/login.css',                               // isolated; pending Lumo
  'src/index.css', 'src/design/app.css',               // token DEFINITIONS
  'src/pages/BudgetLens.jsx',                           // CAT_COLORS data-viz; pending Lumo --cat-*
  'src/design/index.jsx',                              // weather palette; pending Lumo
  'src/lib/map/mapStyle.js',                            // Mapbox paint needs concrete hex (route/marker colours)
  'src/lib/map/markers.js',                             // marker DOM uses #fff border/text
  'src/pages/ManualPlanner.jsx',                        // planner accent hex defaults
  'src/lib/booking-platforms.js',                       // external partner brand classes
  'src/components/chat/TriplanioAvatar.jsx',            // SVG illustration fills
  'src/components/AppErrorBoundary.jsx',                // crash screen — must not depend on tokens/CSS
  'src/components/views/StaySectionExpandable.jsx',     // pending colour pass (deferred w/ timeline)
];

// Files allowed to contain raw FONT SIZES.
const TYPO_WHITELIST = [
  'src/index.css', 'src/design/app.css', 'src/pages/login.css', // --fs-* token defs only
];

const PALETTE = '(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
const RE = {
  textPx:    /text-\[[0-9.]+px\]/,
  fontSizePx:/font-size:\s*[0-9.]+px/,
  inlineFs:  /fontSize:\s*[0-9.]+[,\s}]/,
  hex:       /#[0-9a-fA-F]{3,8}\b/,
  paletteCls:new RegExp(`\\b(bg|text|border|ring|from|to|via|divide|outline|fill|stroke|placeholder|shadow|accent|caret)-${PALETTE}-[0-9]{2,3}(\\/[0-9]+)?\\b`),
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(jsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

const typo = [];
const color = [];
for (const file of walk(ROOT)) {
  const isCss = file.endsWith('.css');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const loc = `${file}:${i + 1}`;
    // typography
    if (!TYPO_WHITELIST.includes(file)) {
      if (RE.textPx.test(line))     typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (isCss && RE.fontSizePx.test(line)) typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (!isCss && RE.inlineFs.test(line))  typo.push(`${loc}  ${line.trim().slice(0, 90)}`);
    }
    // colour
    if (!COLOR_WHITELIST.includes(file)) {
      const isTokenDef = /--[a-z0-9-]+\s*:/.test(line); // skip token definitions
      if (!isTokenDef && RE.hex.test(line))        color.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (!isCss && RE.paletteCls.test(line))      color.push(`${loc}  ${line.trim().slice(0, 90)}`);
    }
  });
}

const hr = '─'.repeat(60);
console.log(`\n${hr}\nDesign-token guard\n${hr}`);
console.log(`\nTYPOGRAPHY (enforced) — ${typo.length} violation(s):`);
typo.forEach((l) => console.log('  ✗ ' + l));
if (!typo.length) console.log('  ✓ none — all text sizes use --fs-* tokens');

console.log(`\nCOLOUR (${COLOR_ENFORCED ? 'enforced' : 'report-only, pending Lumo'}) — ${color.length} occurrence(s):`);
color.slice(0, 40).forEach((l) => console.log('  • ' + l));
if (color.length > 40) console.log(`  … and ${color.length - 40} more`);
if (!color.length) console.log('  ✓ none');

const failed = typo.length > 0 || (COLOR_ENFORCED && color.length > 0);
console.log(`\n${hr}\n${failed ? '✗ FAILED' : '✓ PASSED'}\n${hr}\n`);
process.exit(failed ? 1 : 0);
