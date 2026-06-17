/**
 * H173K P2P Marketplace — core logic
 *
 * Offers are published as on-chain MEMO messages attached to a tiny h173k transfer
 * sent to a per-currency, keyless address (see ./addresses.js). The transfer amount
 * is intentionally trapped ("burned"), so posting/cancelling an offer costs h173k.
 *
 * Reading offers = read the recent memos on a currency address's token account.
 * Cancelling an offer = publish a signed "cancel" memo; only the original poster can
 * produce a valid signature, so nobody can cancel someone else's offer.
 *
 * NOTE ON PRIVACY: memos are public and permanent. The contact handle (Telegram /
 * phone) lives in the memo in clear text and is only hidden in the UI until the
 * viewer meets the deposit requirement. This is by design — the user chooses what
 * contact to expose.
 */

import { useCallback, useState, useRef } from 'react'
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from '@solana/spl-token'
import nacl from 'tweetnacl'
import { TOKEN_MINT, TOKEN_DECIMALS } from '../constants'
import { sessionWallet } from '../crypto/wallet'
import { useSwap } from '../hooks/useSwap'
import { getP2PAddress } from './addresses'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

// Memo marker so we can tell our offers apart from unrelated memos.
const MARKER = 'h1p2p'

// Fees (in h173k). Posting an offer burns 10x more than cancelling.
export const POST_FEE_H173K = 0.00001
export const CANCEL_FEE_H173K = 0.000001
const POST_FEE_RAW = Math.round(POST_FEE_H173K * Math.pow(10, TOKEN_DECIMALS))   // 10000
const CANCEL_FEE_RAW = Math.round(CANCEL_FEE_H173K * Math.pow(10, TOKEN_DECIMALS)) // 1000

// Rent for creating a token account (first offer in a currency creates its ATA).
const TOKEN_ATA_RENT_SOL = 0.00204

// localStorage keys
const PROFILE_KEY = 'h173k_p2p_profile'
const LIMIT_KEY = 'h173k_p2p_limit'

export const FETCH_LIMIT_OPTIONS = [10, 20, 50, 100]
export const DEFAULT_FETCH_LIMIT = 20

// Offer memo size limits (memos must fit in a single Solana transaction).
// Worst case (first offer in a currency => tx also creates the ATA) leaves ~813
// bytes for the memo; we keep a safe ceiling well below that.
export const MAX_PAYMENT_METHODS = 5
export const MAX_METHOD_LEN = 24
export const MAX_MEMO_BYTES = 700

/** Trim, drop empties/duplicates, cap each length and the total count. */
export function sanitizePaymentMethods(list) {
  const out = []
  for (const raw of (list || [])) {
    const m = String(raw).trim().slice(0, MAX_METHOD_LEN)
    if (!m) continue
    if (out.includes(m)) continue
    out.push(m)
    if (out.length >= MAX_PAYMENT_METHODS) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Profile / preferences (nickname + operating currency + fetch limit)
// ---------------------------------------------------------------------------

export function getP2PProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p && p.nickname && p.currency) return p
    return null
  } catch {
    return null
  }
}

export function saveP2PProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
    return true
  } catch {
    return false
  }
}

export function isP2POnboarded() {
  return getP2PProfile() !== null
}

export function getP2PFetchLimit() {
  try {
    const v = parseInt(localStorage.getItem(LIMIT_KEY), 10)
    if (FETCH_LIMIT_OPTIONS.includes(v)) return v
  } catch {}
  return DEFAULT_FETCH_LIMIT
}

export function saveP2PFetchLimit(limit) {
  try {
    localStorage.setItem(LIMIT_KEY, String(limit))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Memo encode / decode + signatures
// ---------------------------------------------------------------------------

export function generateOfferId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz'
  const a = new Uint8Array(12)
  crypto.getRandomValues(a)
  let s = ''
  for (let i = 0; i < a.length; i++) s += chars[a[i] % chars.length]
  return s
}

// Canonical message that the poster signs to authorise a cancellation.
function cancelMessage(currency, offerId) {
  return `${MARKER}:cancel:${currency}:${offerId}`
}

function toBase64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromBase64(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Sign a cancellation with the unlocked wallet. Returns base64 signature. */
export function signCancellation(currency, offerId) {
  const msg = cancelMessage(currency, offerId)
  const sig = sessionWallet.signMessage(msg) // ed25519 detached, Uint8Array(64)
  return toBase64(sig)
}

/** Verify a cancellation signature against the offer's original poster pubkey. */
export function verifyCancellation(currency, offerId, sigB64, posterPubkey) {
  try {
    const msg = new TextEncoder().encode(cancelMessage(currency, offerId))
    const sig = fromBase64(sigB64)
    const pk = new PublicKey(posterPubkey).toBytes()
    return nacl.sign.detached.verify(msg, sig, pk)
  } catch {
    return false
  }
}

/** Build the offer memo string. Short keys to stay well within memo limits. */
function encodeOfferMemo(o) {
  return JSON.stringify({
    m: MARKER,
    k: 'o',
    id: o.id,
    n: o.nickname,
    c: o.currency,
    ty: o.type,            // 'buy' | 'sell'
    p: o.pricePerUsd,      // currency units per $1 of h173k value
    mn: o.minUsd,          // min transaction size (USD value)
    mx: o.maxUsd,          // max transaction size (USD value)
    pm: o.paymentMethods,  // string[]
    ct: o.contactType,     // 'tg' | 'ph'
    co: o.contact,         // handle or phone (public on-chain!)
    pk: o.posterPubkey,    // base58 — used to verify cancellations
    t: o.createdAt,        // seconds
  })
}

function encodeCancelMemo(currency, offerId, sigB64) {
  return JSON.stringify({ m: MARKER, k: 'x', c: currency, id: offerId, s: sigB64 })
}

/** Parse a raw RPC memo string ("[len] {...}") into our object, or null. */
function decodeMemo(raw) {
  if (!raw || typeof raw !== 'string') return null
  // RPC returns memos prefixed with "[<bytelen>] "
  const cleaned = raw.replace(/^\[\d+\]\s*/, '').trim()
  if (!cleaned.startsWith('{')) return null
  try {
    const obj = JSON.parse(cleaned)
    if (obj && obj.m === MARKER) return obj
  } catch {}
  return null
}

function memoIx(text, signer) {
  return new TransactionInstruction({
    keys: signer ? [{ pubkey: signer, isSigner: true, isWritable: false }] : [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(text, 'utf8'),
  })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useP2P(connection, publicKey) {
  const [offers, setOffers] = useState([])
  const [loading, setLoading] = useState(false)
  const [posting, setPosting] = useState(false)
  const inFlight = useRef(false)

  // Auto SOL replenishment (same wrapper used by Send / MAD contract flows).
  const { withAutoSOL } = useSwap(connection, sessionWallet)

  /** Associated token account of a currency's keyless P2P address. */
  const getCurrencyAta = useCallback(async (currency) => {
    const owner = new PublicKey(getP2PAddress(currency))
    return getAssociatedTokenAddress(TOKEN_MINT, owner, true) // allowOwnerOffCurve
  }, [])

  /**
   * Fetch recent offers for a currency.
   * Reads the latest `limit` memos on the currency address's token account,
   * drops anything that has a valid cancellation, and returns active offers.
   */
  const fetchOffers = useCallback(async (currency, limit = DEFAULT_FETCH_LIMIT) => {
    if (!connection || !currency) return []
    if (inFlight.current) return []
    inFlight.current = true
    setLoading(true)
    try {
      const ata = await getCurrencyAta(currency)

      // If the account doesn't exist yet there are simply no offers.
      const info = await connection.getAccountInfo(ata)
      if (!info) {
        setOffers([])
        return []
      }

      const sigs = await connection.getSignaturesForAddress(ata, { limit })

      const offerMap = new Map() // id -> offer
      const cancels = new Map()  // id -> sigB64

      for (const s of sigs) {
        if (s.err) continue
        const parsed = decodeMemo(s.memo)
        if (!parsed) continue

        if (parsed.k === 'o' && parsed.c === currency && parsed.id) {
          // Keep the first (newest) occurrence of an id
          if (!offerMap.has(parsed.id)) {
            offerMap.set(parsed.id, {
              id: parsed.id,
              nickname: parsed.n || '',
              currency: parsed.c,
              type: parsed.ty === 'buy' ? 'buy' : 'sell',
              pricePerUsd: Number(parsed.p) || 0,
              minUsd: Number(parsed.mn) || 0,
              maxUsd: Number(parsed.mx) || 0,
              paymentMethods: Array.isArray(parsed.pm) ? parsed.pm : [],
              contactType: parsed.ct === 'ph' ? 'ph' : (parsed.ct === 'wm' ? 'wm' : 'tg'),
              contact: parsed.co || '',
              posterPubkey: parsed.pk || '',
              createdAt: Number(parsed.t) || (s.blockTime || 0),
              signature: s.signature,
            })
          }
        } else if (parsed.k === 'x' && parsed.c === currency && parsed.id && parsed.s) {
          cancels.set(parsed.id, parsed.s)
        }
      }

      // Apply cancellations (only if the signature is valid for the offer's poster)
      const active = []
      for (const offer of offerMap.values()) {
        const cancelSig = cancels.get(offer.id)
        if (cancelSig && offer.posterPubkey &&
            verifyCancellation(currency, offer.id, cancelSig, offer.posterPubkey)) {
          continue // validly cancelled — hide it
        }
        active.push(offer)
      }

      // Collapse to one offer per poster (per side) within the visibility window.
      // Some users re-post an offer without cancelling the old one, so a list ends up
      // showing the same person several times. Keep only their most recent offer; the
      // ids of the older, now-hidden offers are remembered on the survivor as
      // `duplicateIds` so that cancelling it also cancels them — otherwise a hidden
      // older offer would reappear the moment the visible one is cancelled.
      const survivors = new Map() // `${posterPubkey}|${type}` -> kept offer
      for (const offer of active) {
        if (!offer.posterPubkey) continue // unattributable — never grouped (kept as-is below)
        const key = `${offer.posterPubkey}|${offer.type}`
        const current = survivors.get(key)
        if (!current) {
          offer.duplicateIds = []
          survivors.set(key, offer)
        } else if (offer.createdAt > current.createdAt) {
          // Newer offer wins; the previous survivor becomes one of its hidden duplicates.
          offer.duplicateIds = [...current.duplicateIds, current.id]
          survivors.set(key, offer)
        } else {
          // Older offer: hide it behind the current survivor.
          current.duplicateIds.push(offer.id)
        }
      }
      const deduped = active.filter(o =>
        !o.posterPubkey || survivors.get(`${o.posterPubkey}|${o.type}`) === o)

      setOffers(deduped)
      return deduped
    } catch (err) {
      console.error('P2P fetchOffers error:', err)
      return []
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [connection, getCurrencyAta])

  /**
   * Fetch a single offer directly by its on-chain transaction signature.
   * Used by offer deep links: reading the one transaction avoids the "recent memos
   * window" limit, so even an offer scrolled out of the normal listing can be opened.
   * Returns the offer object (same shape as fetchOffers) or null if it can't be found
   * (e.g. the transaction is older than the RPC's retention, or isn't a valid offer).
   * Note: cancellation status is intentionally NOT checked here.
   */
  const fetchOfferBySignature = useCallback(async (signature) => {
    if (!connection || !signature) return null
    try {
      const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 })
      if (!tx) return null

      // Find the memo. Prefer the parsed memo instruction; fall back to scanning logs.
      let memoRaw = null
      const ixs = tx.transaction?.message?.instructions || []
      for (const ix of ixs) {
        const isMemo = ix.program === 'spl-memo' ||
          (ix.programId && ix.programId.equals && ix.programId.equals(MEMO_PROGRAM_ID))
        if (isMemo && typeof ix.parsed === 'string') { memoRaw = ix.parsed; break }
      }
      if (!memoRaw) {
        // Our offer memo is flat JSON (no nested braces), so this matches the whole object.
        const joined = (tx.meta?.logMessages || []).join('\n')
        const m = joined.match(/\{[^{}]*"m":"h1p2p"[^{}]*\}/)
        if (m) memoRaw = m[0]
      }
      if (!memoRaw) return null

      const parsed = decodeMemo(memoRaw)
      if (!parsed || parsed.k !== 'o' || !parsed.id) return null

      return {
        id: parsed.id,
        nickname: parsed.n || '',
        currency: parsed.c,
        type: parsed.ty === 'buy' ? 'buy' : 'sell',
        pricePerUsd: Number(parsed.p) || 0,
        minUsd: Number(parsed.mn) || 0,
        maxUsd: Number(parsed.mx) || 0,
        paymentMethods: Array.isArray(parsed.pm) ? parsed.pm : [],
        contactType: parsed.ct === 'ph' ? 'ph' : (parsed.ct === 'wm' ? 'wm' : 'tg'),
        contact: parsed.co || '',
        posterPubkey: parsed.pk || '',
        createdAt: Number(parsed.t) || (tx.blockTime || 0),
        signature,
      }
    } catch (err) {
      console.error('P2P fetchOfferBySignature error:', err)
      return null
    }
  }, [connection])

  /**
   * Publish a new offer. Builds a transaction that:
   *  1. creates the currency's token account if this is the first offer EVER (payer = user)
   *  2. transfers the POST fee (h173k) to that account (trapped/burned)
   *  3. attaches the offer memo
   */
  const postOffer = useCallback(async ({
    nickname, currency, type, pricePerUsd, minUsd, maxUsd,
    paymentMethods, contactType, contact,
  }, onSwap) => {
    if (!connection || !publicKey) throw new Error('Wallet not connected')
    setPosting(true)
    try {
      const ownerPk = new PublicKey(getP2PAddress(currency))
      const currencyAta = await getAssociatedTokenAddress(TOKEN_MINT, ownerPk, true)
      const userAta = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)

      // Pre-check whether the currency account exists so auto-replenish can size
      // the SOL target to also cover the one-time ATA rent (first offer EVER).
      let needsAta = false
      try { await getAccount(connection, currencyAta) } catch { needsAta = true }
      const extraSOLNeeded = needsAta ? TOKEN_ATA_RENT_SOL : 0

      // Build the offer once (stable id across retries) and validate memo size.
      const offer = {
        id: generateOfferId(),
        nickname: String(nickname || '').slice(0, 32),
        currency,
        type,
        pricePerUsd,
        minUsd,
        maxUsd,
        paymentMethods: sanitizePaymentMethods(paymentMethods),
        contactType,
        contact,
        posterPubkey: publicKey.toString(),
        createdAt: Math.floor(Date.now() / 1000),
      }
      const memoText = encodeOfferMemo(offer)
      const memoBytes = new TextEncoder().encode(memoText).length
      if (memoBytes > MAX_MEMO_BYTES) {
        throw new Error(`Offer is too large (${memoBytes}/${MAX_MEMO_BYTES} bytes). Shorten your payment methods, nickname or contact.`)
      }

      // Run inside the auto-SOL wrapper: replenishes SOL (h173k→SOL swap) when low,
      // then builds + sends + confirms; retries with more SOL on failure.
      return await withAutoSOL(async () => {
        const tx = new Transaction()

        // Re-check the ATA inside each attempt (state may change between retries).
        let createdAccount = false
        try { await getAccount(connection, currencyAta) }
        catch {
          createdAccount = true
          tx.add(createAssociatedTokenAccountInstruction(publicKey, currencyAta, ownerPk, TOKEN_MINT))
        }

        tx.add(createTransferInstruction(userAta, currencyAta, publicKey, POST_FEE_RAW))
        tx.add(memoIx(memoText, publicKey))

        const { blockhash } = await connection.getLatestBlockhash()
        tx.recentBlockhash = blockhash
        tx.feePayer = publicKey

        const signed = sessionWallet.signTransaction(tx)
        const sig = await connection.sendRawTransaction(signed.serialize())
        await connection.confirmTransaction(sig, 'confirmed')
        return { signature: sig, offer, createdAccount }
      }, onSwap, extraSOLNeeded)
    } finally {
      setPosting(false)
    }
  }, [connection, publicKey, withAutoSOL])

  /**
   * Cancel one of your own offers. Publishes a signed cancel memo (burns a tiny fee).
   */
  const cancelOffer = useCallback(async (offer, onSwap) => {
    if (!connection || !publicKey) throw new Error('Wallet not connected')
    if (offer.posterPubkey !== publicKey.toString()) {
      throw new Error('You can only cancel your own offers')
    }
    setPosting(true)
    try {
      const ownerPk = new PublicKey(getP2PAddress(offer.currency))
      const currencyAta = await getAssociatedTokenAddress(TOKEN_MINT, ownerPk, true)
      const userAta = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)

      // Cancel this offer *and* any older offers by the same poster that the app was
      // hiding behind it (offer.duplicateIds, populated by fetchOffers). Without this,
      // cancelling the visible offer would let a hidden older one reappear on refresh.
      const ids = [offer.id]
      for (const id of (offer.duplicateIds || [])) {
        if (id && !ids.includes(id)) ids.push(id)
      }

      // One cancel memo per transaction — same shape as a plain single cancel.
      // (The RPC concatenates multiple memos from one tx into a single string that
      // decodeMemo can't JSON-parse, so batching memos would make the cancellations
      // unreadable by both this and older clients. Keeping one memo per tx stays fully
      // compatible with the existing on-chain format.)
      let firstSig = null
      for (const id of ids) {
        const memoText = encodeCancelMemo(offer.currency, id, signCancellation(offer.currency, id))

        // Auto-replenish SOL (cancel only needs the network fee, no extra rent).
        const sig = await withAutoSOL(async () => {
          const tx = new Transaction()
          tx.add(createTransferInstruction(userAta, currencyAta, publicKey, CANCEL_FEE_RAW))
          tx.add(memoIx(memoText, publicKey))

          const { blockhash } = await connection.getLatestBlockhash()
          tx.recentBlockhash = blockhash
          tx.feePayer = publicKey

          const signed = sessionWallet.signTransaction(tx)
          const s = await connection.sendRawTransaction(signed.serialize())
          await connection.confirmTransaction(s, 'confirmed')
          return s
        }, onSwap, 0)
        if (!firstSig) firstSig = sig
      }
      return { signature: firstSig }
    } finally {
      setPosting(false)
    }
  }, [connection, publicKey, withAutoSOL])

  return { offers, loading, posting, fetchOffers, fetchOfferBySignature, postOffer, cancelOffer, getCurrencyAta }
}

// ---------------------------------------------------------------------------
// Pricing & gating helpers (pure functions used by the UI)
// ---------------------------------------------------------------------------

/**
 * Given an offer and the live h173k USD price, compute display amounts.
 * - usdValue: USD value of h173k being traded (the offer "size")
 * - h173kAmount: how much h173k that is at the current pool price
 * - fiatAmount: how much the counterparty pays/receives in the offer currency
 */
export function computeTrade(offer, usdValue, h173kUsdPrice) {
  const fiatAmount = usdValue * offer.pricePerUsd
  const h173kAmount = (h173kUsdPrice && h173kUsdPrice > 0) ? usdValue / h173kUsdPrice : null
  return { usdValue, fiatAmount, h173kAmount }
}

/**
 * How much h173k the *viewer* must hold to be able to enter the MAD contract for
 * this offer at its minimum size.
 *
 * Standard P2P convention:
 *  - SELL offer  → poster sells h173k; the viewer BUYS h173k (pays fiat, receives
 *                  h173k) → only 1x collateral needed.
 *  - BUY offer   → poster buys h173k; the viewer SELLS h173k (pays in h173k) →
 *                  2x needed (matches the MAD buyerDeposit = 2x amount model).
 */
export function requiredH173KToTake(offer, h173kUsdPrice) {
  if (!h173kUsdPrice || h173kUsdPrice <= 0) return null
  const minH173k = offer.minUsd / h173kUsdPrice
  const multiplier = offer.type === 'buy' ? 2 : 1
  return minH173k * multiplier
}

/** Whether the viewer pays in h173k (true) or receives h173k (false) when taking. */
export function viewerPaysInH173K(offer) {
  return offer.type === 'buy'
}

/**
 * How much h173k the *creator* must hold to back this offer at its minimum size.
 * The creator is the opposite side of the taker:
 *  - SELL offer → creator sells h173k (pays in h173k) → 2x the min size.
 *  - BUY offer  → creator buys h173k (receives h173k) → 1x the min size.
 */
export function requiredH173KToPost(type, minUsd, h173kUsdPrice) {
  if (!h173kUsdPrice || h173kUsdPrice <= 0 || !(minUsd > 0)) return null
  const minH173k = minUsd / h173kUsdPrice
  const multiplier = type === 'sell' ? 2 : 1
  return minH173k * multiplier
}

/** Build a contact link: a phone call for numbers, a Telegram link for handles. */
export function contactLink(contactType, contact) {
  const v = (contact || '').trim()
  // 'wm' (in-wallet messenger) is handled inside the app, not via an external link.
  if (contactType === 'wm') return null
  if (!v) return null
  if (contactType === 'ph') {
    const digits = v.replace(/[^\d+]/g, '')
    return `tel:${digits}`
  }
  const handle = v.replace(/^@/, '')
  return `https://t.me/${handle}`
}
