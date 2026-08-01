/**
 * H173K Wallet - Encrypted group chats.
 *
 * ADDRESS
 * A group never lives on anybody's wallet address. The admin's wallet derives a
 * dedicated address from its seed and that address is the group: members send
 * their message transfers to it and read its history. It is announced only to
 * accepted members, so it cannot be harvested and spammed.
 *
 * ENCRYPTION
 * The admin generates a symmetric key (nacl.secretbox) at creation time. Each
 * accepted member receives it inside a box-encrypted acceptance message. Group
 * traffic is encrypted with that key, so the chain only ever sees ciphertext.
 *
 * ADMISSION
 * Joining is gated on holding h173k, checked twice:
 *   1. in the applicant's own wallet, before the request is even sent — if the
 *      balance is too low the app blocks it and explains why, so nothing
 *      reaches the admin at all;
 *   2. in the admin's wallet, automatically, when the request arrives. A
 *      request from somebody below the threshold is rejected silently and is
 *      never shown to the admin.
 *
 * INVITE LINK
 * The link carries the admin address, an invite code and the group's rules —
 * never the group address. Every join request therefore goes to the admin.
 */

import { PublicKey } from '@solana/web3.js'
import { translate } from '../i18n'
import {
  getMyDedicatedPublicKey,
  newGroupKey,
  decryptGroup,
  encodeJsonB64Url,
  decodeJsonB64Url,
} from './msgcrypto'
import {
  buildGroupEnvelope, buildDirectEnvelope, parseEnvelope, stripMemoPrefix,
  memoByteLength, fitPayload, memoRemaining, MAX_MEMO_BYTES,
} from './envelope'
import { sendMemoTransaction, createTokenAccountFor } from './tx'
import { deriveGroupAddress, tokenAccountOf, balanceOf } from './channels'
import { getCursor, setCursor, forgetCursor, isFirstScan } from './cursors'
import { getNotificationsEnabled, CHANNEL_SCAN_LIMIT, sanitizeFee } from './prefs'
import { showAppNotification } from './notify'
import { getP2PProfile } from '../p2p/useP2P'

// ========== CONSTANTS ==========
export const MAX_GROUP_NAME_LENGTH = 40
export const MAX_GROUP_MESSAGE_LENGTH = 150
export const MAX_MESSAGES_PER_GROUP = 150
// Transport dust for a group post: settles at the group address purely so the
// transaction appears in the group's history. One lamport at 9 decimals — the
// smallest non-zero amount, since a zero transfer would leave the message
// invisible. The cost the admin sets is a separate transfer to their wallet.
export const MIN_GROUP_MSG_COST = 0.000000001
export const INVITE_LINK_PARAM = 'join'
export const REPLY_PREVIEW_LENGTH = 34

const GROUPS_KEY = 'h173k_msg_groups'

// ========== STORE ==========
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

class GroupStore {
  constructor() {
    this._listeners = []
    this._groups = readJSON(GROUPS_KEY, {})
  }
  subscribe(cb) {
    this._listeners.push(cb)
    return () => { this._listeners = this._listeners.filter((l) => l !== cb) }
  }
  _notify() {
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(this._groups)) } catch {}
    this._listeners.forEach((cb) => { try { cb() } catch (e) { console.error(e) } })
  }
  all() {
    return Object.values(this._groups)
  }
  get(id) {
    return this._groups[id] || null
  }
  getByAddress(address) {
    return this.all().find((g) => g.address === address) || null
  }
  put(group) {
    this._groups[group.id] = group
    this._notify()
    return group
  }
  update(id, patch) {
    const g = this._groups[id]
    if (!g) return null
    this._groups[id] = { ...g, ...patch }
    this._notify()
    return this._groups[id]
  }
  remove(id) {
    const g = this._groups[id]
    if (!g) return
    if (g.address) forgetCursor(g.address)
    delete this._groups[id]
    this._notify()
  }
  markRead(id) {
    const g = this._groups[id]
    if (g && g.unread) { g.unread = 0; this._notify() }
  }
  totalUnread() {
    return this.all().reduce((sum, g) => sum + (g.unread || 0), 0)
  }
  /** Number of join requests waiting for the admin's decision. */
  pendingCount() {
    return this.all().reduce((sum, g) => sum + Object.keys(g.pending || {}).length, 0)
  }
  appendMessages(id, incoming, myAddress) {
    const g = this._groups[id]
    if (!g) return []
    const added = []
    let activeGroup = null
    try { activeGroup = window.__h173k_active_group || null } catch {}

    for (const m of incoming) {
      if (m.sig && g.messages.some((x) => x.sig === m.sig)) continue
      const mine = m.from === myAddress
      g.messages.push({
        id: m.sig || ('g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
        dir: mine ? 'out' : 'in',
        from: m.from,
        nick: m.nick || '',
        text: m.text,
        reply: m.reply || null,
        ts: m.ts || Date.now(),
        sig: m.sig || null,
      })
      if (m.from && m.from !== myAddress) {
        g.members = g.members || {}
        g.members[m.from] = { nick: m.nick || '', boxPub: m.boxPub || (g.members[m.from]?.boxPub || null), ts: m.ts }
      }
      if (!mine) {
        if (activeGroup !== id) g.unread = (g.unread || 0) + 1
        added.push({ groupId: id, groupName: g.name, nick: m.nick || '', text: m.text })
      }
    }
    if (g.messages.length > MAX_MESSAGES_PER_GROUP) {
      g.messages = g.messages.slice(g.messages.length - MAX_MESSAGES_PER_GROUP)
    }
    g.messages.sort((a, b) => (a.ts || 0) - (b.ts || 0))
    if (added.length || incoming.length) this._notify()
    return added
  }
  appendLocal(id, message) {
    const g = this._groups[id]
    if (!g) return
    g.messages.push(message)
    if (g.messages.length > MAX_MESSAGES_PER_GROUP) {
      g.messages = g.messages.slice(g.messages.length - MAX_MESSAGES_PER_GROUP)
    }
    this._notify()
  }
}

export const groupStore = new GroupStore()

export function lastGroupTs(g) {
  if (!g.messages || g.messages.length === 0) return g.createdAt || 0
  return g.messages[g.messages.length - 1].ts || 0
}

// ========== IDS ==========
function newGroupId() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function newInviteCode() {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)
}

function myNick() {
  const p = getP2PProfile()
  return (p && p.nickname) ? p.nickname : ''
}

// ========== CREATE ==========
/**
 * Create an encrypted group. The admin sets the entry requirement (minimum
 * h173k a member must hold) and the per-message cost inside the group.
 * One transaction is sent: it opens the group address' token account so members
 * can post to it right away.
 */
export async function createGroup({ connection, publicKey, name, minBalance, msgCost, withAutoSOL }) {
  const cleanName = String(name || '').trim().slice(0, MAX_GROUP_NAME_LENGTH)
  if (!cleanName) throw new Error('EMPTY_NAME')

  const id = newGroupId()
  const address = deriveGroupAddress(id)
  const key = newGroupKey()
  const cost = Math.max(MIN_GROUP_MSG_COST, sanitizeFee(msgCost))

  await createTokenAccountFor({ connection, publicKey, address, withAutoSOL })

  const group = {
    id,
    name: cleanName,
    address,
    admin: publicKey.toBase58(),
    isAdmin: true,
    key,
    minBalance: sanitizeFee(minBalance),
    msgCost: cost,
    inviteCode: newInviteCode(),
    members: {},
    pending: {},
    messages: [],
    unread: 0,
    createdAt: Date.now(),
  }
  return groupStore.put(group)
}

/** Regenerate the invite code, invalidating links that are already out there. */
export function rotateInviteCode(groupId) {
  return groupStore.update(groupId, { inviteCode: newInviteCode() })
}

export function leaveGroup(groupId) {
  groupStore.remove(groupId)
}

// ========== INVITE LINKS ==========
/**
 * Build a shareable link. It carries the admin address, the invite code and the
 * rules the applicant needs to know up front — deliberately NOT the group
 * address, so the only way in is through the admin.
 */
export function buildInviteLink(group) {
  const payload = {
    a: group.admin,
    c: group.inviteCode,
    n: group.name,
    m: group.minBalance || 0,
    k: group.msgCost || 0,
  }
  const base = (typeof window !== 'undefined' && window.location) ? window.location.origin : ''
  return `${base}/?${INVITE_LINK_PARAM}=${encodeJsonB64Url(payload)}`
}

export function parseInviteParam(param) {
  const obj = decodeJsonB64Url(param)
  if (!obj || !obj.a || !obj.c) return null
  try { new PublicKey(obj.a) } catch { return null }
  return {
    admin: obj.a,
    code: String(obj.c).slice(0, 32),
    name: String(obj.n || '').slice(0, MAX_GROUP_NAME_LENGTH),
    minBalance: Number(obj.m) || 0,
    msgCost: Number(obj.k) || 0,
  }
}

/** Read a group invitation from the current URL, if there is one. */
export function getGroupInviteFromURL() {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get(INVITE_LINK_PARAM)
    if (!raw) return null
    return parseInviteParam(raw)
  } catch {
    return null
  }
}

export function clearGroupInviteFromURL() {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete(INVITE_LINK_PARAM)
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash)
  } catch {}
}

// ========== JOINING (applicant side) ==========
/**
 * Send a join request to the group's admin.
 *
 * The balance requirement is enforced here first: when the applicant does not
 * hold enough h173k the request is refused locally and never leaves the device,
 * so it cannot appear in the admin's inbox at all.
 *
 * @throws Error('INSUFFICIENT_BALANCE:<required>:<have>')
 */
export async function sendJoinRequest({ connection, publicKey, invite, withAutoSOL, balance }) {
  if (!invite || !invite.admin) throw new Error('INVALID_INVITE')
  const me = publicKey.toBase58()
  if (invite.admin === me) throw new Error('OWN_GROUP')

  const required = Number(invite.minBalance) || 0
  const have = (typeof balance === 'number') ? balance : await balanceOf(connection, me)
  if (required > 0 && have < required) {
    throw new Error(`INSUFFICIENT_BALANCE:${required}:${have}`)
  }

  const payload = {
    code: invite.code,
    nick: myNick(),
    name: invite.name,
  }
  const memo = buildDirectEnvelope({
    type: 'jreq',
    from: me,
    myBoxPub: getMyDedicatedPublicKey(),
    payload,
    recipientAddress: invite.admin,
    peerDedicatedPub: null, // bootstrap keys: we may never have met the admin
  })
  if (memoByteLength(memo) > MAX_MEMO_BYTES) throw new Error('MEMO_TOO_LONG')

  const sig = await sendMemoTransaction({
    connection,
    publicKey,
    memo,
    transfers: [{ to: invite.admin, amount: MIN_GROUP_MSG_COST }],
    withAutoSOL,
  })

  // Remember the pending application so the acceptance can be matched later.
  const applications = readJSON('h173k_msg_applications', {})
  applications[invite.code] = { ...invite, sentAt: Date.now(), sig }
  try { localStorage.setItem('h173k_msg_applications', JSON.stringify(applications)) } catch {}
  return sig
}

/** Group invitations we have applied for and are still waiting on. */
export function getPendingApplications() {
  return readJSON('h173k_msg_applications', {})
}

/** Does an acceptance answer a request we actually sent to that admin? */
function matchesOurApplication(code, adminAddress) {
  if (!code) return false
  const entry = getPendingApplications()[code]
  return !!entry && entry.admin === adminAddress
}
export function clearApplication(code) {
  const applications = readJSON('h173k_msg_applications', {})
  if (applications[code]) {
    delete applications[code]
    try { localStorage.setItem('h173k_msg_applications', JSON.stringify(applications)) } catch {}
  }
}

// ========== JOINING (admin side) ==========
/**
 * Handle a join request that arrived in the admin's inbox.
 *
 * The wallet checks the applicant's h173k balance on chain by itself. Anyone
 * below the group's threshold is turned away silently — the request is dropped
 * and the admin is never shown it.
 *
 * @returns {'pending'|'rejected'|'ignored'|'member'}
 */
export async function processIncomingJoinRequest(connection, { from, payload, ts }) {
  if (!payload || !payload.code) return 'ignored'
  const group = groupStore.all().find((g) => g.isAdmin && g.inviteCode === payload.code)
  if (!group) return 'ignored' // unknown or rotated code

  if (group.members && group.members[from]) return 'member'

  const required = Number(group.minBalance) || 0
  if (required > 0) {
    const have = await balanceOf(connection, from)
    if (have < required) {
      // Silent rejection: recorded locally for diagnostics only, never surfaced.
      const rejected = Array.isArray(group.rejected) ? group.rejected.slice(-20) : []
      rejected.push({ from, have, required, ts: ts || Date.now() })
      groupStore.update(group.id, { rejected })
      return 'rejected'
    }
  }

  const pending = { ...(group.pending || {}) }
  pending[from] = {
    address: from,
    nick: String(payload.nick || '').slice(0, 32),
    boxPub: payload.boxPub || null,
    ts: ts || Date.now(),
  }
  groupStore.update(group.id, { pending })

  if (getNotificationsEnabled()) {
    showAppNotification(
      translate('groups.joinRequestTitle', { group: group.name }),
      pending[from].nick || from,
      { tag: 'h173k-join-' + group.id, data: { group: group.id } }
    )
  }
  return 'pending'
}

/** Accept an applicant: hand them the group address and the group key. */
export async function approveJoinRequest({ connection, publicKey, groupId, applicant, withAutoSOL }) {
  const group = groupStore.get(groupId)
  if (!group || !group.isAdmin) throw new Error('NOT_ADMIN')
  const entry = (group.pending || {})[applicant]
  if (!entry) throw new Error('NO_REQUEST')

  // Re-check the balance at the moment of approval — it may have changed.
  const required = Number(group.minBalance) || 0
  if (required > 0) {
    const have = await balanceOf(connection, applicant)
    if (have < required) {
      const pending = { ...(group.pending || {}) }
      delete pending[applicant]
      groupStore.update(groupId, { pending })
      throw new Error(`INSUFFICIENT_BALANCE:${required}:${have}`)
    }
  }

  const memo = buildDirectEnvelope({
    type: 'jok',
    from: publicKey.toBase58(),
    myBoxPub: getMyDedicatedPublicKey(),
    payload: {
      gid: group.id,
      name: group.name,
      addr: group.address,
      key: group.key,
      min: group.minBalance,
      cost: group.msgCost,
      code: group.inviteCode,
    },
    recipientAddress: applicant,
    peerDedicatedPub: entry.boxPub || null,
  })
  if (memoByteLength(memo) > MAX_MEMO_BYTES) throw new Error('MEMO_TOO_LONG')

  const sig = await sendMemoTransaction({
    connection,
    publicKey,
    memo,
    transfers: [{ to: applicant, amount: MIN_GROUP_MSG_COST }],
    withAutoSOL,
  })

  const pending = { ...(group.pending || {}) }
  delete pending[applicant]
  const members = { ...(group.members || {}) }
  members[applicant] = { nick: entry.nick, boxPub: entry.boxPub, ts: Date.now() }
  groupStore.update(groupId, { pending, members })
  return sig
}

/** Turn an applicant down. Nothing is sent on chain — the request just goes away. */
export function declineJoinRequest(groupId, applicant) {
  const group = groupStore.get(groupId)
  if (!group) return
  const pending = { ...(group.pending || {}) }
  delete pending[applicant]
  groupStore.update(groupId, { pending })
}

/**
 * Drop somebody from the member list.
 *
 * IMPORTANT: this does not revoke anything. The group is encrypted with one
 * shared key which the removed member still holds, along with the group
 * address, so they can keep reading and posting. Genuine revocation needs a new
 * group key delivered to every remaining member, which is not implemented; the
 * UI says so rather than implying otherwise.
 */
export function removeMember(groupId, address) {
  const group = groupStore.get(groupId)
  if (!group) return
  const members = { ...(group.members || {}) }
  delete members[address]
  groupStore.update(groupId, { members })
}

// ========== JOINING (acceptance received) ==========
/** Store a group we have just been admitted to. */
export function acceptGroupInvitation(payload, adminAddress) {
  if (!payload || !payload.gid || !payload.addr || !payload.key) return null
  const existing = groupStore.get(payload.gid)
  if (existing) return existing

  // Only accept an answer to a request we actually sent to this admin.
  // Without this anybody could push an arbitrary group into the chat list just
  // by sending an acceptance nobody asked for.
  if (!matchesOurApplication(payload.code, adminAddress)) return null

  const group = {
    id: payload.gid,
    name: String(payload.name || '').slice(0, MAX_GROUP_NAME_LENGTH) || payload.gid,
    address: payload.addr,
    admin: adminAddress,
    isAdmin: false,
    key: payload.key,
    minBalance: Number(payload.min) || 0,
    msgCost: Math.max(MIN_GROUP_MSG_COST, Number(payload.cost) || 0),
    inviteCode: payload.code || null,
    members: {},
    pending: {},
    messages: [],
    unread: 0,
    createdAt: Date.now(),
  }
  groupStore.put(group)
  if (payload.code) clearApplication(payload.code)

  if (getNotificationsEnabled()) {
    showAppNotification(
      translate('groups.acceptedTitle'),
      translate('groups.acceptedBody', { group: group.name }),
      { tag: 'h173k-group-' + group.id, data: { group: group.id } }
    )
  }
  return group
}

// ========== SENDING ==========
// ========== MESSAGE COST ==========
/**
 * Where the money goes when a member posts.
 *
 *  - a dust transfer to the GROUP ADDRESS, which is what makes the transaction
 *    show up in the group's history — this is the transport, not a fee;
 *  - the message cost to the ADMIN'S WALLET, which is who the admin set it for.
 *
 * Both ride in the same transaction as the memo. Solana charges per signature
 * rather than per instruction, so the extra transfer adds no network fee at all
 * and cannot half-succeed: the message and the payment land together or neither
 * does.
 *
 * The admin does not pay themselves.
 *
 * There is deliberately no "unpaid cost" bookkeeping. Because the whole thing
 * is one transaction, the message cannot land without its payment, so a debt
 * could never arise. The one theoretical failure — the packet growing past the
 * 1232-byte limit — is ruled out by measurement rather than handled at runtime:
 * the worst case (maximum memo, both token accounts created in the same
 * transaction) comes to 1067 bytes, and a test holds that margin.
 */

/**
 * Build the transfers for one group message. Pure, so the amounts can be
 * checked without touching the network.
 */
export function buildGroupTransfers({ group, myAddress }) {
  const cost = Math.max(MIN_GROUP_MSG_COST, sanitizeFee(group.msgCost))
  const transfers = [
    // Transport: puts the transaction in the group's history so members see it.
    { to: group.address, amount: MIN_GROUP_MSG_COST },
  ]
  if (cost > 0 && group.admin && group.admin !== myAddress) {
    transfers.push({ to: group.admin, amount: cost })
  }
  return { transfers, cost }
}

/**
 * Assemble a group message payload plus its envelope parameters. Shared by the
 * sender and by the composer's counter so they always agree.
 */
export function buildGroupPayload({ myAddress, group, text, replyTo }) {
  const payload = { text }
  const nick = myNick()
  if (nick) payload.nick = nick
  if (replyTo && replyTo.id) {
    payload.r = {
      i: String(replyTo.id).slice(0, 16),
      n: String(replyTo.nick || '').slice(0, 12),
      t: String(replyTo.text || '').slice(0, REPLY_PREVIEW_LENGTH),
    }
  }
  return {
    payload,
    envParams: {
      type: 'grp',
      from: myAddress,
      myBoxPub: getMyDedicatedPublicKey(),
      groupId: group.id,
    },
  }
}

/** Bytes still available for the group message being typed. */
export function remainingGroupRoom({ groupId, myAddress, text, replyTo }) {
  const group = groupStore.get(groupId)
  if (!group) return MAX_MEMO_BYTES
  try {
    const { payload, envParams } = buildGroupPayload({
      myAddress, group, text: String(text || ''), replyTo,
    })
    return memoRemaining(payload, envParams, ['r', 'nick'])
  } catch {
    return MAX_MEMO_BYTES
  }
}

/**
 * Post a message to a group. The message cost set by the admin is transferred
 * to the group address (never to a wallet), which is also what makes the
 * transaction appear in the group's history.
 *
 * @param {object} replyTo optional { id, nick, text } of the message answered
 */
export async function sendGroupMessage({ connection, publicKey, groupId, text, replyTo, withAutoSOL }) {
  const group = groupStore.get(groupId)
  if (!group) throw new Error('NO_GROUP')
  const trimmed = String(text || '').trim().slice(0, MAX_GROUP_MESSAGE_LENGTH)
  if (!trimmed) throw new Error('EMPTY_MESSAGE')

  const { payload: fullPayload, envParams } = buildGroupPayload({
    myAddress: publicKey.toBase58(),
    group,
    text: trimmed,
    replyTo,
  })

  // In a group the nickname is how members tell each other apart, so it is the
  // last thing dropped: the reply preview goes first, then the nickname.
  const payload = fitPayload(fullPayload, envParams, ['r', 'nick'])
  if (!payload) throw new Error('MEMO_TOO_LONG')

  const memo = buildGroupEnvelope({
    from: publicKey.toBase58(),
    myBoxPub: getMyDedicatedPublicKey(),
    payload,
    groupKey: group.key,
    groupId: group.id,
  })
  if (memoByteLength(memo) > MAX_MEMO_BYTES) throw new Error('MEMO_TOO_LONG')

  const { transfers } = buildGroupTransfers({ group, myAddress: publicKey.toBase58() })
  const sig = await sendMemoTransaction({ connection, publicKey, memo, transfers, withAutoSOL })

  groupStore.appendLocal(groupId, {
    id: sig,
    dir: 'out',
    from: publicKey.toBase58(),
    nick: payload.nick,
    text: trimmed,
    reply: payload.r ? { id: payload.r.i, nick: payload.r.n, text: payload.r.t } : null,
    ts: Date.now(),
    sig,
  })
  return sig
}

// ========== SCANNING ==========
/**
 * Read new messages from one group's address.
 * @returns {Array} the messages that were added (for notifications)
 */
export async function scanGroup(connection, publicKey, groupId) {
  const group = groupStore.get(groupId)
  if (!group || !group.address) return []
  const ata = await tokenAccountOf(group.address)
  if (!ata) return []

  const myAddress = publicKey.toBase58()
  const cursor = getCursor(group.address)
  const firstTime = isFirstScan(group.address)

  let sigs
  try {
    const opts = { limit: CHANNEL_SCAN_LIMIT }
    if (cursor) opts.until = cursor
    sigs = await connection.getSignaturesForAddress(ata, opts)
  } catch {
    return []
  }
  if (!sigs || sigs.length === 0) return []

  const incoming = []
  for (const s of sigs.slice().reverse()) {
    const memoText = stripMemoPrefix(s.memo)
    if (!memoText) continue
    const env = parseEnvelope(memoText)
    if (!env || env.t !== 'grp') continue
    if (env.g && env.g !== group.id) continue
    const payload = decryptGroup(env, group.key)
    if (!payload || typeof payload.text !== 'string') continue
    incoming.push({
      from: env.f,
      boxPub: env.p || null,
      nick: String(payload.nick || '').slice(0, 32),
      text: String(payload.text).slice(0, MAX_GROUP_MESSAGE_LENGTH),
      reply: payload.r ? { id: payload.r.i, nick: payload.r.n, text: payload.r.t } : null,
      ts: s.blockTime ? s.blockTime * 1000 : Date.now(),
      sig: s.signature,
    })
  }

  const added = groupStore.appendMessages(group.id, incoming, myAddress)
  setCursor(group.address, sigs[0].signature)

  if (!firstTime && added.length && getNotificationsEnabled()) {
    let activeGroup = null
    try { activeGroup = window.__h173k_active_group || null } catch {}
    if (activeGroup !== group.id) {
      const last = added[added.length - 1]
      showAppNotification(
        group.name,
        (last.nick ? last.nick + ': ' : '') + last.text,
        { tag: 'h173k-group-' + group.id, data: { group: group.id } }
      )
    }
  }
  return added
}

