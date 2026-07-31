/**
 * H173K Wallet - Messenger preferences.
 *
 * Everything the user can configure about the messenger lives here and is
 * surfaced in the dedicated "Messenger settings" screen (reachable from the
 * conversation list), NOT in the global wallet settings.
 *
 * Stored keys:
 *   h173k_msg_fee_policy   incoming-message fee (anti-spam)
 *   h173k_msg_list_sort    conversation list sorting / filtering
 *   h173k_msg_scan_limit   signatures fetched per refresh (wallet inbox)
 *   h173k_msg_channels_max how many conversation addresses to poll per refresh
 *   h173k_msg_notifications local notification toggle
 */

// ========== LOW-LEVEL ==========
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

const listeners = new Set()
export function subscribePrefs(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function emit() {
  listeners.forEach((cb) => { try { cb() } catch (e) { console.error(e) } })
}

// ========== SCANNING ==========
export const MESSENGER_SCAN_OPTIONS = [100, 200, 300, 500, 800, 1000]
export const DEFAULT_MESSENGER_SCAN = 100
const SCAN_LIMIT_KEY = 'h173k_msg_scan_limit'

export function getMessengerScanLimit() {
  try {
    const v = parseInt(localStorage.getItem(SCAN_LIMIT_KEY), 10)
    if (MESSENGER_SCAN_OPTIONS.includes(v)) return v
  } catch {}
  return DEFAULT_MESSENGER_SCAN
}
export function setMessengerScanLimit(n) {
  if (!MESSENGER_SCAN_OPTIONS.includes(n)) return
  try { localStorage.setItem(SCAN_LIMIT_KEY, String(n)) } catch {}
  emit()
}

// How many signatures we read from a single conversation/group address. These
// addresses only ever carry that one conversation, so a small window is plenty.
export const CHANNEL_SCAN_LIMIT = 40

// How many message sources we poll on one refresh. A "source" is one address
// with its own history: a dedicated conversation address or a group address.
// Conversations and groups share ONE budget so the cost of a refresh is
// predictable no matter how the user's chats are split between the two.
//
// The default is deliberately low: the wallet is expected to run against free
// RPC tiers, where every getSignaturesForAddress counts against a tight quota.
// Users on a paid endpoint can raise it.
export const SOURCES_PER_REFRESH_OPTIONS = [3, 5, 10, 20, 40]
export const DEFAULT_SOURCES_PER_REFRESH = 5
const SOURCES_MAX_KEY = 'h173k_msg_channels_max' // kept: preserves existing settings

export function getSourcesPerRefresh() {
  try {
    const v = parseInt(localStorage.getItem(SOURCES_MAX_KEY), 10)
    if (SOURCES_PER_REFRESH_OPTIONS.includes(v)) return v
  } catch {}
  return DEFAULT_SOURCES_PER_REFRESH
}
export function setSourcesPerRefresh(n) {
  if (!SOURCES_PER_REFRESH_OPTIONS.includes(n)) return
  try { localStorage.setItem(SOURCES_MAX_KEY, String(n)) } catch {}
  emit()
}

// ========== NOTIFICATIONS ==========
const NOTIF_KEY = 'h173k_msg_notifications'
export function getNotificationsEnabled() {
  try { return localStorage.getItem(NOTIF_KEY) === '1' } catch { return false }
}
export function setNotificationsEnabled(on) {
  try { localStorage.setItem(NOTIF_KEY, on ? '1' : '0') } catch {}
  emit()
}

const TX_NOTIF_KEY = 'h173k_tx_notifications'
export function getTxNotificationsEnabled() {
  try { return localStorage.getItem(TX_NOTIF_KEY) === '1' } catch { return false }
}
export function setTxNotificationsEnabled(on) {
  try { localStorage.setItem(TX_NOTIF_KEY, on ? '1' : '0') } catch {}
  emit()
}

// ========== ANTI-SPAM FEE ==========
/**
 * How much h173k a sender must attach for their message to count as delivered.
 * The fee is on top of the ordinary message cost and network fees, and it is
 * transferred straight to the recipient's wallet.
 *
 *  mode 'off'      - never charge (0 h173k)
 *  mode 'new'      - charge only contacts we have never talked to
 *  mode 'all'      - charge every contact
 *  mode 'selected' - charge only the contacts marked individually
 *
 * `perContact` always wins over the mode, so a single contact can be waived
 * (0) or charged more regardless of the global choice.
 */
const FEE_POLICY_KEY = 'h173k_msg_fee_policy'
export const FEE_MODES = ['off', 'new', 'all', 'selected']
export const DEFAULT_FEE_POLICY = { mode: 'off', amount: 0, perContact: {} }
export const MAX_FEE = 1000000

export function getFeePolicy() {
  const p = readJSON(FEE_POLICY_KEY, null)
  if (!p || typeof p !== 'object') return { ...DEFAULT_FEE_POLICY, perContact: {} }
  return {
    mode: FEE_MODES.includes(p.mode) ? p.mode : 'off',
    amount: sanitizeFee(p.amount),
    perContact: (p.perContact && typeof p.perContact === 'object') ? p.perContact : {},
  }
}

export function saveFeePolicy(policy) {
  const clean = {
    mode: FEE_MODES.includes(policy.mode) ? policy.mode : 'off',
    amount: sanitizeFee(policy.amount),
    perContact: {},
  }
  const per = (policy.perContact && typeof policy.perContact === 'object') ? policy.perContact : {}
  for (const [addr, value] of Object.entries(per)) {
    if (value == null) continue
    clean.perContact[addr] = sanitizeFee(value)
  }
  writeJSON(FEE_POLICY_KEY, clean)
  emit()
  return clean
}

export function sanitizeFee(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(MAX_FEE, Math.round(n * 1e9) / 1e9)
}

/** Set (or clear, with null) the individual fee for one contact. */
export function setContactFee(address, amount) {
  const policy = getFeePolicy()
  const perContact = { ...policy.perContact }
  if (amount == null) delete perContact[address]
  else perContact[address] = sanitizeFee(amount)
  return saveFeePolicy({ ...policy, perContact })
}

/**
 * The fee this wallet requires from `address` for one incoming message.
 * @param {string} address     sender's wallet address
 * @param {boolean} isKnown    true when we have already written to that contact
 */
export function getRequiredFeeFrom(address, isKnown) {
  const policy = getFeePolicy()
  const override = Object.prototype.hasOwnProperty.call(policy.perContact, address)
    ? policy.perContact[address]
    : null
  if (override != null) return override
  switch (policy.mode) {
    case 'all': return policy.amount
    case 'new': return isKnown ? 0 : policy.amount
    case 'selected': return 0 // only the individually marked contacts pay
    case 'off':
    default: return 0
  }
}

// ========== CHAT LIST SORTING / FILTERING ==========
export const SORT_MODES = ['recent', 'groupsFirst', 'directFirst', 'groupsOnly', 'directOnly']
export const DEFAULT_SORT_MODE = 'recent'
const SORT_KEY = 'h173k_msg_list_sort'

export function getSortMode() {
  try {
    const v = localStorage.getItem(SORT_KEY)
    if (SORT_MODES.includes(v)) return v
  } catch {}
  return DEFAULT_SORT_MODE
}
export function setSortMode(mode) {
  if (!SORT_MODES.includes(mode)) return
  try { localStorage.setItem(SORT_KEY, mode) } catch {}
  emit()
}

// ========== DEDICATED CONVERSATION ADDRESSES ==========
// New individual conversations open on their own address. The old behaviour
// (talking directly on the wallet address) is kept only so existing threads
// keep working; it can be re-enabled here for interoperability with wallets
// that have not been updated yet.
const LEGACY_KEY = 'h173k_msg_legacy_threads'
export function getLegacyModeEnabled() {
  try { return localStorage.getItem(LEGACY_KEY) === '1' } catch { return false }
}
export function setLegacyModeEnabled(on) {
  try { localStorage.setItem(LEGACY_KEY, on ? '1' : '0') } catch {}
  emit()
}

// ========== GROUP DEFAULTS ==========
const GROUP_DEFAULTS_KEY = 'h173k_msg_group_defaults'
export const DEFAULT_GROUP_DEFAULTS = { minBalance: 0, msgCost: 0.00001 }

export function getGroupDefaults() {
  const d = readJSON(GROUP_DEFAULTS_KEY, null)
  if (!d || typeof d !== 'object') return { ...DEFAULT_GROUP_DEFAULTS }
  return {
    minBalance: sanitizeFee(d.minBalance),
    msgCost: sanitizeFee(d.msgCost) || DEFAULT_GROUP_DEFAULTS.msgCost,
  }
}
export function saveGroupDefaults(d) {
  writeJSON(GROUP_DEFAULTS_KEY, {
    minBalance: sanitizeFee(d.minBalance),
    msgCost: sanitizeFee(d.msgCost),
  })
  emit()
}
