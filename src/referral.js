/**
 * Referral System for H173K Wallet
 * 
 * - Stores referrer address when wallet is created or imported with referral link
 * - Calculates referral bonus amount based on current h173k price
 * - Provides utilities for generating referral links
 */

import { PublicKey } from '@solana/web3.js'

const REFERRAL_STORAGE_KEY = 'h173k_referral'
const LAST_PRICE_STORAGE_KEY = 'h173k_last_known_price'

// Referral bonus in USD
const REFERRAL_BONUS_USD = 0.01

/**
 * Get current app URL dynamically
 * @returns {string} Current origin URL
 */
function getAppURL() {
  return window.location.origin
}

/**
 * Get referral parameter from URL
 * @returns {string|null} Referrer address or null
 */
export function getReferralFromURL() {
  try {
    const urlParams = new URLSearchParams(window.location.search)
    const ref = urlParams.get('ref')
    
    if (ref) {
      // Validate that it's a valid Solana address
      try {
        new PublicKey(ref)
        return ref
      } catch {
        console.warn('Invalid referral address in URL:', ref)
        return null
      }
    }
  } catch (err) {
    console.error('Error parsing referral from URL:', err)
  }
  return null
}

/**
 * Store referrer address for wallet
 * Called when creating or importing a wallet with a referral link
 * @param {string} referrerAddress - The referrer's Solana address
 */
export function storeReferrer(referrerAddress) {
  try {
    if (!referrerAddress) return false
    
    // Validate address
    new PublicKey(referrerAddress)
    
    const data = {
      referrer: referrerAddress,
      timestamp: Date.now(),
      storedAt: new Date().toISOString()
    }
    
    localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(data))
    console.log('Referrer stored:', referrerAddress)
    return true
  } catch (err) {
    console.error('Error storing referrer:', err)
    return false
  }
}

/**
 * Get stored referrer address
 * @returns {string|null} Referrer address or null
 */
export function getReferrer() {
  try {
    const stored = localStorage.getItem(REFERRAL_STORAGE_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      return data.referrer || null
    }
  } catch (err) {
    console.error('Error getting referrer:', err)
  }
  return null
}

/**
 * Check if wallet has a referrer
 * @returns {boolean}
 */
export function hasReferrer() {
  return getReferrer() !== null
}

/**
 * Clear referrer data (e.g., when wallet is deleted)
 */
export function clearReferrer() {
  try {
    localStorage.removeItem(REFERRAL_STORAGE_KEY)
  } catch (err) {
    console.error('Error clearing referrer:', err)
  }
}

/**
 * Store last known price for fallback
 * @param {number} price - Price in USD
 */
export function storeLastKnownPrice(price) {
  try {
    if (price && !isNaN(price) && price > 0) {
      localStorage.setItem(LAST_PRICE_STORAGE_KEY, JSON.stringify({
        price,
        timestamp: Date.now()
      }))
    }
  } catch (err) {
    console.error('Error storing last known price:', err)
  }
}

/**
 * Get last known price as fallback
 * @returns {number|null}
 */
export function getLastKnownPrice() {
  try {
    const stored = localStorage.getItem(LAST_PRICE_STORAGE_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      return data.price || null
    }
  } catch (err) {
    console.error('Error getting last known price:', err)
  }
  return null
}

/**
 * Calculate referral bonus amount in h173k tokens
 * @param {number|null} currentPrice - Current h173k price in USD
 * @returns {number|null} Amount of h173k tokens for referral bonus, or null if no price available
 */
export function calculateReferralBonus(currentPrice) {
  // Use current price or fall back to last known price
  const price = currentPrice || getLastKnownPrice()
  
  if (!price || price <= 0) {
    console.warn('No price available for referral bonus calculation')
    return null
  }
  
  // $0.0025 / price per token = number of tokens
  const bonusTokens = REFERRAL_BONUS_USD / price
  
  return bonusTokens
}

/**
 * Get referral bonus in lamports (token smallest unit)
 * @param {number|null} currentPrice - Current h173k price in USD
 * @param {number} decimals - Token decimals (default 9)
 * @returns {number|null} Amount in lamports (smallest unit)
 */
export function calculateReferralBonusLamports(currentPrice, decimals = 9) {
  const bonusTokens = calculateReferralBonus(currentPrice)
  
  if (bonusTokens === null) return null
  
  return Math.floor(bonusTokens * Math.pow(10, decimals))
}

/**
 * Generate referral link for a wallet address
 * @param {string} walletAddress - The user's wallet address
 * @returns {string} Full referral URL
 */
export function generateReferralLink(walletAddress) {
  return `${getAppURL()}?ref=${walletAddress}`
}

/**
 * Get referral bonus info for display
 * @param {number|null} currentPrice - Current h173k price
 * @returns {object} Info about the referral bonus
 */
export function getReferralBonusInfo(currentPrice) {
  const bonusTokens = calculateReferralBonus(currentPrice)
  const usedPrice = currentPrice || getLastKnownPrice()
  
  return {
    usdAmount: REFERRAL_BONUS_USD,
    tokenAmount: bonusTokens,
    priceUsed: usedPrice,
    isUsingFallbackPrice: !currentPrice && usedPrice !== null
  }
}
