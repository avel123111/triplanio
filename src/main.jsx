import React from 'react'
import ReactDOM from 'react-dom/client'
import { initSentry } from '@/lib/sentry'
import { initKeyboardInset } from '@/lib/keyboardInset'
import App from '@/App.jsx'
import '@/index.css'
import '@/design/app.css'
import 'mapbox-gl/dist/mapbox-gl.css'

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
  <App />
)
