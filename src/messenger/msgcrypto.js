/**
 * h173k Wallet - Messenger cryptographic primitives.
 *
 * Split out of messenger.js so that the group module and the direct-message
 * module can share the same identity/encryption code without creating an
 * import cycle. This module depends only on the wallet session.
 *
 * KEY MODEL
 *  - bootstrap keys : curve25519 keys converted from the Solana ed25519 keypair
 *    (ed2curve). Derivable from any address, so a first contact can already be
 *    encrypted end-to-end.
 *  - dedicated keys : nacl.box keypair derived deterministically from the seed
 *    with a domain separator. Exchanged inside the first message.
 *  - group keys     : random nacl.secretbox (symmetric) keys created by the
 *    group admin and handed to each accepted member over a box-encrypted
 *    channel.
 */

import { PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import ed2curve from 'ed2curve'
import bs58 from 'bs58'
import { sha256 } from '@noble/hashes/sha256'
import { sessionWallet } from '../crypto/wallet'

const IDENTITY_LABEL = 'h173k_messenger_box_v1'

// ========== BASE64 HELPERS ==========
export function b64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
export function unb64(str) {
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function b64url(bytes) {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function unb64url(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return unb64(s)
}
export function encodeJsonB64Url(obj) {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)))
}
export function decodeJsonB64Url(str) {
  try {
    return JSON.parse(new TextDecoder().decode(unb64url(str)))
  } catch {
    return null
  }
}

// ========== DEDICATED IDENTITY (nacl.box) ==========
let _identityCache = { addr: null, id: null }
sessionWallet.onLock(() => { _identityCache = { addr: null, id: null } })

export function getIdentity() {
  if (!sessionWallet.isUnlocked()) return null
  const kp = sessionWallet.getKeypairSilent() // does NOT reset auto-lock
  const addr = kp.publicKey.toBase58()
  if (_identityCache.addr === addr && _identityCache.id) return _identityCache.id

  const seed32 = deriveSeed(kp.secretKey, IDENTITY_LABEL)
  const boxKp = nacl.box.keyPair.fromSecretKey(seed32)
  const id = { pub: bs58.encode(boxKp.publicKey), sec: bs58.encode(boxKp.secretKey) }
  _identityCache = { addr, id }
  return id
}

export function getMyDedicatedPublicKey() {
  const id = getIdentity()
  return id ? id.pub : null
}

/**
 * Deterministic 32-byte seed from the wallet secret key plus a domain label.
 * Used for the messaging identity and for conversation/group addresses, so all
 * of them survive a reinstall and are reproducible from the seed phrase alone.
 */
export function deriveSeed(secretKey, label) {
  const labelBytes = new TextEncoder().encode(label)
  const material = new Uint8Array(secretKey.length + labelBytes.length)
  material.set(secretKey, 0)
  material.set(labelBytes, secretKey.length)
  return sha256(material)
}

// ========== BOOTSTRAP (address-derived) KEYS ==========
let _bootstrapCache = { addr: null, secret: null }
sessionWallet.onLock(() => { _bootstrapCache = { addr: null, secret: null } })

export function getBootstrapSecret() {
  if (!sessionWallet.isUnlocked()) return null
  const kp = sessionWallet.getKeypairSilent()
  const addr = kp.publicKey.toBase58()
  if (_bootstrapCache.addr === addr && _bootstrapCache.secret) return _bootstrapCache.secret
  const secret = ed2curve.convertSecretKey(kp.secretKey)
  _bootstrapCache = { addr, secret }
  return secret
}

export function bootstrapPubFromAddress(address) {
  try {
    return ed2curve.convertPublicKey(new PublicKey(address).toBytes())
  } catch {
    return null
  }
}

// ========== ASYMMETRIC ENCRYPT / DECRYPT ==========
/**
 * Encrypt a payload for a single recipient.
 * Uses the dedicated key pair when it is already known, otherwise falls back to
 * the address-derived bootstrap key.
 * @returns {{ e:'addr'|'box', n:string, c:string }}
 */
export function encryptFor(payload, { recipientAddress, peerDedicatedPub }) {
  const msgBytes = new TextEncoder().encode(JSON.stringify(payload))
  const nonce = nacl.randomBytes(nacl.box.nonceLength)

  if (peerDedicatedPub) {
    const id = getIdentity()
    if (!id) throw new Error('Wallet is locked')
    const box = nacl.box(msgBytes, nonce, bs58.decode(peerDedicatedPub), bs58.decode(id.sec))
    return { e: 'box', n: b64(nonce), c: b64(box) }
  }

  const mySec = getBootstrapSecret()
  const theirPub = bootstrapPubFromAddress(recipientAddress)
  if (!mySec || !theirPub) throw new Error('Cannot derive encryption keys')
  const box = nacl.box(msgBytes, nonce, theirPub, mySec)
  return { e: 'addr', n: b64(nonce), c: b64(box) }
}

/**
 * Decrypt an incoming asymmetric envelope. Returns the payload object or null.
 * Tries the declared scheme first and then the other one, because a sender may
 * have had a stale idea of which keys we had exchanged.
 */
export function decryptFrom(env) {
  const tryBox = () => {
    const id = getIdentity()
    if (!id || !env.p) return null
    const opened = nacl.box.open(unb64(env.c), unb64(env.n), bs58.decode(env.p), bs58.decode(id.sec))
    return opened ? JSON.parse(new TextDecoder().decode(opened)) : null
  }
  const tryAddr = () => {
    const mySec = getBootstrapSecret()
    const theirPub = bootstrapPubFromAddress(env.f)
    if (!mySec || !theirPub) return null
    const opened = nacl.box.open(unb64(env.c), unb64(env.n), theirPub, mySec)
    return opened ? JSON.parse(new TextDecoder().decode(opened)) : null
  }
  try {
    const first = env.e === 'box' ? tryBox : tryAddr
    const second = env.e === 'box' ? tryAddr : tryBox
    return first() || second()
  } catch {
    try { return (env.e === 'box' ? tryAddr : tryBox)() } catch { return null }
  }
}

// ========== SYMMETRIC (GROUP) ENCRYPT / DECRYPT ==========
export function newGroupKey() {
  return bs58.encode(nacl.randomBytes(nacl.secretbox.keyLength))
}

export function encryptGroup(payload, groupKeyB58) {
  const key = bs58.decode(groupKeyB58)
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const box = nacl.secretbox(new TextEncoder().encode(JSON.stringify(payload)), nonce, key)
  return { e: 'gkey', n: b64(nonce), c: b64(box) }
}

export function decryptGroup(env, groupKeyB58) {
  try {
    const opened = nacl.secretbox.open(unb64(env.c), unb64(env.n), bs58.decode(groupKeyB58))
    if (!opened) return null
    return JSON.parse(new TextDecoder().decode(opened))
  } catch {
    return null
  }
}
