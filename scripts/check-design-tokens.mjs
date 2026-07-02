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

const COLOR_ENFORCED = true; // Lumo colour pass landed (TRIP-53): raw colour now fails CI

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
  // — Added with the Lumo colour finale (TRIP-53): raw-by-nature sources —
  'src/lib/trip-gradients.js',                          // trip-cover gradient presets (colour data)
  'src/lib/budget/category-colors.js',                 // category token↔hex source map (token defs)
  'src/lib/map/mapTokens.js',                          // Mapbox paint fallbacks (need concrete hex)
  'src/lib/notifications-catalog.js',                  // static dev reference catalog (not rendered)
  'src/components/site/SiteChrome.jsx',                // brand logo + country-flag SVGs
  'src/pages/Login.jsx',                               // Google + Triplanio logo SVGs
  // — Isolated standalone pages with embedded styles; pending a dedicated Lumo colour pass —
  'src/pages/Landing/LandingPage.jsx',                 // marketing page: demo visuals + brand icons
  'src/pages/JoinTrip.jsx',                            // standalone join page (embedded <style>)
  'src/pages/PublicTrip.css',                          // public read-only page styles
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

// ── TRIP-165 typography-composition report (REPORT-ONLY until migration done) ──
// Measures the remaining "not yet on a .t-* canon" surface so we can track the
// unification worklist to zero. Does NOT affect exit code — flip TYPO_COMP_ENFORCED
// to true only once every component text is on a .t-* class (TRIP-165 finale).
const TYPO_COMP_ENFORCED = false;
const TOKEN_SIZES = new Set(['10', '11', '12.5', '14', '15', '16', '19', '26', '40', '54']);
// Files that legitimately DEFINE typography (token/canon/base rules) — not component text.
// AppErrorBoundary = crash screen, intentionally token/CSS-free (must render even if
// the design system fails to load) → exempt.
const TYPO_COMP_ALLOW = ['src/index.css', 'src/design/app.css', 'src/design/fonts.css', 'src/pages/login.css', 'src/components/AppErrorBoundary.jsx'];
const area = (f) => {
  const m = f.replace('src/', '').match(/^(design|pages\/[A-Za-z]+|components\/[a-z]+|lib\/[a-z]+|lib)/);
  return m ? m[1] : f.replace('src/', '');
};
const typoComp = {}; // area -> { offSize, inlineWeight, inlineLh, inlineLs, inlineFamily }
const bump = (f, k) => { const a = area(f); (typoComp[a] ||= { offSize: 0, inlineWeight: 0, inlineLh: 0, inlineLs: 0, inlineFamily: 0 })[k]++; };

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
      // Pure white / black are theme-neutral (white text on a brand surface,
      // black scrims) — they don't fragment the palette the way a raw brand/
      // accent hex does, so they're allowed. Flag a line only if it carries a
      // NON-neutral hex.
      // Per-line escape hatch for legit raw colour (data-viz palettes, map
      // backdrops) inside otherwise token-clean active files — annotate the
      // line with `design-token-exempt` instead of whitelisting the whole file.
      const exempt = line.includes('design-token-exempt');
      const hexes = line.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
      const nonNeutralHex = hexes.some((h) => !/^#(fff|ffffff|000|000000)$/i.test(h));
      if (!exempt && !isTokenDef && nonNeutralHex)            color.push(`${loc}  ${line.trim().slice(0, 90)}`);
      if (!exempt && !isCss && RE.paletteCls.test(line))      color.push(`${loc}  ${line.trim().slice(0, 90)}`);
    }
    // typography composition (report-only) — only component files, not canon/token defs
    // Skip lines with a container-computed fontSize (e.g. `fontSize: size * 0.55`) —
    // those are decorative glyphs (avatar initials), not text, scaled to their box.
    const computedGlyph = /fontSize:\s*[A-Za-z_$][\w$]*\s*[*/]/.test(line);
    // Per-line escape hatch for legit non-canon inline type (marketing/decorative).
    const typoExempt = line.includes('design-token-exempt');
    if (!TYPO_COMP_ALLOW.includes(file) && !computedGlyph && !typoExempt) {
      // off-token raw px sizes (CSS `font-size: Npx` / inline `fontSize: 'Npx'|N`)
      const cssSize = line.match(/font-size:\s*([\d.]+)px/);
      if (cssSize && !TOKEN_SIZES.has(cssSize[1])) bump(file, 'offSize');
      const jsSize = line.match(/fontSize:\s*['"]?([\d.]+)(?:px)?['"]?[,\s}]/);
      if (!isCss && jsSize && !TOKEN_SIZES.has(jsSize[1])) bump(file, 'offSize');
      // inline JSX typography props (component sets its own type instead of a .t-* class)
      if (!isCss) {
        if (/fontWeight:/.test(line))    bump(file, 'inlineWeight');
        if (/lineHeight:/.test(line))    bump(file, 'inlineLh');
        if (/letterSpacing:/.test(line)) bump(file, 'inlineLs');
        if (/fontFamily:/.test(line))    bump(file, 'inlineFamily');
      }
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

// ── TRIP-165 typography-composition report (report-only) ──
const compAreas = Object.entries(typoComp).sort((a, b) => {
  const sum = (o) => o.offSize + o.inlineWeight + o.inlineLh + o.inlineLs + o.inlineFamily;
  return sum(b[1]) - sum(a[1]);
});
const compTotal = compAreas.reduce((acc, [, o]) => {
  acc.offSize += o.offSize; acc.inlineWeight += o.inlineWeight; acc.inlineLh += o.inlineLh;
  acc.inlineLs += o.inlineLs; acc.inlineFamily += o.inlineFamily; return acc;
}, { offSize: 0, inlineWeight: 0, inlineLh: 0, inlineLs: 0, inlineFamily: 0 });
const compSum = compTotal.offSize + compTotal.inlineWeight + compTotal.inlineLh + compTotal.inlineLs + compTotal.inlineFamily;
console.log(`\nTYPOGRAPHY COMPOSITION (report-only, TRIP-165 — migrate to .t-* canons) — ${compSum} site(s) left:`);
console.log(`  off-token size: ${compTotal.offSize} · inline weight: ${compTotal.inlineWeight} · inline line-height: ${compTotal.inlineLh} · inline tracking: ${compTotal.inlineLs} · inline font-family: ${compTotal.inlineFamily}`);
for (const [a, o] of compAreas) {
  const s = o.offSize + o.inlineWeight + o.inlineLh + o.inlineLs + o.inlineFamily;
  if (s) console.log(`    ${String(s).padStart(3)}  ${a}`);
}
if (!compSum) console.log('  ✓ none — every component text is on a .t-* canon');

const failed = typo.length > 0 || (COLOR_ENFORCED && color.length > 0) || (TYPO_COMP_ENFORCED && compSum > 0);
console.log(`\n${hr}\n${failed ? '✗ FAILED' : '✓ PASSED'}\n${hr}\n`);
process.exit(failed ? 1 : 0);
