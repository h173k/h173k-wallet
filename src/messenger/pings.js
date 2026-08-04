/**
 * h173k Wallet - Notification pings.
 *
 * WHY
 * A closed PWA cannot check for messages: iOS has no Background Sync, and Web
 * Push would need a server that knows who talks to whom — which is exactly what
 * dedicated conversation addresses are designed to hide. So the messenger
 * cannot wake itself up.
 *
 * What it can do is make the message visible to something that already has
 * push: an ordinary wallet app. A message moves tokens to the conversation
 * address, never to the recipient's wallet, so nothing reaches them there. A
 * ping fixes that — one lamport of h173k to the recipient's wallet address, in
 * the same transaction as the message. Any wallet holding the same seed reports
 * an incoming transfer, and the person knows to open the messenger.
 *
 * The ping carries no content and no metadata beyond a tiny transfer.
 *
 * SIZE
 * Every extra transfer costs about 47 bytes of a 1232-byte transaction, so a
 * long message leaves room for roughly six pings. Groups can be larger, hence
 * the budget and the rotation below.
 */

import { PublicKey } from '@solana/web3.js'

/** Solana's packet limit. A transaction above this is rejected outright. */
export const PACKET_LIMIT = 1232

/**
 * Bytes one extra token transfer adds: the instruction plus its account
 * references. Measured, then rounded up so an estimate is never optimistic.
 */
export const BYTES_PER_PING = 50

/**
 * Bytes deliberately left unspent. Address lookups and account ordering can
 * shift the encoded size a little, and overshooting means the message fails to
 * send rather than merely reaching fewer people.
 */
export const SIZE_SAFETY_MARGIN = 80

/**
 * How many pings still fit alongside a message.
 *
 * @param {number} baseSize   serialized size of the transaction without pings
 * @param {number} maxWanted  how many recipients there are at most
 */
export function pingBudget(baseSize, maxWanted) {
  const spare = PACKET_LIMIT - SIZE_SAFETY_MARGIN - baseSize
  if (spare <= 0) return 0
  return Math.max(0, Math.min(maxWanted, Math.floor(spare / BYTES_PER_PING)))
}

/**
 * Choose which members to ping when they do not all fit.
 *
 * Least-recently-pinged first, so a large group cycles through everybody over
 * successive messages instead of always notifying the same few and leaving the
 * rest permanently silent. `stamps` maps address to the last time it was
 * pinged; an address with no entry has never been pinged and goes first.
 *
 * Pure function, exported for testing.
 */
export function selectPingTargets(candidates, budget, stamps = {}) {
  if (budget <= 0) return []
  const unique = [...new Set(candidates.filter(Boolean))]
  if (unique.length <= budget) return unique
  return unique
    .slice()
    .sort((a, b) => (stamps[a] || 0) - (stamps[b] || 0))
    .slice(0, budget)
}

/** Discard anything that is not a usable address, plus our own. */
export function validPingTargets(addresses, myAddress) {
  const out = []
  for (const a of addresses) {
    if (!a || a === myAddress) continue
    try { new PublicKey(a) } catch { continue }
    out.push(a)
  }
  return [...new Set(out)]
}

// ========== ROTATION STAMPS ==========
const PING_STAMPS_KEY = 'h173k_msg_ping_stamps'

function readStamps() {
  try {
    const raw = localStorage.getItem(PING_STAMPS_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

/** Last time each member of a group was pinged. */
export function getPingStamps(groupId) {
  const all = readStamps()
  const entry = all[groupId]
  return entry && typeof entry === 'object' ? entry : {}
}

export function touchPingStamps(groupId, addresses, at = Date.now()) {
  if (!groupId || !addresses || addresses.length === 0) return
  const all = readStamps()
  const entry = { ...(all[groupId] || {}) }
  for (const a of addresses) entry[a] = at
  all[groupId] = entry
  try { localStorage.setItem(PING_STAMPS_KEY, JSON.stringify(all)) } catch {}
}

export function forgetPingStamps(groupId) {
  const all = readStamps()
  if (all[groupId]) {
    delete all[groupId]
    try { localStorage.setItem(PING_STAMPS_KEY, JSON.stringify(all)) } catch {}
  }
}
