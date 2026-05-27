import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// Register service worker — auto-update silently in the background
registerSW({
  onNeedRefresh() {
    // Optionally show a toast that a new version is ready
    console.log('[BrainJot] New version available, updating...');
  },
  onOfflineReady() {
    console.log('[BrainJot] App is ready to work offline!');
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
