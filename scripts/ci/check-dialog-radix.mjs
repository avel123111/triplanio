#!/usr/bin/env node
/**
 * CI guard 2f (TRIP-202) — raw Radix dialog primitives stay inside the shells.
 *
 * Policy: the a11y contract of a modal (accessible name via `Dialog.Title`,
 * description via `Dialog.Description` / explicit `aria-describedby` opt-out, and
 * focus-on-open via `keepFocusInDialog`) is owned by a SMALL, KNOWN set of shell
 * surfaces. Every other screen/component must compose one of those shells (or the
 * design-system `<Dialog>` wrapper in `src/design/index.jsx`, which itself routes
 * through `ui/dialog`), never `@radix-ui/react-dialog` / `@radix-ui/react-alert-dialog`
 * directly. That makes "a dialog without a Title/Description/focus contract"
 * structurally unrepresentable: a new raw import anywhere else fails the PR.
 *
 * This is a self-consistency invariant over the whole `src/` tree (not a diff),
 * matching guard 2e. To legitimately add a new shell, add its path to ALLOW below
 * in the same PR — which forces the contract review to happen on purpose.
 *
 * Second policy (TRIP-321 · унификация шторок): THE MOBILE SHEET IS WRITTEN
 * ONCE. `vaul` (the drawer engine behind every bottom sheet) may be imported
 * ONLY by the seam `src/components/ui/sheetShell.jsx`. Четыре файла держали
 * свою копию `Drawer.Root → Portal → Overlay → Content` — а вместе с ней свою
 * копию `repositionInputs={false}`, своей подложки и своего грипа; пятую копию
 * теперь нельзя завести не заметив: прямой импорт vaul где угодно ещё роняет
 * PR. Исключение по построению — `ui/PeekSheet.jsx`: он НЕ на vaul (немодальный
 * шит с детентами, разбор в его шапке), поэтому в это правило не упирается.
 *
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const RADIX_IMPORT = /from\s+['"]@radix-ui\/react-(alert-)?dialog['"]/;
const VAUL_IMPORT = /from\s+['"]vaul['"]/;

// Second invariant (TRIP-202): a composed <DialogContent> (the design-system content
// from ui/dialog, re-exported via @/design) must be NAMED — a <DialogTitle> has to
// appear in the same file (visible-`asChild` or sr-only). This closes the gap that
// let hand-rolled dialogs (EventModal, EventEditDialog, ProUpsellModal, …) render a
// nameless DialogContent while still passing the raw-import check above: they import
// DialogContent from @/design, not from radix, so the whitelist never saw them. With
// this, "a DialogContent without an accessible name" is structurally unrepresentable.
const CONTENT_USE = /<DialogContent[\s>/]/;
const TITLE_PRESENT = /<DialogTitle[\s>]/;

// The ONLY files allowed to import the raw Radix dialog primitives. Each owns the
// a11y contract for its surface (Title + Description opt-out + keepFocusInDialog).
const ALLOW = new Set([
  'src/components/ui/dialog.jsx',        // centred dialog → bottom-sheet (main shell)
  'src/components/ui/alert-dialog.jsx',  // AlertDialog primitive (confirm)
  'src/components/stats/VisitPanel.jsx', // stats visit side-panel (desktop slide-over)
]);

// Единственный дом vaul. Список из одного имени — это и есть правило: движение
// шторки (жест, слайд, подложка, клавиатура, грип) живёт в одном месте, а
// поверхности приносят только свой скин.
const VAUL_ALLOW = new Set([
  'src/components/ui/sheetShell.jsx',    // sheet seam: Root + Surface + Grip
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

try {
  const offenders = [];
  const nameless = [];
  const vaulOffenders = [];
  for (const file of walk(ROOT)) {
    const rel = file.split('\\').join('/');
    const src = readFileSync(file, 'utf8');
    if (!ALLOW.has(rel) && RADIX_IMPORT.test(src)) offenders.push(rel);
    if (!VAUL_ALLOW.has(rel) && VAUL_IMPORT.test(src)) vaulOffenders.push(rel);
    // Any file that renders <DialogContent> must also carry a <DialogTitle>.
    if (CONTENT_USE.test(src) && !TITLE_PRESENT.test(src)) nameless.push(rel);
  }

  if (offenders.length) {
    console.error('✗ 2f dialog-radix guard: raw @radix-ui/react-dialog import outside the shell whitelist:');
    for (const f of offenders) console.error(`    ${f}`);
    console.error('\nCompose an existing dialog shell (ui/dialog, ui/Sheet, EventDrawerHost) or the');
    console.error('design-system <Dialog> from @/design instead. If this really is a new shell,');
    console.error('add its path to ALLOW in scripts/ci/check-dialog-radix.mjs in the same PR so the');
    console.error('Title/Description/focus contract is reviewed on purpose.');
    process.exit(1);
  }

  if (vaulOffenders.length) {
    console.error('✗ 2f dialog-radix guard: raw `vaul` import outside the sheet seam:');
    for (const f of vaulOffenders) console.error(`    ${f}`);
    console.error('\nМобильная шторка пишется ОДИН раз. Композируй шов src/components/ui/sheetShell.jsx');
    console.error('(<SheetRoot> + <SheetSurface> + <SheetGrip>) и приноси только свой класс поверхности —');
    console.error('так делают ui/Sheet (.sheet), ui/LpSheet (.lp-sheet), ui/dialog (.dlg-modal) и');
    console.error('stats/VisitPanel. Другой АРХЕТИП поверхности (немодальный шит с детентами) — это');
    console.error('ui/PeekSheet, и он не на vaul. Новый дом движка добавляется в VAUL_ALLOW тем же PR.');
    process.exit(1);
  }

  if (nameless.length) {
    console.error('✗ 2f dialog-radix guard: <DialogContent> without a <DialogTitle> (no accessible name):');
    for (const f of nameless) console.error(`    ${f}`);
    console.error('\nEvery DialogContent needs a Radix Title. Either use the design-system <Dialog title=…>');
    console.error('wrapper (which supplies it), or add a <DialogTitle> — wrap the visible heading with');
    console.error('<DialogTitle asChild> (best), or an sr-only <DialogTitle> when there is no heading.');
    console.error('Also pass aria-describedby={undefined} on the content when there is no Description.');
    process.exit(1);
  }

  console.log(`✓ 2f dialog-radix guard: raw Radix import confined to ${ALLOW.size} shells, vaul to ${VAUL_ALLOW.size} seam; every DialogContent is named`);
  process.exit(0);
} catch (e) {
  console.error('2f dialog-radix guard: internal error', e);
  process.exit(2);
}
