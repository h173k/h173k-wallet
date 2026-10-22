// ============================================================================
// Always start at the very top when the app comes back to the screen.
//
// Phones keep the old scroll offset of a backgrounded PWA, and iOS can additionally
// leave the view shifted if the keyboard was open when the app was left. Depending on
// the browser either the window or <body> is the scrolling element (html/body both
// have overflow-x: hidden), so both are reset. iOS settles the layout a moment after
// returning, so the reset is repeated once shortly after.
// ============================================================================

export function scrollAppToTop(doc = document, win = window) {
  try {
    const el = doc.activeElement
    if (el && el !== doc.body && typeof el.blur === 'function') el.blur() // closes the keyboard
  } catch { /* ignore */ }
  try { win.scrollTo(0, 0) } catch { /* ignore */ }
  if (doc.documentElement) doc.documentElement.scrollTop = 0
  if (doc.body) doc.body.scrollTop = 0
  if (doc.scrollingElement) doc.scrollingElement.scrollTop = 0
}

/** Resets the scroll whenever the app returns to the screen. Returns a cleanup function. */
export function installScrollResetOnReturn(doc = document, win = window, delayMs = 300) {
  const timers = new Set()
  const reset = () => {
    scrollAppToTop(doc, win)
    const id = setTimeout(() => { timers.delete(id); scrollAppToTop(doc, win) }, delayMs)
    timers.add(id)
  }
  const onVisibility = () => { if (doc.visibilityState === 'visible') reset() }
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('pageshow', reset)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('pageshow', reset)
    timers.forEach(clearTimeout)
  }
}
