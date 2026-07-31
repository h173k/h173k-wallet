/**
 * H173K Wallet - Memo envelope format.
 *
 * Everything the messenger puts on chain is one JSON envelope inside a Solana
 * memo. The envelope itself is plaintext (it has to be readable by the two
 * parties without any prior state); the payload inside `c` is encrypted.
 *
 *   {
 *     v : 2                protocol version (1 = legacy, still accepted)
 *     t : 'req'            invitation to a conversation (carries the address)
 *         'msg'            ordinary direct message
 *         'grp'            group message
 *         'jreq'           request to join a group
 *         'jok' | 'jno'    admin's answer to a join request
 *         'cfg'            public announcement of this wallet's message fee
 *     e : 'addr'|'box'|'gkey'   which key encrypted the payload
 *     f : sender's wallet address
 *     p : sender's dedicated box public key (key exchange)
 *     g : group id (group traffic only)
 *     x : fee attached by the sender, in h173k (declared; verified on chain)
 *     n : nonce, base64
 *     c : ciphertext, base64
 *   }
 *
 * Legacy v1 envelopes ('req'/'msg' on the wallet address) still parse and are
 * handled by the same code path, so conversations started by an older build
 * keep working.
 */

import { encryptFor, encryptGroup } from './msgcrypto'

export const PROTOCOL_VERSION = 2
export const LEGACY_PROTOCOL_VERSION = 1

export const ENVELOPE_TYPES = ['req', 'msg', 'grp', 'jreq', 'jok', 'jno', 'cfg']

// Maximum size of the memo we are willing to put on chain. A Solana memo can be
// larger, but past this the transaction stops fitting comfortably in one packet.
export const MAX_MEMO_BYTES = 560

// nacl.box and nacl.secretbox both use a 24-byte nonce and add 16 bytes of
// authentication tag to the ciphertext.
const NONCE_BYTES = 24
const MAC_BYTES = 16

const utf8 = (s) => new TextEncoder().encode(s).length
const b64Len = (n) => Math.ceil(n / 3) * 4

/**
 * Exact size of the memo a payload would produce, without doing the encryption.
 *
 * This matters because the limit is in BYTES while the composer counts
 * characters: 200 Latin characters are 200 bytes, but 200 Polish characters can
 * be 400 and 200 Amharic characters 600. Measuring instead of guessing is the
 * only way to keep a message from being rejected after the user has written it.
 */
export function estimateMemoSize({ type, from, myBoxPub, groupId, feePaid, payload }) {
  const plain = utf8(JSON.stringify(payload))
  const env = {
    v: PROTOCOL_VERSION,
    t: type,
    e: groupId ? 'gkey' : 'box',
    f: from,
    p: myBoxPub || undefined,
    g: groupId || undefined,
    n: 'n'.repeat(b64Len(NONCE_BYTES)),
    c: 'c'.repeat(b64Len(plain + MAC_BYTES)),
  }
  if (feePaid > 0) env.x = feePaid
  return utf8(JSON.stringify(env))
}

/**
 * Shrink a payload until its memo fits, by dropping optional fields in order of
 * how little they matter. Returns the payload to send, or null when even the
 * stripped version is too big (the text itself has to be shortened).
 *
 * The nickname is the first thing to go: contacts already store it from the
 * invitation, so losing it on one long message costs nothing. The fee is NOT
 * droppable — it is the only way a contact learns what we charge, and a message
 * that quietly omitted it would get every later message from them filtered.
 */
export function fitPayload(payload, envParams, droppable = ['nick']) {
  const current = { ...payload }
  if (estimateMemoSize({ ...envParams, payload: current }) <= MAX_MEMO_BYTES) return current
  for (const field of droppable) {
    if (current[field] === undefined) continue
    delete current[field]
    if (estimateMemoSize({ ...envParams, payload: current }) <= MAX_MEMO_BYTES) return current
  }
  return null
}

/**
 * How many bytes of room are left for the user, assuming the optional fields
 * are dropped if needed. Drives the composer's counter.
 */
export function memoRemaining(payload, envParams, droppable = ['nick']) {
  const stripped = { ...payload }
  for (const field of droppable) delete stripped[field]
  return MAX_MEMO_BYTES - estimateMemoSize({ ...envParams, payload: stripped })
}

/** Build an envelope encrypted for one recipient. */
export function buildDirectEnvelope({ type, from, myBoxPub, payload, recipientAddress, peerDedicatedPub, feePaid }) {
  const enc = encryptFor(payload, { recipientAddress, peerDedicatedPub })
  const env = {
    v: PROTOCOL_VERSION,
    t: type,
    e: enc.e,
    f: from,
    p: myBoxPub || undefined,
    n: enc.n,
    c: enc.c,
  }
  if (feePaid > 0) env.x = feePaid
  return JSON.stringify(env)
}

/** Build an envelope encrypted with a symmetric group key. */
export function buildGroupEnvelope({ from, myBoxPub, payload, groupKey, groupId }) {
  const enc = encryptGroup(payload, groupKey)
  const env = {
    v: PROTOCOL_VERSION,
    t: 'grp',
    e: enc.e,
    f: from,
    p: myBoxPub || undefined,
    g: groupId,
    n: enc.n,
    c: enc.c,
  }
  return JSON.stringify(env)
}

/**
 * getSignaturesForAddress returns memos formatted as "[<len>] <text>".
 * Strip that prefix so the JSON can be parsed.
 */
export function stripMemoPrefix(memo) {
  if (typeof memo !== 'string') return null
  const m = memo.match(/^\[\d+\]\s?/)
  return m ? memo.slice(m[0].length) : memo
}

/** Parse a memo into an envelope, or null when it is not one of ours. */
export function parseEnvelope(memoText) {
  try {
    const obj = JSON.parse(memoText)
    if (!obj || typeof obj !== 'object') return null
    if (obj.v !== PROTOCOL_VERSION && obj.v !== LEGACY_PROTOCOL_VERSION) return null
    if (!obj.f) return null
    // 'cfg' is plaintext and carries no ciphertext.
    if (obj.t === 'cfg') return obj
    if (!obj.n || !obj.c) return null
    const type = obj.t || 'msg'
    if (!ENVELOPE_TYPES.includes(type)) return null
    return { ...obj, t: type }
  } catch {
    return null
  }
}

/** Byte length of a memo string, used for the length guard before sending. */
export function memoByteLength(memo) {
  return new TextEncoder().encode(memo).length
}
