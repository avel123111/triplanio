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

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
