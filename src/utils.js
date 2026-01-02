/**
 * H173K Wallet - Utility Functions
 */

import { PublicKey } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import { sha256 } from '@noble/hashes/sha256'
import { TOKEN_DECIMALS, PROGRAM_ID, OfferStatus } from './constants'

/**
 * Format number with commas
 */
export function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return '0'
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format number with smart precision - shows more decimals for small values
 * Ensures small values are never displayed as "0"
 */
export function formatSmartNumber(num, minDecimals = 2, maxDecimals = 8) {
  if (num === null || num === undefined || isNaN(num)) return '0'
  if (num === 0) return '0'
  
  const absNum = Math.abs(num)
  
  // Determine appropriate decimal places based on value size
  let decimals = minDecimals
  if (absNum < 0.01) {
    decimals = Math.max(minDecimals, 6)
  } else if (absNum < 0.1) {
    decimals = Math.max(minDecimals, 4)
  } else if (absNum < 1) {
    decimals = Math.max(minDecimals, 3)
  }
  
  // Cap at maxDecimals
  decimals = Math.min(decimals, maxDecimals)
  
  // Format and remove trailing zeros (but keep at least minDecimals)
  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
  
  // If result would be "0" but num is not 0, show more precision
  if (formatted === '0' && num !== 0) {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDecimals,
    })
  }
  
  return formatted
}

/**
 * Format USD amount
 */
export function formatUSD(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Format date and time for display
 */
export function formatDateTime(date) {
  if (!date) return ''
  
  const d = new Date(date)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  
  const time = d.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  })
  
  if (isToday) {
    return `Today, ${time}`
  } else if (isYesterday) {
    return `Yesterday, ${time}`
  } else {
    const dateStr = d.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    })
    return `${dateStr}, ${time}`
  }
}

/**
 * Shorten address for display
 */
export function shortenAddress(address, chars = 4) {
  if (!address) return ''
  const str = address.toString()
  return `${str.slice(0, chars)}...${str.slice(-chars)}`
}

/**
 * Convert amount from lamports to human readable
 */
export function fromTokenAmount(amount) {
  if (!amount) return 0
  const num = typeof amount === 'object' && amount.toNumber ? amount.toNumber() : Number(amount)
  return num / Math.pow(10, TOKEN_DECIMALS)
}

/**
 * Convert amount from human readable to lamports
 */
export function toTokenAmount(amount) {
  return new BN(Math.floor(amount * Math.pow(10, TOKEN_DECIMALS)))
}

/**
 * Sleep helper
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      document.body.removeChild(textarea)
      return true
    } catch (e) {
      document.body.removeChild(textarea)
      return false
    }
  }
}

/**
 * Validate Solana address
 */
export function isValidSolanaAddress(address) {
  try {
    if (!address || typeof address !== 'string') return false
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
    return base58Regex.test(address)
  } catch {
    return false
  }
}

// ========== ESCROW UTILITY FUNCTIONS ==========

/**
 * Derives the buyer index PDA
 */
export function getBuyerIndexPDA(buyerPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('buyer_index'), buyerPubkey.toBuffer()],
    PROGRAM_ID
  )
}

/**
 * Derives the seller index PDA
 */
export function getSellerIndexPDA(sellerPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('seller_index'), sellerPubkey.toBuffer()],
    PROGRAM_ID
  )
}

/**
 * Derives the offer PDA
 */
export function getOfferPDA(buyerPubkey, nonce) {
  const nonceBuffer = Buffer.alloc(8)
  nonceBuffer.writeBigUInt64LE(BigInt(nonce))
  return PublicKey.findProgramAddressSync(
    [Buffer.from('offer'), buyerPubkey.toBuffer(), nonceBuffer],
    PROGRAM_ID
  )
}

/**
 * Derives the escrow vault authority PDA
 */
export function getEscrowVaultAuthorityPDA(offerPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), offerPubkey.toBuffer()],
    PROGRAM_ID
  )
}

/**
 * Generate a random code for a new offer
 */
export function generateCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length]
  }
  return result
}

/**
 * Hash code with offer key for verification
 */
export function hashCode(code, offerPubkey) {
  const trimmed = code.trim()
  const encoder = new TextEncoder()
  const offerBytes = offerPubkey.toBuffer()
  const codeBytes = encoder.encode(trimmed)
  const combined = new Uint8Array(offerBytes.length + codeBytes.length)
  combined.set(offerBytes, 0)
  combined.set(codeBytes, offerBytes.length)
  return sha256(combined)
}

/**
 * Synchronous hash using simple approach for UI
 */
export function hashCodeSync(code, offerPubkey) {
  // Simple hash for verification - actual verification happens on-chain
  const trimmed = code.trim()
  const combined = offerPubkey.toString() + trimmed
  let hash = 0
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash
}

/**
 * Get status display info with context
 */
export function getStatusInfo(status, offer = null, userPubkey = null) {
  let statusValue = parseOfferStatus(status)
  
  if (offer && userPubkey) {
    const buyerStr = offer.buyer?.toString ? offer.buyer.toString() : offer.buyer
    const sellerStr = offer.seller?.toString ? offer.seller.toString() : offer.seller
    const userStr = userPubkey?.toString ? userPubkey.toString() : userPubkey
    
    const isBuyer = buyerStr === userStr
    const isSeller = sellerStr && sellerStr !== '11111111111111111111111111111111' && sellerStr === userStr
    
    if (statusValue === OfferStatus.BuyerConfirmed && isSeller) {
      return { label: 'Confirm Release', class: 'pending-release' }
    }
    if (statusValue === OfferStatus.BuyerConfirmed && isBuyer) {
      return { label: 'Awaiting Release', class: 'pending-release' }
    }
    if (statusValue === OfferStatus.SellerConfirmed && isBuyer) {
      return { label: 'Confirm Release', class: 'pending-release' }
    }
    if (statusValue === OfferStatus.SellerConfirmed && isSeller) {
      return { label: 'Awaiting Release', class: 'pending-release' }
    }
  }
  
  const statusMap = {
    [OfferStatus.PendingSeller]: { label: 'Pending', class: 'pending' },
    [OfferStatus.Locked]: { label: 'Ongoing', class: 'ongoing' },
    [OfferStatus.BuyerConfirmed]: { label: 'Pending Release', class: 'pending-release' },
    [OfferStatus.SellerConfirmed]: { label: 'Pending Release', class: 'pending-release' },
    [OfferStatus.Completed]: { label: 'Released', class: 'released' },
    [OfferStatus.Burned]: { label: 'Burned', class: 'burned' },
    [OfferStatus.Cancelled]: { label: 'Cancelled', class: 'cancelled' },
  }
  
  return statusMap[statusValue] || { label: 'Unknown', class: 'pending' }
}

/**
 * Parse offer status from Anchor format
 */
export function parseOfferStatus(status) {
  if (typeof status === 'number') return status
  if (typeof status === 'object') {
    if ('pendingSeller' in status) return OfferStatus.PendingSeller
    if ('locked' in status) return OfferStatus.Locked
    if ('buyerConfirmed' in status) return OfferStatus.BuyerConfirmed
    if ('sellerConfirmed' in status) return OfferStatus.SellerConfirmed
    if ('completed' in status) return OfferStatus.Completed
    if ('burned' in status) return OfferStatus.Burned
    if ('cancelled' in status) return OfferStatus.Cancelled
  }
  return OfferStatus.PendingSeller
}

/**
 * Check if offer can be cancelled
 */
export function canCancelOffer(offer, userPubkey) {
  const status = parseOfferStatus(offer.status)
  const buyerStr = offer.buyer?.toString ? offer.buyer.toString() : offer.buyer
  const userStr = userPubkey?.toString ? userPubkey.toString() : userPubkey
  return status === OfferStatus.PendingSeller && buyerStr === userStr
}

/**
 * Check if offer can be released
 */
export function canReleaseOffer(offer, userPubkey) {
  const status = parseOfferStatus(offer.status)
  const buyerStr = offer.buyer?.toString ? offer.buyer.toString() : offer.buyer
  const sellerStr = offer.seller?.toString ? offer.seller.toString() : offer.seller
  const userStr = userPubkey?.toString ? userPubkey.toString() : userPubkey
  
  return (status === OfferStatus.Locked || 
          status === OfferStatus.BuyerConfirmed || 
          status === OfferStatus.SellerConfirmed) &&
    (buyerStr === userStr || sellerStr === userStr)
}

/**
 * Check if offer can be burned
 */
export function canBurnOffer(offer, userPubkey) {
  return canReleaseOffer(offer, userPubkey)
}

/**
 * Check if status is terminal
 */
export function isTerminalStatus(status) {
  const statusValue = parseOfferStatus(status)
  return statusValue === OfferStatus.Completed || 
         statusValue === OfferStatus.Burned || 
         statusValue === OfferStatus.Cancelled
}
