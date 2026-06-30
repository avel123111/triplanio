// Tolgee SDK wiring for the in-context spike (TRIP-129, path A).
//
// Goal of path A: keep all ~1837 call-sites on our own `t('namespace.key')` and
// route the actual resolution THROUGH Tolgee inside the i18n facade only. When
// strings are produced by Tolgee, the Tolgee Tools browser extension can wrap
// them with invisible markers and edit them in-context. The whole point of the
// spike is to verify those markers survive our usage (interpolation, plurals,
// strings used outside render) without migrating call-sites to <T>/useTranslate.
//
// Security / delivery model (matches CLAUDE.md rule 13 + the issue):
//   - apiKey is intentionally NOT baked into the bundle. With no key the SDK
//     stays in static mode (plain strings from `staticData`, zero network). The
//     browser extension injects the key locally for a single authorised user to
//     switch into dev mode — the key never ships to real users.
//   - InContextTools is imported from `@tolgee/web/tools` (unconditional) so the
//     observer survives a production `vite build`; the main-export `DevTools` is
//     a no-op in production builds and would silently disable in-context.
import { Tolgee, FormatSimple, BrowserExtensionPlugin } from '@tolgee/web';
import { InContextTools } from '@tolgee/web/tools';

const DEFAULT_API_URL = 'https://tolgee.triplanio.com';

export const tolgee = Tolgee()
  .use(FormatSimple()) // interpolates our existing {var} placeholders
  .use(BrowserExtensionPlugin()) // lets the extension hand the SDK an apiKey
  .use(InContextTools()) // observer + in-context UI, kept through prod build
  .init({
    // Empty in the bundle on purpose — the extension provides it at runtime.
    apiKey: import.meta.env.VITE_TOLGEE_API_KEY || undefined,
    apiUrl: import.meta.env.VITE_TOLGEE_API_URL || DEFAULT_API_URL,
    fallbackLanguage: 'en',
    observerType: 'invisible',
    // Our bare keys are flat (and may themselves contain dots) — never let
    // Tolgee re-nest them on a '.'.
    structureDelimiter: null,
    staticData: {},
  });

let started = false;
// Start the observer once. Safe to call repeatedly.
export function ensureTolgeeRunning() {
  if (started) return;
  started = true;
  tolgee.run();
}

// Mirror a loaded locale ({ namespace: { bareKey: value } }) into Tolgee's static
// cache. The Tolgee project is flat (useNamespaces=false), so each key is stored
// under its FULL dotted address `namespace.bareKey` — identical to the call-site
// address `t('namespace.bareKey')`, a 1:1 mapping with no namespace plumbing.
export function addLocaleToTolgee(lang, nsDict) {
  const flat = {};
  for (const [ns, records] of Object.entries(nsDict)) {
    for (const [bareKey, value] of Object.entries(records)) {
      flat[`${ns}.${bareKey}`] = value;
    }
  }
  tolgee.addStaticData({ [lang]: flat });
}
