import React from 'react'
import ReactDOM from 'react-dom/client'
import { initSentry } from '@/lib/sentry'
import App from '@/App.jsx'
import '@/index.css'
import '@/design/app.css'
import 'mapbox-gl/dist/mapbox-gl.css'

// Must run before the first render so early errors are captured.
initSentry()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
