import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals'

registerSW()

// ── Web Vitals ────────────────────────────────────────────────────
// Reports Core Web Vitals to the console in a structured format.
// Hook point: replace console.info with Sentry.setMeasurement or a
// custom analytics beacon once an external service is configured.
function reportWebVital({ name, value, rating, id }) {
  console.info('[web-vital]', { name, value: +value.toFixed(1), rating, id })
  // Hook point: Sentry.setMeasurement(name, value, name === 'CLS' ? '' : 'millisecond')
}
onCLS(reportWebVital)
onINP(reportWebVital)
onLCP(reportWebVital)
onFCP(reportWebVital)
onTTFB(reportWebVital)

// ── Global unhandled rejection capture ───────────────────────────
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason)
  // Hook point: Sentry.captureException(e.reason)
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
