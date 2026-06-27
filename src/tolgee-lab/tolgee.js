// Tolgee instance for the in-context LAB (TRIP-127). Throwaway / dev-only.
//
// This is intentionally ISOLATED from the app's real i18n (src/lib/i18n/*).
// Nothing here touches the global I18nContext / t() — deleting src/tolgee-lab/
// and the one /tolgee-lab route in App.jsx removes it without a trace.
//
// In-context editing: the "Tolgee Tools" Chrome/Firefox extension injects the
// apiUrl + API key at runtime and flips the SDK into development mode, so we do
// NOT need to bundle a key. For convenience you may also set VITE_TOLGEE_API_URL
// / VITE_TOLGEE_API_KEY in a local .env.local to run it without the extension.
import { Tolgee, DevTools } from '@tolgee/react';
import { FormatIcu } from '@tolgee/format-icu';
import { InContextTools } from '@tolgee/web/tools';
import { staticData } from './staticData';

export const tolgee = Tolgee()
  .use(DevTools())
  .use(FormatIcu())
  .use(InContextTools())
  .init({
    // Renders offline from the bundled snapshot; the extension/live data
    // overrides this once connected.
    staticData,
    availableLanguages: ['en', 'es', 'ru'],
    defaultLanguage: 'en',
    fallbackLanguage: 'en',
    // Picked up by the SDK if present; otherwise the Chrome extension supplies them.
    apiUrl: import.meta.env.VITE_TOLGEE_API_URL,
    apiKey: import.meta.env.VITE_TOLGEE_API_KEY,
  });
