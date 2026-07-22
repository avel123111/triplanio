import React from 'react'
import ReactDOM from 'react-dom/client'
import posthog from 'posthog-js'
import { PostHogProvider } from '@posthog/react'
import { initSentry } from '@/lib/sentry'
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
//   events only (clean data over volume).
// - native $pageview OFF too (TRIP-213 Ф2): navigation is tracked by explicit
//   per-screen open events via track() (App.jsx screenOpenEvent), and routes that
//   already have a dedicated event send nothing — keeping $pageview would DOUBLE
//   the highest-volume event and burn the free-tier quota for a pure duplicate.
const POSTHOG_PROD_HOSTS = new Set(['triplanio.com', 'www.triplanio.com'])
const isPosthogProdHost = POSTHOG_PROD_HOSTS.has(window.location.hostname)
// True local `vite dev` is the ONLY place without the vercel.json /ingest rewrite.
const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
const posthogEnabled = isPosthogProdHost || ['1', 'true'].includes(import.meta.env.VITE_POSTHOG_ENABLE_DEV)
const posthogToken = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN
if (posthogToken) {
  posthog.init(posthogToken, {
    // Same-origin proxy path (TRIP-265). Post to `${origin}/ingest` on EVERY host
    // that serves this app — prod, www, dev.triplanio.com, Vercel previews, and any
    // future subdomain — so ingestion is always same-origin as the page: no CORS,
    // no cross-host redirect. (A hardcoded apex api_host broke the preflight because
    // apex 307-redirects to www, and "Redirect is not allowed for a preflight
    // request" killed every capture.) The /ingest rewrite lives in vercel.json, so
    // it exists on all Vercel deploys; only true local `vite dev` lacks it → there
    // we hit PostHog EU directly.
    api_host: isLocalhost
      ? (import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com')
      : `${window.location.origin}/ingest`,
    defaults: '2026-05-30',
    autocapture: false,
    capture_pageview: false, // our own page_view via track() replaces it (no dupe)
    capture_performance: false,
    disable_session_recording: true,
    person_profiles: 'identified_only',
    opt_out_capturing_by_default: !posthogEnabled,
  })
  posthog.register({ env: isPosthogProdHost ? 'prod' : 'dev' })
}

// Must run before the first render so early errors are captured.
initSentry()

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
