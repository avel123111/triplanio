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

// Dev-only typography canon inspector (TRIP-165). The `import.meta.env.DEV`
// guard is replaced by `false` in `vite build`, so this dynamic import (and the
// whole dev/ module it pulls) is dead-code-eliminated from production bundles —
// it never ships to users.
if (import.meta.env.DEV) {
  import('../dev/canon-inspector/index.js')
    .then((m) => m.initCanonInspector())
    .catch(() => { /* dev tool is best-effort; never break the app */ })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
