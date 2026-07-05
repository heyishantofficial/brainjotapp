import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import PWAUpdatePrompt from './components/PWAUpdatePrompt.jsx'
import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals'
import { initAnalytics, trackWebVital } from './analytics.js'

initAnalytics()

// ── Web Vitals ────────────────────────────────────────────────────
// Reports Core Web Vitals to the console and to PostHog (no-op when
// analytics is not configured).
function reportWebVital(metric) {
  const { name, value, rating, id } = metric
  console.info('[web-vital]', { name, value: +value.toFixed(1), rating, id })
  trackWebVital(metric)
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
      <PWAUpdatePrompt />
    </ErrorBoundary>
  </React.StrictMode>,
)
