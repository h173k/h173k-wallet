/**
 * h173k Wallet - Scan cursors.
 *
 * The messenger reads several independent histories: the wallet inbox (where
 * invitations, join requests and fees land) plus one address per conversation
 * and per group. Each of them keeps its own "last signature seen" marker so a
 * refresh only fetches what is new.
 */

const CURSORS_KEY = 'h173k_msg_cursors'
const LEGACY_CURSOR_KEY = 'h173k_msg_cursor' // v1: single inbox cursor

function readAll() {
  try {
    const raw = localStorage.getItem(CURSORS_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}
function writeAll(obj) {
  try { localStorage.setItem(CURSORS_KEY, JSON.stringify(obj)) } catch {}
}

export function getCursor(sourceAddress) {
  const all = readAll()
  if (all[sourceAddress]) return all[sourceAddress]
  return null
}

export function setCursor(sourceAddress, signature) {
  if (!sourceAddress || !signature) return
  const all = readAll()
  all[sourceAddress] = signature
  writeAll(all)
}

/** True when this source has never been scanned (used to suppress backfill noise). */
export function isFirstScan(sourceAddress) {
  return !getCursor(sourceAddress)
}

/**
 * One-off migration: adopt the single cursor written by the previous version
 * as the cursor of the wallet inbox, so upgrading does not replay old history.
 */
export function migrateLegacyCursor(inboxAddress) {
  if (!inboxAddress) return
  try {
    const legacy = localStorage.getItem(LEGACY_CURSOR_KEY)
    if (!legacy) return
    const all = readAll()
    if (!all[inboxAddress]) {
      all[inboxAddress] = legacy
      writeAll(all)
    }
    localStorage.removeItem(LEGACY_CURSOR_KEY)
  } catch {}
}

export function forgetCursor(sourceAddress) {
  const all = readAll()
  if (all[sourceAddress]) {
    delete all[sourceAddress]
    writeAll(all)
  }
  clearRotationStamp(sourceAddress)
}

// ========== ROTATION STAMPS ==========
/**
 * When to last check a conversation address.
 *
 * The number of addresses polled per refresh is capped (RPC providers rate
 * limit per-address history queries), so the busiest conversations take most of
 * the budget. A couple of slots are reserved for the quiet tail and handed out
 * least-recently-scanned first, which guarantees every conversation is reached
 * eventually instead of one sinking below the cut-off and staying there.
 *
 * An address with no stamp has never been rotated in and sorts first.
 */
const ROTATION_KEY = 'h173k_msg_rotation'

export function getRotationStamps() {
  try {
    const raw = localStorage.getItem(ROTATION_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

function writeRotationStamps(obj) {
  try { localStorage.setItem(ROTATION_KEY, JSON.stringify(obj)) } catch {}
}

/** Record that these addresses have just been scanned. */
export function touchRotation(addresses, at = Date.now()) {
  if (!addresses || addresses.length === 0) return
  const stamps = getRotationStamps()
  for (const addr of addresses) if (addr) stamps[addr] = at
  writeRotationStamps(stamps)
}

function clearRotationStamp(address) {
  const stamps = getRotationStamps()
  if (stamps[address] !== undefined) {
    delete stamps[address]
    writeRotationStamps(stamps)
  }
}

/** Drop stamps for conversations that no longer exist. */
export function pruneRotation(validAddresses) {
  const valid = new Set(validAddresses)
  const stamps = getRotationStamps()
  let changed = false
  for (const addr of Object.keys(stamps)) {
    if (!valid.has(addr)) { delete stamps[addr]; changed = true }
  }
  if (changed) writeRotationStamps(stamps)
}
