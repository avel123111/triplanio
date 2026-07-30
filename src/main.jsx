import React from 'react'
import ReactDOM from 'react-dom/client'
import { initSentry } from '@/lib/sentry'
import { applyConsent, clearAnalyticsStorage, getConsent, isProdHost } from '@/lib/consent'
import App from '@/App.jsx'
import '@/index.css'
import '@/design/app.css'
import 'mapbox-gl/dist/mapbox-gl.css'

// PostHog product analytics (TRIP-213 Phase 0), under consent since TRIP-311.
// Started by applyConsent() and ONLY for someone who said yes; the config and the
// reasoning live in consent.js. Until it runs, every posthog call in the codebase
// is a no-op and nothing reaches the device or the network.
//
// No usable answer covers "never asked", "expired", "our version moved" and
// "hand-edited" alike: wipe whatever PostHog left on the device and let
// ConsentBanner ask again.
const consent = getConsent()
if (consent) applyConsent(consent)
else clearAnalyticsStorage()

// Must run before the first render so early errors are captured.
initSentry()

// Typography canon inspector (TRIP-165) — a dev/staging-only browser tool.
// It must run on the DEPLOYED dev site (dev.triplanio.com), which Vercel builds
// with `vite build` (production mode) — so `import.meta.env.DEV` is FALSE there
// and can't be the gate. Instead we gate by HOST: active everywhere EXCEPT the
// production domain (mirrors the CORS allow-list split prod = triplanio.com/www).
// The dynamic import stays lazy, so on production the chunk is never fetched.
if (!isProdHost) {
  import('../dev/canon-inspector/index.js')
    .then((m) => m.initCanonInspector())
    .catch(() => { /* dev tool is best-effort; never break the app */ })
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
