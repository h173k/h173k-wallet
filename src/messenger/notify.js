/**
 * h173k Wallet - Local (OS) notifications for the messenger.
 * Kept in its own module so both the direct-message and the group code can use
 * it without importing each other.
 */

const NOTIF_ICON = '/icons/icon-192x192.png'

/**
 * Display a local OS notification through the service worker (works on desktop
 * and in the installed PWA), falling back to the Notification constructor.
 * The caller is responsible for checking the relevant enabled-toggle; this only
 * checks that the platform permits notifications at all.
 */
export function showAppNotification(title, body, { tag, data = {} } = {}) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const options = {
    body,
    icon: NOTIF_ICON,
    badge: NOTIF_ICON,
    data: { url: '/', ...data },
    renotify: true,
  }
  if (tag) options.tag = tag
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, options))
        .catch(() => fallbackNotification(title, options))
      return
    }
  } catch {}
  fallbackNotification(title, options)
}

function fallbackNotification(title, options) {
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      try { window.focus() } catch {}
      const from = options.data && options.data.from
      const group = options.data && options.data.group
      try {
        if (group) window.dispatchEvent(new CustomEvent('h173k-open-group', { detail: group }))
        else if (from) window.dispatchEvent(new CustomEvent('h173k-open-thread', { detail: from }))
      } catch {}
      n.close()
    }
  } catch { /* platform doesn't allow the Notification constructor */ }
}
