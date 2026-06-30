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
//   - We DO NOT bundle InContextTools: it would wrap every string with invisible
//     in-context markers for EVERY user (verified — it wraps even when isDev is
//     false / no key). Instead we ship only BrowserExtensionPlugin; the Tolgee
//     Tools browser extension injects the observer + editing UI on demand, into
//     the authorised user's session only. Normal users get plain baked strings.
import { Tolgee, FormatSimple, BrowserExtensionPlugin } from '@tolgee/web';

const DEFAULT_API_URL = 'https://tolgee.triplanio.com';

export const tolgee = Tolgee()
  .use(FormatSimple()) // interpolates our existing {var} placeholders
  .use(BrowserExtensionPlugin()) // lets the extension hand the SDK an apiKey + UI
  .init({
    // Empty in the bundle on purpose — the extension provides it at runtime.
    apiKey: import.meta.env.VITE_TOLGEE_API_KEY || undefined,
    apiUrl: import.meta.env.VITE_TOLGEE_API_URL || DEFAULT_API_URL,
    // run() throws without a base language; the facade then drives the active
    // language via changeLanguage(). 'en' is the Tolgee base + our fallback.
    defaultLanguage: 'en',
    fallbackLanguage: 'en',
    observerType: 'invisible',
    // Our bare keys are flat (and may themselves contain dots) — never let
    // Tolgee re-nest them on a '.'.
    structureDelimiter: null,
    staticData: {},
  });

// Start the observer once. Idempotent — Tolgee's own isRunning() is the source
// of truth (survives HMR re-eval; no separate module flag to drift).
// INVARIANT: addStaticData (via addLocaleToTolgee) must happen BEFORE this —
// after run()+invalidate the static version is bumped and re-adds are ignored.
export function ensureTolgeeRunning() {
  if (!tolgee.isRunning()) tolgee.run();
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
