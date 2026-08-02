/**
 * h173k Wallet - End-to-End Encrypted Messenger
 *
 * Messages travel on chain as memo instructions attached to a tiny h173k
 * transfer. The wallet reads those memos back, decrypts them and groups them
 * into threads.
 *
 * WHERE A CONVERSATION LIVES
 *  - New individual conversations open on their OWN address. The side that
 *    starts the conversation derives a dedicated address from its seed, tells
 *    the other side about it inside the (encrypted) invitation, and from then
 *    on both parties post to that address. A bot that scrapes wallet addresses
 *    can only ever reach the invitation inbox, never the conversation.
 *  - Conversations that already existed, and peers running an older build, keep
 *    talking on the wallet address. That path is kept for backwards
 *    compatibility only.
 *
 * ANTI-SPAM FEE
 *  Every wallet can demand h173k for each message addressed to it, on top of
 *  the ordinary message cost and network fees. The requirement can apply to new
 *  contacts, to everybody, or to individually marked contacts, and "no fee at
 *  all" is the default. Senders learn the amount from the recipient's published
 *  announcement and attach it automatically; on arrival the payment is verified
 *  against the transaction, and messages that did not pay are filtered out.
 *
 * KEY MODEL (see msgcrypto.js)
 *  - bootstrap keys, derivable from any address, carry the first contact;
 *  - dedicated keys, exchanged in that first message, carry everything after.
 */

import { PublicKey } from '@solana/web3.js'
import { translate } from '../i18n'
import { TOKEN_MINT } from '../constants'
import { sessionWallet } from '../crypto/wallet'
import { getP2PProfile, saveP2PProfile } from '../p2p/useP2P'

import { getMyDedicatedPublicKey, decryptFrom } from './msgcrypto'
import {
  buildDirectEnvelope,
  parseEnvelope,
  stripMemoPrefix,
  memoByteLength,
  fitPayload,
  memoRemaining,
  MAX_MEMO_BYTES,
} from './envelope'
import { sendMemoTransaction, MEMO_PROGRAM_ID } from './tx'
import { deriveConversationAddress, tokenAccountOf } from './channels'
import {
  getCursor, setCursor, forgetCursor, isFirstScan, migrateLegacyCursor,
  getRotationStamps, touchRotation, pruneRotation,
} from './cursors'
import { showAppNotification } from './notify'
import {
  getMessengerScanLimit,
  getSourcesPerRefresh,
  getNotificationsEnabled,
  getLegacyModeEnabled,
  getRequiredFeeFrom,
  sanitizeFee,
  CHANNEL_SCAN_LIMIT,
} from './prefs'
import {
  groupStore,
  lastGroupTs,
  scanGroup,
  processIncomingJoinRequest,
  acceptGroupInvitation,
} from './groups'

// ========== RE-EXPORTS (stable public surface) ==========
export { MEMO_PROGRAM_ID }
export { showAppNotification } from './notify'
export {
  getMessengerScanLimit,
  setMessengerScanLimit,
  MESSENGER_SCAN_OPTIONS,
  DEFAULT_MESSENGER_SCAN,
  getNotificationsEnabled,
  setNotificationsEnabled,
  getTxNotificationsEnabled,
  setTxNotificationsEnabled,
} from './prefs'

// ========== CONSTANTS ==========
/**
 * Transport dust: the transfer that makes a message-carrying transaction show
 * up in the history of the address it is addressed to. It is not a fee — it is
 * how the message becomes visible at all — so it is set to the smallest amount
 * the token can express, one lamport at 9 decimals.
 *
 * The dust does NOT reach the recipient's wallet: for an individual chat it
 * settles at the conversation address, whose key belongs to whoever opened the
 * conversation. Anything the recipient is actually meant to earn travels
 * separately, as the anti-spam fee, straight to their wallet.
 */
export const MSG_COST = 0.000000001

export const MAX_MESSAGE_LENGTH = 200          // characters, ordinary message
export const MAX_INVITE_LENGTH = 120           // the invitation also carries the address
export const MAX_MESSAGES_PER_THREAD = 100     // stored per thread

// How many transactions we are willing to fetch in full to verify fee payments.
const MAX_FEE_VERIFICATIONS = 20

/**
 * Slack allowed when comparing fee amounts, to absorb floating-point error in
 * values carried as decimals.
 *
 * Half of one lamport at 9 decimals. It has to be smaller than the smallest
 * amount anyone can actually charge: at a full lamport, a fee of exactly one
 * lamport would be satisfied by paying nothing at all.
 */
const FEE_EPSILON = 5e-10

const THREADS_KEY = 'h173k_msg_threads'
const NOTIFY_CURSOR_KEY = 'h173k_msg_notify_cursor'

// ========== LOW-LEVEL STORAGE ==========
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

function getNotifyCursor() {
  try { return localStorage.getItem(NOTIFY_CURSOR_KEY) || null } catch { return null }
}
function setNotifyCursor(sig) {
  try { if (sig) localStorage.setItem(NOTIFY_CURSOR_KEY, sig) } catch {}
}

// ========== PROFILE (our own nick) ==========
// The messenger shares ONE nickname with the P2P marketplace.
const DEFAULT_PROFILE_CURRENCY = 'USD'

export function getProfile() {
  const p = getP2PProfile()
  if (p && p.nickname) return { nick: p.nickname }
  return null
}
export function hasProfile() {
  const p = getProfile()
  return !!(p && p.nick && p.nick.trim())
}
export function saveProfile(nick) {
  const clean = String(nick).trim().slice(0, 32)
  const existing = getP2PProfile() || {}
  saveP2PProfile({ ...existing, nickname: clean, currency: existing.currency || DEFAULT_PROFILE_CURRENCY })
  store._notify()
}

export { getMyDedicatedPublicKey }

// ========== THREAD STORE ==========
class MessengerStore {
  constructor() {
    this._listeners = []
    this._threads = readJSON(THREADS_KEY, {})
  }
  subscribe(cb) {
    this._listeners.push(cb)
    return () => { this._listeners = this._listeners.filter((l) => l !== cb) }
  }
  _notify() {
    this._persist()
    this._listeners.forEach((cb) => { try { cb() } catch (e) { console.error(e) } })
  }
  _persist() {
    writeJSON(THREADS_KEY, this._threads)
  }
  _emptyThread(address) {
    return {
      address,                 // peer's wallet address — the thread identity
      contactName: '',
      peerNick: '',
      peerPubKey: null,
      channel: null,           // dedicated conversation address (null = legacy)
      channelMine: false,      // true when we created it
      channelConfirmed: false, // true once the peer has actually posted there
      legacyPeer: false,       // peer runs a build without dedicated addresses
      peerFee: null,           // h173k the peer wants per incoming message
      quotedFee: null,         // h173k we last told THEM we want (null = never said)
      messages: [],
      unread: 0,
      handshakeSent: false,
      createdAt: Date.now(),
    }
  }
  getThread(address) {
    return this._threads[address] || null
  }
  ensureThread(address) {
    if (!this._threads[address]) this._threads[address] = this._emptyThread(address)
    // Fill in fields added by later versions.
    const t = this._threads[address]
    if (t.channel === undefined) t.channel = null
    return t
  }
  getVisibleThreads() {
    return Object.values(this._threads).sort((a, b) => lastTs(b) - lastTs(a))
  }
  getTotalUnread() {
    const direct = Object.values(this._threads).reduce((sum, t) => sum + (t.unread || 0), 0)
    let groups = 0
    try { groups = groupStore.totalUnread() + groupStore.pendingCount() } catch {}
    return direct + groups
  }
  addContact(address, contactName) {
    const t = this.ensureThread(address)
    if (contactName != null) t.contactName = String(contactName).trim().slice(0, 40)
    this._notify()
    return t
  }
  renameContact(address, contactName) {
    const t = this._threads[address]
    if (!t) return
    t.contactName = String(contactName).trim().slice(0, 40)
    this._notify()
  }
  deleteThread(address) {
    const t = this._threads[address]
    if (!t) return
    if (t.channel) forgetCursor(t.channel)
    delete this._threads[address]
    this._notify()
  }
  markRead(address) {
    const t = this._threads[address]
    if (!t) return
    if (t.unread) { t.unread = 0; this._notify() }
  }
  setThreadFields(address, patch) {
    const t = this.ensureThread(address)
    Object.assign(t, patch)
    this._notify()
    return t
  }
  trim(t) {
    if (t.messages.length > MAX_MESSAGES_PER_THREAD) {
      t.messages = t.messages.slice(t.messages.length - MAX_MESSAGES_PER_THREAD)
    }
  }
  appendOutgoing(address, { text, sig, type, reply }) {
    const t = this.ensureThread(address)
    t.messages.push({
      id: sig || ('out_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
      dir: 'out',
      text,
      ts: Date.now(),
      sig: sig || null,
      type: type || 'msg',
      reply: reply || null,
    })
    t.handshakeSent = true
    this.trim(t)
    this._notify()
  }
  /**
   * Apply a batch of decrypted incoming messages.
   * items: [{ from, peerPubKey, peerNick, text, ts, sig, type, unpaid, reply, viaChannel }]
   */
  applyIncoming(items) {
    const added = []
    let activeAddr = null
    try { activeAddr = window.__h173k_active_thread || null } catch {}

    for (const it of items) {
      const t = this.ensureThread(it.from)
      if (it.sig && t.messages.some((m) => m.sig === it.sig)) continue
      if (it.peerPubKey) t.peerPubKey = it.peerPubKey
      if (it.peerNick) t.peerNick = it.peerNick
      if (it.peerFee != null) t.peerFee = it.peerFee
      if (it.legacy) t.legacyPeer = true
      if (it.viaChannel) t.channelConfirmed = true

      t.messages.push({
        id: it.sig || ('in_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
        dir: 'in',
        text: it.text,
        ts: it.ts || Date.now(),
        sig: it.sig || null,
        type: it.type || 'msg',
        reply: it.reply || null,
        unpaid: !!it.unpaid,
        graced: !!it.graced,
        feeRequired: (it.unpaid || it.graced) ? it.feeRequired : undefined,
      })

      // Held-back messages are counted from the thread itself (see
      // unpaidCount) rather than a running total, which would drift apart from
      // the stored messages once the thread is trimmed.
      if (!it.unpaid && activeAddr !== it.from) {
        t.unread = (t.unread || 0) + 1
      }
      this.trim(t)

      if (!it.unpaid) {
        added.push({
          from: it.from,
          name: (t.contactName && t.contactName.trim()) || t.peerNick || it.from,
          text: it.text,
          type: it.type || 'msg',
          sig: it.sig || null,
        })
      }
    }
    if (items.length) this._notify()
    return added
  }
}

/** Messages currently held back from this thread for not paying the fee. */
export function unpaidCount(thread) {
  if (!thread || !thread.messages) return 0
  return thread.messages.reduce((n, m) => n + (m.unpaid ? 1 : 0), 0)
}

function lastTs(t) {
  if (!t.messages || t.messages.length === 0) return t.createdAt || 0
  return t.messages[t.messages.length - 1].ts || 0
}

export const store = new MessengerStore()
export { lastTs }

// ========== CONVERSATION ADDRESS ==========
/**
 * Decide where a message to `peerAddress` should be posted.
 * Returns { target, announceChannel, isInvite, legacy, channel }.
 *
 *  - a fresh conversation gets its own address; until the peer has answered
 *    there, the invitation still has to travel to their wallet, and it carries
 *    the conversation address inside the encrypted payload;
 *  - a peer on an older build (or a thread that predates this feature) keeps
 *    talking on the wallet address.
 */
export function resolveTarget(peerAddress) {
  const t = store.getThread(peerAddress)
  const legacyPeer = !!(t && t.legacyPeer)
  const legacyThread = !!(t && !t.channel && t.messages && t.messages.length > 0)

  if (getLegacyModeEnabled() || legacyPeer || legacyThread) {
    return { target: peerAddress, announceChannel: null, isInvite: false, legacy: true, channel: null }
  }

  let channel = t && t.channel
  if (!channel) {
    try { channel = deriveConversationAddress(peerAddress) } catch { channel = null }
  }
  if (!channel) {
    // Wallet locked: nothing we can derive, fall back to the inbox path.
    return { target: peerAddress, announceChannel: null, isInvite: true, legacy: false, channel: null }
  }

  if (t && t.channelConfirmed) {
    return { target: channel, announceChannel: null, isInvite: false, legacy: false, channel }
  }
  // Not confirmed yet: keep inviting through the wallet inbox.
  return { target: peerAddress, announceChannel: channel, isInvite: true, legacy: false, channel }
}

/**
 * Adopt a conversation address announced by the peer. When both sides opened
 * one at the same time, the lexicographically smaller address wins on both
 * devices, so they converge without another round trip.
 */
function adoptChannel(thread, announced) {
  if (!announced) return
  try { new PublicKey(announced) } catch { return }
  if (!thread.channel) {
    thread.channel = announced
    thread.channelMine = false
    return
  }
  if (thread.channel === announced) return
  if (thread.channelConfirmed) return
  const winner = [thread.channel, announced].sort()[0]
  if (winner !== thread.channel) {
    forgetCursor(thread.channel)
    thread.channel = announced
    thread.channelMine = false
  }
}

// ========== FEES ==========
/**
 * How the fee reaches the sender.
 *
 * The amount rides inside every message we send (`fee` in the payload), so a
 * contact learns it from our very first reply and their wallet attaches it from
 * then on. Nothing has to be looked up on chain.
 *
 * That leaves exactly one gap — the stranger's opening message, sent before
 * they could possibly know the amount. Charging for it would deadlock the
 * feature: we would hide the one message that has to get through for the reply
 * (and with it the fee) to ever be sent. So the opening message is always let
 * through, once per address; see `hasUsedFirstContactGrace`.
 */

/** Remember what a peer charges us, learned from a message they sent. */
export function rememberPeerFee(address, fee) {
  const clean = sanitizeFee(fee)
  const t = store.getThread(address)
  if (t && t.peerFee !== clean) {
    t.peerFee = clean
    store._notify()
  }
  return clean
}

/** What this peer will owe us for their next message — the figure we quote them. */
export function feeQuotedTo(peerAddress) {
  // Writing to somebody makes them a contact we have engaged with, so for the
  // "new contacts only" rule their next message is already free. Individual
  // amounts override the rule and are quoted whatever the mode.
  return getRequiredFeeFrom(peerAddress, true)
}

/** What our settings say this peer should pay — the figure we want. */
export function requiredFeeFrom(address) {
  return getRequiredFeeFrom(address, isKnownContact(address))
}

/**
 * What we actually hold this peer to, which is never more than we told them.
 *
 * Raising the fee on a conversation that is already running would otherwise
 * break it silently: our side would start filtering immediately, while the
 * other side only learns the new amount from our next message — and we cannot
 * write that message, because their replies are already hidden. So a rise only
 * takes effect once it has been announced, which is exactly the message that
 * announces it. A reduction applies at once, since it can never disadvantage
 * the sender.
 *
 * `quotedFee` is null when we have never written to this contact. A stranger is
 * then covered by the first-contact allowance instead; a contact we talked to
 * before this rule existed is not charged until we quote them afresh.
 */
export function enforcedFeeFrom(address) {
  const wanted = requiredFeeFrom(address)
  if (wanted <= 0) return 0
  const t = store.getThread(address)
  if (!t || t.quotedFee == null) {
    // Never quoted. Strangers fall to the first-contact allowance; established
    // contacts (upgraded from an older build) are not repriced behind their back.
    return isKnownContact(address) ? 0 : wanted
  }
  return Math.min(wanted, t.quotedFee)
}

/** True when a fee rise is set but has not been announced to this peer yet. */
export function feeRiseUnannounced(address) {
  const wanted = requiredFeeFrom(address)
  if (wanted <= 0) return false
  const t = store.getThread(address)
  if (!t) return false
  if (t.quotedFee == null) return isKnownContact(address)
  return wanted > t.quotedFee
}

/** Have we ever written to this contact? Decides whether they count as "new". */
function isKnownContact(address) {
  const t = store.getThread(address)
  if (!t) return false
  return !!t.handshakeSent || (t.messages || []).some((m) => m.dir === 'out')
}

/**
 * True when this address has already had its one free opening message, or does
 * not need one because we contacted them first (our message carried the fee).
 */
export function hasUsedFirstContactGrace(address) {
  const t = store.getThread(address)
  if (!t) return false
  if (isKnownContact(address)) return true          // we told them the amount already
  return (t.messages || []).some((m) => m.dir === 'in')
}

/**
 * Verify on chain how much h173k a transaction actually delivered to us.
 * The declared amount in the envelope is only a hint; this is the check that
 * makes the fee worth anything.
 */
async function verifyFeePayments(connection, myAddress, candidates) {
  const results = new Map()
  if (candidates.length === 0) return results
  const slice = candidates.slice(0, MAX_FEE_VERIFICATIONS)
  let txs = []
  try {
    txs = await connection.getParsedTransactions(
      slice.map((c) => c.sig),
      { maxSupportedTransactionVersion: 0 }
    )
  } catch {
    // RPC refused: fall back to the declared amount rather than losing messages.
    for (const c of candidates) results.set(c.sig, c.declared)
    return results
  }

  const mint = TOKEN_MINT.toBase58()
  slice.forEach((c, i) => {
    const tx = txs[i]
    if (!tx) { results.set(c.sig, c.declared); return }
    let received = 0
    try {
      const pre = tx.meta?.preTokenBalances || []
      const post = tx.meta?.postTokenBalances || []
      const isMine = (b) => b.owner === myAddress && b.mint === mint
      const amountAt = (list, idx) => {
        const b = list.find((x) => x.accountIndex === idx && isMine(x))
        return b ? Number(b.uiTokenAmount?.uiAmount || 0) : null
      }
      const indices = new Set([...pre, ...post].filter(isMine).map((b) => b.accountIndex))
      for (const idx of indices) {
        const before = amountAt(pre, idx)
        const after = amountAt(post, idx)
        if (after == null) continue
        received += after - (before == null ? 0 : before)
      }
    } catch {
      received = c.declared
    }
    results.set(c.sig, Math.max(0, received))
  })
  // Anything beyond the verification budget keeps the declared amount.
  for (const c of candidates.slice(MAX_FEE_VERIFICATIONS)) results.set(c.sig, c.declared)
  return results
}

// ========== SENDING ==========
/**
 * Assemble the payload for a direct message together with the envelope
 * parameters it will be wrapped in. Shared by the sender and by the composer's
 * remaining-room counter so the two can never disagree.
 */
export function buildDirectPayload({ peerAddress, myAddress, text, replyTo, routing, thread, fee }) {
  const profile = getProfile()
  const payload = { text }
  if (profile && profile.nick) payload.nick = profile.nick
  if (routing.announceChannel) payload.ch = routing.announceChannel
  // Quote what THIS peer will owe, so individually set amounts are actually
  // communicated instead of silently filtering the contact out for ever. A drop
  // to zero is announced too, as long as they might still believe otherwise —
  // otherwise they would keep overpaying.
  const myFee = feeQuotedTo(peerAddress)
  const lastQuoted = thread ? thread.quotedFee : null
  if (myFee > 0 || (lastQuoted != null && lastQuoted > 0)) payload.fee = myFee
  if (replyTo && replyTo.id) {
    payload.r = {
      i: String(replyTo.id).slice(0, 16),
      t: String(replyTo.text || '').slice(0, 34),
    }
  }
  const peerDedicatedPub = thread ? thread.peerPubKey : null
  const isRequest = !thread || !thread.handshakeSent || !peerDedicatedPub || routing.isInvite
  const envParams = {
    type: isRequest ? 'req' : 'msg',
    from: myAddress,
    myBoxPub: getMyDedicatedPublicKey(),
    feePaid: fee,
  }
  return { payload, envParams, peerDedicatedPub, isRequest, myFee }
}

/**
 * Bytes still available for the message being typed. Negative means it will not
 * fit and has to be shortened — the composer surfaces this directly instead of
 * letting the send fail after the fact.
 */
export function remainingRoomFor({ peerAddress, publicKey, text, replyTo }) {
  try {
    const routing = resolveTarget(peerAddress)
    const thread = store.getThread(peerAddress)
    const { payload, envParams } = buildDirectPayload({
      peerAddress,
      myAddress: publicKey.toBase58(),
      text: String(text || ''),
      replyTo,
      routing,
      thread,
      fee: (thread && thread.peerFee) || 0,
    })
    // `ch` is not droppable: without it the peer never learns the address.
    return memoRemaining(payload, envParams)
  } catch {
    return MAX_MEMO_BYTES
  }
}

/**
 * Send an encrypted message to a peer.
 *
 * @param {object} args connection, publicKey, peerAddress, text, replyTo,
 *                      withAutoSOL, feeOverride
 * @returns {string} transaction signature
 */
export async function sendMessage({ connection, publicKey, peerAddress, text, replyTo, withAutoSOL, feeOverride }) {
  try { new PublicKey(peerAddress) } catch { throw new Error('Invalid address') }

  const routing = resolveTarget(peerAddress)
  const limit = routing.isInvite ? MAX_INVITE_LENGTH : MAX_MESSAGE_LENGTH
  const trimmed = String(text || '').slice(0, limit)
  if (!trimmed.trim()) throw new Error('Empty message')

  const thread = store.getThread(peerAddress)

  // What the recipient charges us, as learned from their own messages. An
  // unknown peer means we have never heard from them, so there is nothing to
  // pay yet: their reply will tell us the amount.
  const fee = (feeOverride != null)
    ? sanitizeFee(feeOverride)
    : sanitizeFee(thread && thread.peerFee)

  const { payload: fullPayload, envParams, peerDedicatedPub, myFee } = buildDirectPayload({
    peerAddress,
    myAddress: publicKey.toBase58(),
    text: trimmed,
    replyTo,
    routing,
    thread,
    fee,
  })
  const type = envParams.type

  // Drop the optional fields rather than fail outright; only when the text
  // itself is too long is there nothing left to do.
  const payload = fitPayload(fullPayload, envParams)
  if (!payload) throw new Error('MEMO_TOO_LONG')

  const memo = buildDirectEnvelope({
    type,
    from: publicKey.toBase58(),
    myBoxPub: getMyDedicatedPublicKey(),
    payload,
    recipientAddress: peerAddress,
    peerDedicatedPub,
    feePaid: fee,
  })
  if (memoByteLength(memo) > MAX_MEMO_BYTES) throw new Error('MEMO_TOO_LONG')

  // Where the money goes:
  //  - the message cost keeps the conversation address alive (or, for an
  //    invitation, reaches the recipient's wallet);
  //  - the anti-spam fee always goes to the recipient's wallet.
  const transfers = []
  if (routing.isInvite || routing.legacy) {
    transfers.push({ to: peerAddress, amount: MSG_COST + fee })
    // Open the conversation address in the same transaction so it is ready.
    if (routing.announceChannel) transfers.push({ to: routing.announceChannel, amount: 0 })
  } else {
    transfers.push({ to: routing.target, amount: MSG_COST })
    if (fee > 0) transfers.push({ to: peerAddress, amount: fee })
  }

  const signature = await sendMemoTransaction({ connection, publicKey, memo, transfers, withAutoSOL })

  // Record the conversation address we just announced, and the amount we just
  // quoted — from here on that is the most we may hold this peer to.
  const sent = store.ensureThread(peerAddress)
  if (routing.channel && !sent.channel) { sent.channel = routing.channel; sent.channelMine = true }
  sent.quotedFee = myFee
  store.appendOutgoing(peerAddress, {
    text: trimmed,
    sig: signature,
    type,
    reply: payload.r ? { id: payload.r.i, text: payload.r.t } : null,
  })
  return signature
}

/** Start a conversation: create the thread and reserve its dedicated address. */
export function startConversation(peerAddress, contactName) {
  const t = store.ensureThread(peerAddress)
  if (contactName != null && contactName !== '') {
    t.contactName = String(contactName).trim().slice(0, 40)
  }
  if (!t.channel && !getLegacyModeEnabled() && (t.messages || []).length === 0) {
    try {
      t.channel = deriveConversationAddress(peerAddress)
      t.channelMine = true
    } catch { /* wallet locked — the address is derived on first send instead */ }
  }
  store._notify()
  return t
}

// ========== SCAN PLANNING ==========
/**
 * How many of the per-refresh slots are reserved for the quiet tail.
 * Roughly a fifth of the budget, at least one, never more than four — enough to
 * keep the tail moving without eating into the chats actually in use.
 */
export function rotationSlotsFor(budget) {
  if (budget <= 1) return 0
  return Math.max(1, Math.min(4, Math.round(budget * 0.2)))
}

/**
 * Decide which addresses to poll this refresh.
 *
 * A "source" is one address with its own history — a dedicated conversation
 * address or a group address. Both kinds draw on the SAME budget, so a refresh
 * costs the same number of RPC calls whether the user has twenty conversations
 * and no groups or the other way round.
 *
 * The budget is split in two:
 *  - most slots go to the most recently active chats, which is where new
 *    messages almost always land;
 *  - the rest rotate through everything else, least-recently-scanned first.
 *
 * Without the rotation a chat that drops below the cut-off can never climb back
 * on its own: it is not scanned, so its last-message time never updates, so it
 * stays below the cut-off. The reserved slots break that loop while keeping the
 * number of RPC calls per refresh exactly the same.
 *
 * Pure function. `sources` are objects carrying at least { address, ts };
 * `stamps` maps address to the time it was last scanned. Exported for testing.
 */
export function planSourceScan(sources, budget, stamps = {}) {
  const usable = (sources || []).filter((s) => s && s.address)
  if (usable.length <= budget) {
    return { fresh: usable, rotating: [], skipped: [] }
  }

  const byRecency = usable.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))
  const rotateSlots = rotationSlotsFor(budget)
  const freshCount = Math.max(0, budget - rotateSlots)

  const fresh = byRecency.slice(0, freshCount)
  const tail = byRecency.slice(freshCount)

  // Least-recently-scanned first; never scanned (no stamp) sorts to the front.
  // This ordering is derived entirely from persisted timestamps, so closing the
  // app mid-rotation does not restart it: whatever was not reached still has
  // the oldest stamp and comes first on the next launch.
  const ordered = tail.slice().sort((a, b) => {
    const sa = stamps[a.address] || 0
    const sb = stamps[b.address] || 0
    if (sa !== sb) return sa - sb
    return (b.ts || 0) - (a.ts || 0)
  })

  return {
    fresh,
    rotating: ordered.slice(0, rotateSlots),
    skipped: ordered.slice(rotateSlots),
  }
}

/** Every address the messenger can pull history from, newest activity first. */
export function collectScanSources() {
  const direct = store.getVisibleThreads()
    .filter((t) => t.channel)
    .map((t) => ({ kind: 'direct', address: t.channel, ts: lastTs(t), thread: t }))

  let groups = []
  try {
    groups = groupStore.all()
      .filter((g) => g.address)
      .map((g) => ({ kind: 'group', address: g.address, ts: lastGroupTs(g), group: g }))
  } catch {}

  return [...direct, ...groups].sort((a, b) => (b.ts || 0) - (a.ts || 0))
}

// ========== SCANNING ==========
/**
 * Read one address' history and turn the memos into decrypted items.
 * `viaChannel` marks messages that arrived on a dedicated conversation address.
 */
async function scanSource(connection, sourceAddress, { limit, myAddress, viaChannel, peerAddress }) {
  const ata = await tokenAccountOf(sourceAddress)
  if (!ata) return { items: [], control: [], newest: null, firstTime: true }

  const cursor = getCursor(sourceAddress)
  const firstTime = isFirstScan(sourceAddress)
  let sigs
  try {
    const opts = { limit }
    if (cursor) opts.until = cursor
    sigs = await connection.getSignaturesForAddress(ata, opts)
  } catch {
    return { items: [], control: [], newest: null, firstTime }
  }
  if (!sigs || sigs.length === 0) return { items: [], control: [], newest: null, firstTime }

  const items = []
  const control = []
  for (const s of sigs.slice().reverse()) { // oldest -> newest
    const memoText = stripMemoPrefix(s.memo)
    if (!memoText) continue
    const env = parseEnvelope(memoText)
    if (!env) continue
    if (env.f === myAddress) continue          // our own traffic
    if (viaChannel && peerAddress && env.f !== peerAddress) continue // not our peer
    if (env.t === 'grp') continue              // handled by the group scanner

    if (env.t === 'jreq' || env.t === 'jok' || env.t === 'jno') {
      const payload = decryptFrom(env)
      if (payload) {
        control.push({
          type: env.t,
          from: env.f,
          payload: { ...payload, boxPub: env.p || null },
          ts: s.blockTime ? s.blockTime * 1000 : Date.now(),
          sig: s.signature,
        })
      }
      continue
    }
    if (env.t === 'cfg') {
      rememberPeerFee(env.f, env.fee)
      continue
    }

    const payload = decryptFrom(env)
    if (!payload || typeof payload.text !== 'string') continue
    items.push({
      from: env.f,
      peerPubKey: env.p || null,
      peerNick: payload.nick || '',
      peerFee: payload.fee != null ? sanitizeFee(payload.fee) : null,
      announcedChannel: payload.ch || null,
      text: String(payload.text).slice(0, MAX_MESSAGE_LENGTH),
      reply: payload.r ? { id: payload.r.i, text: payload.r.t } : null,
      ts: s.blockTime ? s.blockTime * 1000 : Date.now(),
      sig: s.signature,
      type: env.t === 'req' ? 'req' : 'msg',
      declaredFee: sanitizeFee(env.x),
      legacy: env.v === 1,
      viaChannel: !!viaChannel,
    })
  }
  return { items, control, newest: sigs[0].signature, firstTime }
}

/**
 * Full refresh: the wallet inbox, the active conversation addresses and every
 * group. Called alongside the balance refresh, so it has to stay bounded — the
 * number of conversation addresses polled per run is configurable.
 */
export async function scanIncomingMessages(connection, publicKey, options = {}) {
  if (!connection || !publicKey) return 0
  if (!sessionWallet.isUnlocked()) return 0

  const myAddress = publicKey.toBase58()
  migrateLegacyCursor(myAddress)

  const notifyCursor = getNotifyCursor()
  const collected = []
  const controls = []

  // --- 1. wallet inbox: invitations, legacy conversations, group admin traffic
  const inbox = await scanSource(connection, myAddress, {
    limit: getMessengerScanLimit(),
    myAddress,
    viaChannel: false,
  })
  collected.push(...inbox.items)
  controls.push(...inbox.control)

  // --- 2. conversation and group addresses, from one shared budget
  const activeAddr = options.activeAddress || (() => {
    try { return window.__h173k_active_thread || null } catch { return null }
  })()
  const activeGroupId = (() => {
    try { return window.__h173k_active_group || null } catch { return null }
  })()

  const sources = collectScanSources()
  pruneRotation(sources.map((s) => s.address))

  const plan = planSourceScan(sources, getSourcesPerRefresh(), getRotationStamps())
  const toScan = [...plan.fresh, ...plan.rotating]

  // Whatever is open on screen is always polled, on top of the budget.
  const active = sources.find((s) => (
    (activeAddr && s.kind === 'direct' && s.thread.address === activeAddr) ||
    (activeGroupId && s.kind === 'group' && s.group.id === activeGroupId)
  ))
  if (active && !toScan.includes(active)) toScan.push(active)

  const channelNewest = []
  for (const source of toScan) {
    try {
      if (source.kind === 'group') {
        await scanGroup(connection, publicKey, source.group.id)
      } else {
        const res = await scanSource(connection, source.address, {
          limit: CHANNEL_SCAN_LIMIT,
          myAddress,
          viaChannel: true,
          peerAddress: source.thread.address,
        })
        collected.push(...res.items)
        if (res.newest) channelNewest.push([source.address, res.newest])
      }
    } catch { /* one unreachable address must not break the refresh */ }

    // Stamped one at a time, not in a batch at the end: closing the app
    // mid-refresh then keeps the progress made so far, and the rotation picks
    // up where it stopped instead of redoing the same addresses.
    touchRotation([source.address])
  }

  // --- 3. fee filtering
  //
  // Order matters. The grace decision has to come FIRST, because it decides
  // which messages are subject to a fee at all — and only those are worth
  // spending an RPC round trip on. Deciding it after picking the verification
  // set (as an earlier version did) left the second message from a stranger
  // outside the verified set, so its self-declared amount was taken on trust.
  const graceUsed = new Set()
  const marked = collected.map((it) => {
    const required = enforcedFeeFrom(it.from)
    if (required <= 0) return { ...it, owed: 0 }

    // A stranger's opening message is never charged: they could not have known
    // the amount, and hiding it would deadlock the mechanism — the reply that
    // teaches them the fee would never be written. One message per address,
    // tracked here too so a burst in a single batch cannot spend it twice.
    if (!hasUsedFirstContactGrace(it.from) && !graceUsed.has(it.from)) {
      graceUsed.add(it.from)
      return { ...it, owed: 0, graced: true, feeRequired: required }
    }
    return { ...it, owed: required }
  })

  // The amount declared in the envelope is the sender's own claim, so it can
  // never prove payment — but it can disprove it for free. Anyone who does not
  // even claim to have covered the fee is filtered without an RPC round trip,
  // which is both strictly correct and cheaper.
  let verified = new Map()
  const candidates = marked
    .filter((it) => it.owed > 0 && it.sig && (it.declaredFee || 0) + FEE_EPSILON >= it.owed)
    .map((it) => ({ sig: it.sig, declared: it.declaredFee || 0 }))
  if (candidates.length) {
    verified = await verifyFeePayments(connection, myAddress, candidates)
  }

  const items = marked.map(({ owed, ...it }) => {
    if (owed <= 0) return it
    if ((it.declaredFee || 0) + FEE_EPSILON < owed) return { ...it, unpaid: true, feeRequired: owed }

    // KNOWN LIMITATION: when the chain lookup could not run — RPC failure, or
    // more claimants in one refresh than MAX_FEE_VERIFICATIONS — the claim is
    // taken at face value rather than hiding a message that may well be
    // genuine. A sender who forges the declared amount gets through in that
    // window, so the fee is a deterrent, not a guarantee.
    const paid = verified.has(it.sig) ? verified.get(it.sig) : (it.declaredFee || 0)
    const ok = paid + FEE_EPSILON >= owed
    return { ...it, unpaid: !ok, feeRequired: owed }
  })

  // --- 4. store the messages and adopt announced conversation addresses
  const added = store.applyIncoming(items)
  let adopted = false
  for (const it of items) {
    if (!it.announcedChannel) continue
    const t = store.ensureThread(it.from)
    adoptChannel(t, it.announcedChannel)
    adopted = true
  }
  if (adopted) store._notify()

  // --- 5. group control traffic (join requests and admissions)
  for (const c of controls) {
    try {
      if (c.type === 'jreq') await processIncomingJoinRequest(connection, c)
      else if (c.type === 'jok') acceptGroupInvitation(c.payload, c.from)
    } catch { /* ignore a malformed control message */ }
  }

  // --- 6. notifications: only for genuinely new, paid messages, and never on
  //        the very first scan (that would replay the whole backfill).
  if (!inbox.firstTime && notifyCursor && added.length) {
    notifyNewMessages(added)
  }

  // --- 7. cursors
  if (inbox.newest) { setCursor(myAddress, inbox.newest); setNotifyCursor(inbox.newest) }
  for (const [addr, sig] of channelNewest) setCursor(addr, sig)

  return items.length
}

// ========== LOCKED NOTIFICATION SCAN ==========
/**
 * Lightweight scan used while the wallet is LOCKED. It cannot decrypt, so it
 * only detects that new message-bearing memos exist and fires a content-less
 * notification. Uses public history only — no private key required.
 */
export async function scanLockedNotifications(connection, address) {
  if (!connection || !address) return 0
  if (!getNotificationsEnabled()) return 0
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return 0

  const tokenAccount = await tokenAccountOf(address)
  if (!tokenAccount) return 0

  const notifyCursor = getNotifyCursor()
  let sigs
  try {
    const opts = { limit: getMessengerScanLimit() }
    if (notifyCursor) opts.until = notifyCursor
    sigs = await connection.getSignaturesForAddress(tokenAccount, opts)
  } catch {
    return 0
  }
  if (!sigs || sigs.length === 0) return 0

  const newestSig = sigs[0].signature
  let count = 0
  for (const s of sigs) {
    const memoText = stripMemoPrefix(s.memo)
    if (!memoText) continue
    const env = parseEnvelope(memoText)
    if (!env) continue
    if (env.f === address) continue
    if (env.t === 'cfg') continue
    count++
  }

  if (notifyCursor && count > 0) {
    const title = count === 1
      ? translate('messenger.newMessage')
      : translate('messenger.newMessages', { n: count })
    showAppNotification(title, translate('messenger.unlockToRead'), { tag: 'h173k-msg-locked' })
  }

  setNotifyCursor(newestSig)
  return count
}

// ========== NOTIFICATIONS ==========
function notifyNewMessages(added) {
  if (!added || added.length === 0) return
  if (!getNotificationsEnabled()) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  let activeAddr = null
  try { activeAddr = window.__h173k_active_thread || null } catch {}

  for (const it of added) {
    if (it.from === activeAddr) continue
    const title = it.name || it.from
    const body = it.type === 'req' ? translate('messenger.wantsToStart') : it.text
    showAppNotification(title, body, { tag: 'h173k-msg-' + it.from, data: { from: it.from, url: '/' } })
  }
}
