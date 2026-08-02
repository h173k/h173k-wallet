import { Buffer } from 'buffer'

// Polyfill Buffer globally BEFORE any other imports
window.Buffer = Buffer
globalThis.Buffer = Buffer

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'

// The service worker is registered by VitePWA, which injects its own script
// into index.html at build time. Registering '/sw.js' by hand here as well used
// to suggest that public/sw.js was the worker in use, when in production that
// path is the generated workbox bundle. Custom worker code lives in
// public/sw-notifications.js (see vite.config.js -> workbox.importScripts).

// Prevent zoom on iOS
document.addEventListener('gesturestart', function (e) {
  e.preventDefault()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
