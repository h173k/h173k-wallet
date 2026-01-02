import { PublicKey } from '@solana/web3.js'

// ========== MAINNET CONFIGURATION ==========
export const NETWORK = 'mainnet-beta'
export const DEFAULT_RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=8ca1ae57-4ed8-4896-a299-bfe3e0a4a886'

// RPC Settings localStorage key
export const RPC_SETTINGS_KEY = 'h173k_rpc_settings'

// Get RPC endpoint from settings or use default
export function getRpcEndpoint() {
  try {
    const stored = localStorage.getItem(RPC_SETTINGS_KEY)
    if (stored) {
      const settings = JSON.parse(stored)
      if (settings.rpcUrl && settings.rpcUrl.trim()) {
        return settings.rpcUrl.trim()
      }
    }
  } catch (err) {
    console.error('Error reading RPC settings:', err)
  }
  return DEFAULT_RPC_ENDPOINT
}

// Save RPC endpoint to localStorage
export function saveRpcEndpoint(rpcUrl) {
  try {
    localStorage.setItem(RPC_SETTINGS_KEY, JSON.stringify({ rpcUrl }))
    return true
  } catch (err) {
    console.error('Error saving RPC settings:', err)
    return false
  }
}

// Check if RPC is configured
export function isRpcConfigured() {
  try {
    const stored = localStorage.getItem(RPC_SETTINGS_KEY)
    if (stored) {
      const settings = JSON.parse(stored)
      return !!(settings.rpcUrl && settings.rpcUrl.trim())
    }
  } catch (err) {
    console.error('Error checking RPC settings:', err)
  }
  return false
}

// Validate RPC endpoint (basic check)
export async function validateRpcEndpoint(rpcUrl) {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getHealth'
      })
    })
    const data = await response.json()
    return data.result === 'ok' || !data.error
  } catch (err) {
    return false
  }
}

// ========== PROGRAM ID ==========
export const PROGRAM_ID = new PublicKey('pLEzeCQ8t7oz2YGzZmqz4a1mXNhhE3mJC89GSveijrG')

// ========== TOKEN MINT - MAINNET ==========
export const TOKEN_MINT = new PublicKey('173AvoJNQoWsaR1wdYTMNLUqZc1b7d4SzB2ZZRZVyz3')

// Token decimals
export const TOKEN_DECIMALS = 9

// Price update interval (30 seconds)
export const PRICE_UPDATE_INTERVAL = 30000

// Minimum SOL for transactions
export const MIN_SOL_BALANCE = 0.01

// Offer status enum
export const OfferStatus = {
  PendingSeller: 0,
  Locked: 1,
  BuyerConfirmed: 2,
  SellerConfirmed: 3,
  Completed: 4,
  Burned: 5,
  Cancelled: 6,
}
