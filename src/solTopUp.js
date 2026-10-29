// ============================================================================
// Remembered failed SOL top-ups.
//
// If an h173k→SOL top-up swap fails (e.g. the RPC is down / rejecting requests), the
// wallet remembers it — persistently, per wallet address. Before the NEXT operation
// that pays a fee, withAutoSOL retries the top-up FIRST. If it fails again and the
// operation would push SOL below the minimum needed to run a swap at all, the
// operation is stopped before anything is sent. This prevents the wallet from slowly
// paying itself below the swap floor and getting stuck (needing an external SOL deposit).
// ============================================================================

import { translate } from './i18n'

const KEY = 'h173k_sol_topup_pending'

export function markTopUpPending(address, reason) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      addr: String(address || ''), at: Date.now(), reason: String(reason || '').slice(0, 160),
    }))
  } catch { /* ignore */ }
}

export function clearTopUpPending() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

export function isTopUpPending(address) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return !!v && v.addr === String(address || '')
  } catch { return false }
}

/** Error thrown when an operation is stopped because the SOL top-up could not be done. */
export function topUpFailedError(cause) {
  const e = new Error(translate('autoSol.topUpFailed'))
  e.code = 'SOL_TOPUP_FAILED'
  e.cause = cause
  return e
}

export const isTopUpFailedError = (e) => e?.code === 'SOL_TOPUP_FAILED'
