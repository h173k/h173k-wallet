/**
 * P2P offer deep links.
 *
 * A shareable link points at a single P2P offer. We use a HYBRID identifier:
 *   - `offer` = the offer's on-chain transaction signature (authoritative; read directly)
 *   - `cur`   = the offer's currency code (a hint, so the marketplace can switch the
 *               currency tab immediately without waiting for the transaction to load)
 *
 * Opening a link launches the app, switches P2P to the right currency and pops the
 * offer card (see App.jsx + P2PMarketplace). The currency hint also lets us tell an
 * iOS user which currency's offers to look in, since link-opening is disabled there.
 */

import { getCurrency } from './currencies'

export const OFFER_LINK_PARAM = 'offer'   // transaction signature
export const CURRENCY_HINT_PARAM = 'cur'  // ISO/crypto currency code

// Base58 alphabet, length range of a 64-byte Solana signature (~87–88 chars).
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{32,100}$/

/** Read an offer deep link from the current URL, or null if there isn't a valid one. */
export function getOfferLinkFromURL() {
  try {
    const params = new URLSearchParams(window.location.search)
    const signature = params.get(OFFER_LINK_PARAM)
    if (!signature || !SIGNATURE_RE.test(signature)) return null
    const currencyRaw = params.get(CURRENCY_HINT_PARAM)
    // The currency is only a hint; keep it only if it's a code we actually support.
    const currency = currencyRaw && getCurrency(currencyRaw) ? currencyRaw : null
    return { signature, currency }
  } catch {
    return null
  }
}

/** Build a shareable link for an offer. */
export function generateOfferLink(signature, currency) {
  const base = window.location.origin
  const parts = [`${OFFER_LINK_PARAM}=${encodeURIComponent(signature)}`]
  if (currency) parts.push(`${CURRENCY_HINT_PARAM}=${encodeURIComponent(currency)}`)
  return `${base}/?${parts.join('&')}`
}

/** Strip the deep-link params from the address bar so a refresh won't re-trigger it. */
export function clearOfferLinkFromURL() {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete(OFFER_LINK_PARAM)
    url.searchParams.delete(CURRENCY_HINT_PARAM)
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash)
  } catch {}
}

/**
 * Detect iOS, including iPadOS running in desktop mode.
 * iPadOS 13+ Safari reports itself as a Mac, so the plain user-agent test misses it;
 * a Mac user-agent combined with touch points is the reliable tell for an iPad.
 */
export function isIOS() {
  try {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent || navigator.vendor || ''
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return true
    const touch = navigator.maxTouchPoints || 0
    if (navigator.platform === 'MacIntel' && touch > 1) return true
    if (/Macintosh/.test(ua) && touch > 1) return true
    return false
  } catch {
    return false
  }
}
