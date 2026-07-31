const CACHE_NAME = 'h173k-wallet-v1'

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
]

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  )
})

// Activate event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

// Fetch event - Network first, fallback to cache
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return
  
  // Skip API calls (RPC, Jupiter, etc.)
  const url = new URL(event.request.url)
  if (url.pathname.includes('/api/') || 
      url.hostname.includes('helius') ||
      url.hostname.includes('jup.ag') ||
      url.hostname.includes('geckoterminal')) {
    return
  }
  
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Clone response for cache
        const responseToCache = response.clone()
        
        caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, responseToCache))
        
        return response
      })
      .catch(() => caches.match(event.request))
  )
})

// Push notification handler (for future use)
self.addEventListener('push', event => {
  const data = event.data?.json() || {}
  
  const options = {
    body: data.body || 'New transaction',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: data.url || '/',
    actions: [
      { action: 'open', title: 'View' },
      { action: 'close', title: 'Dismiss' }
    ]
  }
  
  event.waitUntil(
    self.registration.showNotification('H173K Wallet', options)
  )
})

// Notification click handler
self.addEventListener('notificationclick', event => {
  event.notification.close()
  if (event.action && event.action !== 'open') return

  // `data` is an object ({ url, from, group }); passing it straight to
  // openWindow used to stringify it into a nonsense URL.
  const data = event.notification.data || {}
  const url = (typeof data === 'string' ? data : data.url) || '/'

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus()
        // The app is already running: tell it which chat to open instead of
        // navigating, which would throw away its state.
        if (data.from || data.group) {
          client.postMessage({ type: 'h173k-open-chat', from: data.from, group: data.group })
        }
        return
      }
    }
    await clients.openWindow(url)
  })())
})
