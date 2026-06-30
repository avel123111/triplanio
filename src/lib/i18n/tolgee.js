// Tolgee SDK wiring (TRIP-129, path A — CONDITIONAL routing).
//
// Delivery = baked (static): translations are compiled into the bundle as JSON;
// users fetch nothing at runtime. For NORMAL users our own baked dictionary
// resolves t() directly (see I18nContext) and Tolgee never touches that hot path.
// Tolgee only runs so the Tolgee Tools browser extension can DETECT the page and
// offer in-context editing. Only when YOU activate the extension — it writes its
// apiKey/apiUrl into sessionStorage and reloads — does t() route through Tolgee so
// strings get marker-wrapped and become editable. That editing session is local
// to your browser; other users get plain baked strings with zero Tolgee overhead.
//
// Why route through Tolgee at all for editing: the extension can only hook strings
// the Tolgee observer wrapped. So the editing path (and ONLY it) goes through
// tolgee.t(); everyone else reads the baked dictionary directly.
//
// Security (CLAUDE.md rule 13): no apiKey is ever baked. The key comes solely from
// the extension's sessionStorage at runtime. Without it the SDK stays in
// production/static mode — no network, no observer, no editor. InContextTools (the
// heavy editor UI) is NOT bundled; the extension loads it on demand into the
// authorised session only.
import { Tolgee, FormatSimple, BrowserExtensionPlugin } from '@tolgee/web';

const DEFAULT_API_URL = 'https://tolgee.triplanio.com';

// The Tolgee Tools extension writes these into sessionStorage and reloads the page;
// their presence at load = "authorised in-context editing session". Changing them
// requires a reload, so reading once at module load is sufficient — and keeps this
// check out of the per-call t() hot path.
function readInContextSession() {
  try {
    return Boolean(
      sessionStorage.getItem('__tolgee_apiKey') &&
      sessionStorage.getItem('__tolgee_apiUrl'),
    );
  } catch (e) {
    return false;
  }
}

// True only in the local, extension-authorised editing session. Drives the routing
// switch in I18nContext: in-context → tolgee.t(); everyone else → baked dictionary.
export const IN_CONTEXT = readInContextSession();

export const tolgee = Tolgee()
  .use(FormatSimple()) // interpolates our existing {var} placeholders
  .use(BrowserExtensionPlugin()) // lets the extension detect the page + inject creds
  .init({
    // NEVER baked — the extension supplies credentials via sessionStorage at runtime.
    apiKey: undefined,
    apiUrl: import.meta.env.VITE_TOLGEE_API_URL || DEFAULT_API_URL,
    // run() throws without a base language; 'en' is the Tolgee base + our fallback.
    defaultLanguage: 'en',
    fallbackLanguage: 'en',
    observerType: 'invisible',
    // Our bare keys are flat (and may themselves contain dots) — never let Tolgee
    // re-nest them on a '.'.
    structureDelimiter: null,
    staticData: {},
  });

// Start Tolgee once (idempotent via its own isRunning()). Always called — even for
// normal users — so the browser extension can detect the page and offer editing.
// In a normal session Tolgee carries no data and t() never queries it.
export function ensureTolgeeRunning() {
  if (!tolgee.isRunning()) tolgee.run();
}

// Mirror a loaded locale ({ namespace: { bareKey: value } }) into Tolgee's static
// cache under the FULL dotted address `namespace.bareKey` — identical to the
// call-site address t('namespace.bareKey'). Only used in an in-context session
// (normal users resolve from our dictionary, never from Tolgee).
// INVARIANT: must run BEFORE ensureTolgeeRunning() — after run()+invalidate the
// static version is bumped and re-adds are ignored.
export function addLocaleToTolgee(lang, nsDict) {
  const flat = {};
  for (const [ns, records] of Object.entries(nsDict)) {
    for (const [bareKey, value] of Object.entries(records)) {
      flat[`${ns}.${bareKey}`] = value;
    }
  }
  tolgee.addStaticData({ [lang]: flat });
}
