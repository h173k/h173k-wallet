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
//
// Operations that must finish (lottery spin, send with SOL top-up, staking) are wrapped
// in duringCriticalOperation(): the lock then waits for them (max MAX_DEFER_MS).
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

// ── Operations that must not be cut in half ─────────────────────────────────
// A lottery spin (commit → reveal), a send that first buys SOL, a staking action…
// Locking in the middle would stop the second transaction (a spin's reveal, and with it
// a possible win, would be lost). While such an operation runs, leaving the app only
// SCHEDULES the lock; it happens the moment the operation finishes — or after
// MAX_DEFER_MS at the latest, so a hung operation can never keep the wallet open.
export const MAX_DEFER_MS = 90_000

let criticalDepth = 0
let pending = null          // { since } — a lock requested while an operation was running
let lockTarget = null       // the wallet installBackgroundLock() is guarding
let deferTimer = null

function doLock() {
  pending = null
  if (deferTimer) { clearTimeout(deferTimer); deferTimer = null }
  if (lockTarget && lockTarget.isUnlocked()) lockTarget.lock('background')
}

/** Runs fn as an operation the background lock waits for (see above). */
export async function duringCriticalOperation(fn) {
  criticalDepth++
  try {
    return await fn()
  } finally {
    criticalDepth = Math.max(0, criticalDepth - 1)
    if (criticalDepth === 0 && pending) doLock()
  }
}

export function isCriticalOperationRunning() {
  return criticalDepth > 0
}

/** True while a lock is scheduled to happen when the running operation ends. */
export function isLockPending() {
  return !!pending
}

/**
 * Installs the listeners; returns a cleanup function.
 * `wallet` needs isUnlocked() and lock(reason); optional `lockDeadline` (ms timestamp of
 * the auto-lock). doc/win/now are injectable for tests. `isEnabled()` is read at the
 * moment the app is left (Settings → "Lock when leaving the app"), so toggling it works
 * immediately.
 */
export function installBackgroundLock(wallet, doc = document, win = window, now = () => Date.now(), isEnabled = () => true) {
  lockTarget = wallet
  const requestLock = () => {
    if (!isEnabled()) return
    if (!wallet.isUnlocked() || isSystemDialogActive()) return
    if (criticalDepth === 0) { doLock(); return }
    if (!pending) {
      pending = { since: now() }
      // best effort: phones pause timers in the background, so the elapsed time is
      // also checked when the app comes back (onVisibility below)
      deferTimer = setTimeout(doLock, MAX_DEFER_MS)
    }
  }
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') { requestLock(); return }
    if (pending && now() - pending.since >= MAX_DEFER_MS) { doLock(); return }
    // Back in the app: if the auto-lock time has passed while the phone kept the app
    // asleep (timers paused), lock now instead of waiting for the late timer.
    if (wallet.isUnlocked() && wallet.lockDeadline && now() >= wallet.lockDeadline) {
      if (criticalDepth === 0) wallet.lock('auto')
    }
  }
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('pagehide', requestLock)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('pagehide', requestLock)
    if (deferTimer) { clearTimeout(deferTimer); deferTimer = null }
    pending = null
    if (lockTarget === wallet) lockTarget = null
  }
}
