import React from 'react'
import ReactDOM from 'react-dom/client'
import posthog from 'posthog-js'
import { PostHogProvider } from '@posthog/react'
import { initSentry } from '@/lib/sentry'
import { initKeyboardInset } from '@/lib/keyboardInset'
import App from '@/App.jsx'
import '@/index.css'
import '@/design/app.css'
import 'mapbox-gl/dist/mapbox-gl.css'

// PostHog product analytics (TRIP-213 Phase 0).
// - dev/preview/local stay SILENT by default so the single (free-tier) project
//   isn't polluted by test traffic; enable with VITE_POSTHOG_ENABLE_DEV=true.
//   Prod is detected by host (mirrors the CORS/canon-inspector split below).
// - `env` super-property tags every event → prod dashboards filter env=prod.
// - autocapture / web vitals / session replay OFF — we rely on explicit named
//   events only (clean data over volume). Keep $pageview (traffic/retention).
const POSTHOG_PROD_HOSTS = new Set(['triplanio.com', 'www.triplanio.com'])
const isPosthogProdHost = POSTHOG_PROD_HOSTS.has(window.location.hostname)
const posthogEnabled = isPosthogProdHost || import.meta.env.VITE_POSTHOG_ENABLE_DEV === 'true'
const posthogToken = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN
if (posthogToken) {
  posthog.init(posthogToken, {
    api_host: import.meta.env.VITE_POSTHOG_HOST,
    defaults: '2026-05-30',
    autocapture: false,
    capture_performance: false,
    disable_session_recording: true,
    person_profiles: 'identified_only',
    opt_out_capturing_by_default: !posthogEnabled,
  })
  posthog.register({ env: isPosthogProdHost ? 'prod' : 'dev' })
}

// Must run before the first render so early errors are captured.
initSentry()
// Track the on-screen keyboard (visualViewport) → CSS vars --kb / --vvh so
// bottom sheets sit above the keyboard instead of jumping (native-app feel).
initKeyboardInset()

// Typography canon inspector (TRIP-165) — a dev/staging-only browser tool.
// It must run on the DEPLOYED dev site (dev.triplanio.com), which Vercel builds
// with `vite build` (production mode) — so `import.meta.env.DEV` is FALSE there
// and can't be the gate. Instead we gate by HOST: active everywhere EXCEPT the
// production domain (mirrors the CORS allow-list split prod = triplanio.com/www).
// The dynamic import stays lazy, so on production the chunk is never fetched.
const CANON_INSPECTOR_PROD_HOSTS = new Set(['triplanio.com', 'www.triplanio.com'])
if (!CANON_INSPECTOR_PROD_HOSTS.has(window.location.hostname)) {
  import('../dev/canon-inspector/index.js')
    .then((m) => m.initCanonInspector())
    .catch(() => { /* dev tool is best-effort; never break the app */ })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <PostHogProvider client={posthog}>
    <App />
  </PostHogProvider>
)
