/**
 * H173K Wallet - End-to-End Encrypted Messenger
 *
 * Messages travel on-chain as Memo instructions attached to a tiny h173k
 * transfer (MSG_COST) sent to the recipient. The wallet scans its own h173k
 * token-account history together with the balance refresh, decrypts incoming
 * memos and groups them into conversation threads.
 *
 * KEY MODEL (hybrid):
 *  - Bootstrap keys: a curve25519 keypair derived from the Solana ed25519
 *    keypair (via ed2curve). Because the public key can be derived from any
 *    Solana address, the FIRST message ("request") can already be encrypted
 *    to a recipient we have never contacted before.
 *  - Dedicated keys: a randomly generated nacl.box keypair, created the first
 *    time the user enters the messenger and stored in localStorage. Each party
 *    shares its dedicated public key inside the first "request" message
 *    (the key exchange). Once exchanged, normal messages are encrypted with the
 *    dedicated keys.
 *
 * Memo payload (plaintext envelope, JSON):
 *   { v:1, t:'req'|'msg', e:'addr'|'box', f:<senderAddr>, p:<senderDedicatedPub>,
 *     n:<nonceB64>, c:<cipherB64> }
 * Decrypted content: { nick, text }
 */

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from '@solana/spl-token'
import nacl from 'tweetnacl'
import ed2curve from 'ed2curve'
import bs58 from 'bs58'
import { sha256 } from '@noble/hashes/sha256'
import { TOKEN_MINT, TOKEN_DECIMALS } from '../constants'
import { sessionWallet } from '../crypto/wallet'
import { getP2PProfile, saveP2PProfile } from '../p2p/useP2P'

// ========== CONSTANTS ==========
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

// Cost of one message, transferred to the recipient (per spec: 0.00001 h173k)
export const MSG_COST = 0.00001
export const MSG_COST_LAMPORTS = Math.round(MSG_COST * Math.pow(10, TOKEN_DECIMALS))

export const MAX_MESSAGE_LENGTH = 200          // characters
export const MAX_MESSAGES_PER_THREAD = 100     // stored per thread
export const MAX_SCAN_PER_UPDATE = 100         // default signatures fetched per refresh

// User-configurable: how many signatures to scan per refresh.
export const MESSENGER_SCAN_OPTIONS = [100, 200, 300, 500, 800, 1000]
export const DEFAULT_MESSENGER_SCAN = 100
const SCAN_LIMIT_KEY = 'h173k_msg_scan_limit'
const NOTIF_KEY = 'h173k_msg_notifications'

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
}
export function getNotificationsEnabled() {
  try { return localStorage.getItem(NOTIF_KEY) === '1' } catch { return false }
}
export function setNotificationsEnabled(on) {
  try { localStorage.setItem(NOTIF_KEY, on ? '1' : '0') } catch {}
}

const TX_NOTIF_KEY = 'h173k_tx_notifications'
export function getTxNotificationsEnabled() {
  try { return localStorage.getItem(TX_NOTIF_KEY) === '1' } catch { return false }
}
export function setTxNotificationsEnabled(on) {
  try { localStorage.setItem(TX_NOTIF_KEY, on ? '1' : '0') } catch {}
}

const WSOL_ATA_RENT_SP = 0.00204               // rent for creating recipient token ATA

// localStorage keys
const THREADS_KEY = 'h173k_msg_threads'
const CURSOR_KEY = 'h173k_msg_cursor'           // last decrypted+stored signature
const NOTIFY_CURSOR_KEY = 'h173k_msg_notify_cursor' // last signature we emitted a notification for

function getNotifyCursor() {
  try { return localStorage.getItem(NOTIFY_CURSOR_KEY) || null } catch { return null }
}
function setNotifyCursor(sig) {
  try { if (sig) localStorage.setItem(NOTIFY_CURSOR_KEY, sig) } catch {}
}

const PROTOCOL_VERSION = 1

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

// ========== PROFILE (our own nick) ==========
// The messenger shares ONE nickname with the P2P marketplace (h173k_p2p_profile).
// Setting it here updates the marketplace nickname and vice-versa.
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

// ========== DEDICATED MESSAGING IDENTITY (box keypair) ==========
// Derived DETERMINISTICALLY from the wallet seed (the Solana secret key) with a
// domain separator. This means:
//  - it survives clearing localStorage / reinstalling,
//  - it's identical on any device restored from the same seed,
//  - it is NOT derivable from the public address alone (depends on the secret +
//    label), so the key exchange in the first message still carries meaning.
const IDENTITY_LABEL = 'h173k_messenger_box_v1'
let _identityCache = { addr: null, id: null }
sessionWallet.onLock(() => { _identityCache = { addr: null, id: null } })

function getIdentity() {
  if (!sessionWallet.isUnlocked()) return null
  const kp = sessionWallet.getKeypairSilent() // does NOT reset auto-lock
  const addr = kp.publicKey.toBase58()
  if (_identityCache.addr === addr && _identityCache.id) return _identityCache.id

  const label = new TextEncoder().encode(IDENTITY_LABEL)
  const material = new Uint8Array(kp.secretKey.length + label.length)
  material.set(kp.secretKey, 0)
  material.set(label, kp.secretKey.length)
  const seed32 = sha256(material) // 32 bytes -> curve25519 box secret seed

  const boxKp = nacl.box.keyPair.fromSecretKey(seed32)
  const id = { pub: bs58.encode(boxKp.publicKey), sec: bs58.encode(boxKp.secretKey) }
  _identityCache = { addr, id }
  return id
}

export function getMyDedicatedPublicKey() {
  const id = getIdentity()
  return id ? id.pub : null
}

// ========== KEY DERIVATION HELPERS ==========
// Cache the bootstrap (address-derived) secret to avoid recomputing every scan.
let _bootstrapCache = { addr: null, secret: null }
sessionWallet.onLock(() => { _bootstrapCache = { addr: null, secret: null } })

function getBootstrapSecret() {
  if (!sessionWallet.isUnlocked()) return null
  const kp = sessionWallet.getKeypairSilent() // does NOT reset auto-lock
  const addr = kp.publicKey.toBase58()
  if (_bootstrapCache.addr === addr && _bootstrapCache.secret) {
    return _bootstrapCache.secret
  }
  const secret = ed2curve.convertSecretKey(kp.secretKey) // 32 bytes
  _bootstrapCache = { addr, secret }
  return secret
}

function bootstrapPubFromAddress(address) {
  try {
    return ed2curve.convertPublicKey(new PublicKey(address).toBytes())
  } catch {
    return null
  }
}

// ========== ENCRYPT / DECRYPT ==========
/**
 * Encrypt a payload object for a recipient.
 * @param {object} payload - { nick, text }
 * @param {object} opts - { recipientAddress, peerDedicatedPub }
 * @returns {{ e:'addr'|'box', n:string, c:string }}
 */
function encryptPayload(payload, { recipientAddress, peerDedicatedPub }) {
  const msgBytes = new TextEncoder().encode(JSON.stringify(payload))
  const nonce = nacl.randomBytes(nacl.box.nonceLength)

  if (peerDedicatedPub) {
    // We already exchanged dedicated keys -> use them.
    const id = getIdentity()
    if (!id) throw new Error('Wallet is locked')
    const mySec = bs58.decode(id.sec)
    const theirPub = bs58.decode(peerDedicatedPub)
    const box = nacl.box(msgBytes, nonce, theirPub, mySec)
    return { e: 'box', n: b64(nonce), c: b64(box) }
  }

  // Bootstrap: encrypt to the recipient's address-derived key.
  const mySec = getBootstrapSecret()
  const theirPub = bootstrapPubFromAddress(recipientAddress)
  if (!mySec || !theirPub) throw new Error('Cannot derive encryption keys')
  const box = nacl.box(msgBytes, nonce, theirPub, mySec)
  return { e: 'addr', n: b64(nonce), c: b64(box) }
}

/**
 * Decrypt an incoming memo envelope. Returns payload object or null.
 */
function decryptEnvelope(env) {
  try {
    const nonce = unb64(env.n)
    const cipher = unb64(env.c)
    if (env.e === 'box') {
      const id = getIdentity()
      if (!id || !env.p) return null
      const mySec = bs58.decode(id.sec)
      const theirPub = bs58.decode(env.p)
      const opened = nacl.box.open(cipher, nonce, theirPub, mySec)
      if (!opened) return null
      return JSON.parse(new TextDecoder().decode(opened))
    } else {
      // 'addr' bootstrap
      const mySec = getBootstrapSecret()
      const theirPub = bootstrapPubFromAddress(env.f)
      if (!mySec || !theirPub) return null
      const opened = nacl.box.open(cipher, nonce, theirPub, mySec)
      if (!opened) return null
      return JSON.parse(new TextDecoder().decode(opened))
    }
  } catch {
    return null
  }
}

function b64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
function unb64(str) {
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ========== THREAD STORE (in-memory + localStorage + pub/sub) ==========
class MessengerStore {
  constructor() {
    this._listeners = []
    this._threads = readJSON(THREADS_KEY, {})
  }
  subscribe(cb) {
    this._listeners.push(cb)
    return () => { this._listeners = this._listeners.filter(l => l !== cb) }
  }
  _notify() {
    this._persist()
    this._listeners.forEach(cb => { try { cb() } catch (e) { console.error(e) } })
  }
  _persist() {
    writeJSON(THREADS_KEY, this._threads)
  }
  _emptyThread(address) {
    return {
      address,
      contactName: '',
      peerNick: '',
      peerPubKey: null,
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
    if (!this._threads[address]) {
      this._threads[address] = this._emptyThread(address)
    }
    return this._threads[address]
  }
  // All threads, most-recent first.
  getVisibleThreads() {
    return Object.values(this._threads)
      .sort((a, b) => lastTs(b) - lastTs(a))
  }
  getTotalUnread() {
    return Object.values(this._threads)
      .reduce((sum, t) => sum + (t.unread || 0), 0)
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
    if (this._threads[address]) {
      delete this._threads[address]
      this._notify()
    }
  }
  markRead(address) {
    const t = this._threads[address]
    if (!t) return
    if (t.unread) { t.unread = 0; this._notify() }
  }
  trim(t) {
    if (t.messages.length > MAX_MESSAGES_PER_THREAD) {
      t.messages = t.messages.slice(t.messages.length - MAX_MESSAGES_PER_THREAD)
    }
  }
  appendOutgoing(address, { text, sig, type }) {
    const t = this.ensureThread(address)
    t.messages.push({
      id: sig || ('out_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
      dir: 'out',
      text,
      ts: Date.now(),
      sig: sig || null,
      type: type || 'msg',
    })
    t.handshakeSent = true
    this.trim(t)
    this._notify()
  }
  /**
   * Apply a batch of decrypted incoming messages.
   * items: [{ from, peerPubKey, peerNick, text, ts, sig, type }]
   */
  applyIncoming(items) {
    const added = []
    let activeAddr = null
    try { activeAddr = window.__h173k_active_thread || null } catch {}
    for (const it of items) {
      const t = this.ensureThread(it.from)
      // Dedup by signature
      if (it.sig && t.messages.some(m => m.sig === it.sig)) continue
      if (it.peerPubKey) t.peerPubKey = it.peerPubKey
      if (it.peerNick) t.peerNick = it.peerNick
      t.messages.push({
        id: it.sig || ('in_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
        dir: 'in',
        text: it.text,
        ts: it.ts || Date.now(),
        sig: it.sig || null,
        type: it.type || 'msg',
      })
      // Only count as unread if the thread isn't currently open
      if (activeAddr !== it.from) t.unread = (t.unread || 0) + 1
      this.trim(t)
      added.push({
        from: it.from,
        name: (t.contactName && t.contactName.trim()) || t.peerNick || it.from,
        text: it.text,
        type: it.type || 'msg',
        sig: it.sig || null,
      })
    }
    if (added.length) this._notify()
    return added
  }
}

function lastTs(t) {
  if (!t.messages || t.messages.length === 0) return t.createdAt || 0
  return t.messages[t.messages.length - 1].ts || 0
}

export const store = new MessengerStore()

// ========== MEMO PARSING ==========
function stripMemoPrefix(memo) {
  // getSignaturesForAddress returns memos formatted as "[<len>] <text>"
  if (typeof memo !== 'string') return null
  const m = memo.match(/^\[\d+\]\s?/)
  return m ? memo.slice(m[0].length) : memo
}

function parseEnvelope(memoText) {
  try {
    const obj = JSON.parse(memoText)
    if (!obj || obj.v !== PROTOCOL_VERSION) return null
    if (!obj.f || !obj.n || !obj.c) return null
    return obj
  } catch {
    return null
  }
}

// ========== SCAN INCOMING (called with balance refresh) ==========
/**
 * Scan the wallet's h173k token account for new message-bearing transfers.
 * Reads at most MAX_SCAN_PER_UPDATE new signatures, stopping at the last one
 * already processed. Returns the number of new messages applied.
 */
export async function scanIncomingMessages(connection, publicKey) {
  if (!connection || !publicKey) return 0
  if (!sessionWallet.isUnlocked()) return 0

  const myAddress = publicKey.toBase58()
  let tokenAccount
  try {
    tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)
  } catch {
    return 0
  }

  const cursor = (() => { try { return localStorage.getItem(CURSOR_KEY) || null } catch { return null } })()

  let sigs
  try {
    const opts = { limit: getMessengerScanLimit() }
    if (cursor) opts.until = cursor
    sigs = await connection.getSignaturesForAddress(tokenAccount, opts)
  } catch {
    return 0
  }
  if (!sigs || sigs.length === 0) return 0

  const newestSig = sigs[0].signature
  const ordered = sigs.slice().reverse() // oldest -> newest

  // Signatures we have NOT yet emitted any notification for (newer than the
  // notify cursor). Used so we don't re-notify (with content) messages that
  // were already announced generically while the wallet was locked.
  const notifyCursor = getNotifyCursor()
  const newSinceNotify = new Set()
  for (const s of sigs) { // newest -> oldest
    if (s.signature === notifyCursor) break
    newSinceNotify.add(s.signature)
  }

  const items = []
  for (const s of ordered) {
    const memoText = stripMemoPrefix(s.memo)
    if (!memoText) continue
    const env = parseEnvelope(memoText)
    if (!env) continue
    if (env.f === myAddress) continue // our own outgoing message
    const payload = decryptEnvelope(env)
    if (!payload || typeof payload.text !== 'string') continue
    items.push({
      from: env.f,
      peerPubKey: env.p || null,
      peerNick: payload.nick || '',
      text: String(payload.text).slice(0, MAX_MESSAGE_LENGTH),
      ts: s.blockTime ? s.blockTime * 1000 : Date.now(),
      sig: s.signature,
      type: env.t === 'req' ? 'req' : 'msg',
    })
  }

  const added = store.applyIncoming(items)
  // Notify (with full content) only for messages we haven't notified about yet,
  // and not on the very first scan (no prior cursor) to avoid a backfill burst.
  if (cursor) {
    const toNotify = added.filter(a => a.sig && newSinceNotify.has(a.sig))
    notifyNewMessages(toNotify)
  }

  try { localStorage.setItem(CURSOR_KEY, newestSig) } catch {}
  setNotifyCursor(newestSig)
  return items.length
}

// ========== LOCKED NOTIFICATION SCAN ==========
/**
 * Lightweight scan used while the wallet is LOCKED. It cannot decrypt (no key),
 * so it only detects that new incoming message-bearing memos exist and fires a
 * content-less "new message" notification. Uses the public token-account
 * signature history only — no private key required.
 */
export async function scanLockedNotifications(connection, address) {
  if (!connection || !address) return 0
  if (!getNotificationsEnabled()) return 0
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return 0

  let owner, tokenAccount
  try {
    owner = new PublicKey(address)
    tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, owner)
  } catch {
    return 0
  }

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
    if (env.f === address) continue // our own outgoing
    count++ // incoming message-bearing memo (content stays encrypted/unread)
  }

  // Only announce on incremental updates, not the first ever backfill.
  if (notifyCursor && count > 0) {
    const title = count === 1 ? 'New message' : count + ' new messages'
    showAppNotification(title, 'Unlock the wallet to read', { tag: 'h173k-msg-locked' })
  }

  setNotifyCursor(newestSig)
  return count
}

// ========== LOCAL NOTIFICATIONS ==========
const NOTIF_ICON = '/icons/icon-192x192.png'

function notifyNewMessages(added) {
  if (!added || added.length === 0) return
  if (!getNotificationsEnabled()) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  let activeAddr = null
  try { activeAddr = window.__h173k_active_thread || null } catch {}

  for (const it of added) {
    if (it.from === activeAddr) continue // don't notify for the conversation you're viewing
    const title = it.name || it.from
    const body = it.type === 'req' ? 'Wants to start a conversation' : it.text
    showNotification(title, body, it.from)
  }
}

function showNotification(title, body, from) {
  showAppNotification(title, body, { tag: 'h173k-msg-' + from, data: { from, url: '/' } })
}

/**
 * Display a local OS notification via the service worker (works on desktop and
 * mobile PWA), falling back to the Notification constructor. Caller is
 * responsible for checking the relevant enabled-toggle; this only checks that
 * notifications are permitted by the platform.
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
      if (from) { try { window.dispatchEvent(new CustomEvent('h173k-open-thread', { detail: from })) } catch {} }
      n.close()
    }
  } catch { /* platform doesn't allow the Notification constructor */ }
}

// ========== SEND MESSAGE ==========
/**
 * Build the memo envelope for an outgoing message.
 */
function buildMemo({ type, fromAddress, payload, recipientAddress, peerDedicatedPub }) {
  const enc = encryptPayload(payload, { recipientAddress, peerDedicatedPub })
  const env = {
    v: PROTOCOL_VERSION,
    t: type,
    e: enc.e,
    f: fromAddress,
    p: getMyDedicatedPublicKey(),
    n: enc.n,
    c: enc.c,
  }
  const json = JSON.stringify(env)
  if (new TextEncoder().encode(json).length > 560) {
    throw new Error('Message too long after encryption')
  }
  return json
}

/**
 * Send an encrypted message to a peer.
 * @param {object} args
 *   connection, publicKey, peerAddress, text, withAutoSOL (from useSwap)
 * @returns {string} transaction signature
 */
export async function sendMessage({ connection, publicKey, peerAddress, text, withAutoSOL }) {
  const trimmed = String(text || '').slice(0, MAX_MESSAGE_LENGTH)
  if (!trimmed.trim()) throw new Error('Empty message')

  let recipientPubkey
  try { recipientPubkey = new PublicKey(peerAddress) } catch { throw new Error('Invalid address') }

  const profile = getProfile()
  const myNick = profile ? profile.nick : ''
  const thread = store.getThread(peerAddress)
  const peerDedicatedPub = thread ? thread.peerPubKey : null
  // First message to a peer we have not exchanged keys with is a "request".
  const isRequest = !thread || !thread.handshakeSent || !peerDedicatedPub
  const type = isRequest ? 'req' : 'msg'

  const memoString = buildMemo({
    type,
    fromAddress: publicKey.toBase58(),
    payload: { nick: myNick, text: trimmed },
    recipientAddress: peerAddress,
    peerDedicatedPub,
  })

  // Determine if recipient token account must be created (sender pays rent).
  let recipientAtaRent = 0
  let recipientTokenAccount
  try {
    recipientTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, recipientPubkey)
    try {
      await getAccount(connection, recipientTokenAccount)
    } catch {
      recipientAtaRent = WSOL_ATA_RENT_SP
    }
  } catch {
    throw new Error('Cannot resolve recipient token account')
  }

  const signature = await withAutoSOL(
    async () => {
      const senderTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)
      const transaction = new Transaction()

      // Create recipient token account if needed
      try { await getAccount(connection, recipientTokenAccount) }
      catch {
        transaction.add(
          createAssociatedTokenAccountInstruction(publicKey, recipientTokenAccount, recipientPubkey, TOKEN_MINT)
        )
      }

      // The message cost transfer (carries the conversation)
      transaction.add(
        createTransferInstruction(senderTokenAccount, recipientTokenAccount, publicKey, MSG_COST_LAMPORTS)
      )

      // The encrypted memo
      transaction.add(
        new TransactionInstruction({
          keys: [{ pubkey: publicKey, isSigner: true, isWritable: false }],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(memoString, 'utf8'),
        })
      )

      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey

      const signed = sessionWallet.signTransaction(transaction)
      const sig = await connection.sendRawTransaction(signed.serialize())
      await connection.confirmTransaction(sig, 'confirmed')
      return sig
    },
    () => {},
    recipientAtaRent
  )

  store.appendOutgoing(peerAddress, { text: trimmed, sig: signature, type })
  return signature
}
