// ============================================================================
// Lock the wallet as soon as the app leaves the screen.
//
// Leaving = switching to another app, going to the home screen, turning the screen
// off, opening a link in the browser… (document becomes "hidden", or the page is
// being unloaded). On return the lock screen asks for the PIN / biometrics again.
//
// Exception: the operating system's own dialogs that the app opens itself — the
// fingerprint / Face ID sheet (WebAuthn). On some phones (Android) that sheet hides
// the page for a moment; locking then would break enabling biometrics in Settings.
// Such calls are wrapped in duringSystemDialog().
// ============================================================================

let dialogDepth = 0

/** Runs fn (a system dialog, e.g. WebAuthn) without triggering the background lock. */
export async function duringSystemDialog(fn) {
  dialogDepth++
  try {
    return await fn()
  } finally {
    // The "visible again" event can arrive just after the promise settles.
    setTimeout(() => { dialogDepth = Math.max(0, dialogDepth - 1) }, 1500)
  }
}

export function isSystemDialogActive() {
  return dialogDepth > 0
}

/**
 * Installs the listeners; returns a cleanup function.
 * `wallet` needs isUnlocked() and lock(reason). doc/win are injectable for tests.
 */
export function installBackgroundLock(wallet, doc = document, win = window) {
  const lockNow = () => {
    if (!wallet.isUnlocked() || isSystemDialogActive()) return
    wallet.lock('background')
  }
  const onVisibility = () => { if (doc.visibilityState === 'hidden') lockNow() }
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('pagehide', lockNow)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('pagehide', lockNow)
  }
}
