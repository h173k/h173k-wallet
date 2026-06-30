import { PublicKey } from '@solana/web3.js'

// ========== MAINNET CONFIGURATION ==========
export const NETWORK = 'mainnet-beta'
// No default RPC: the user must configure their own endpoint before the app proceeds.
export const DEFAULT_RPC_ENDPOINT = ''

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

// ========== REPLENISH SOL SETTINGS ==========
const REPLENISH_SETTINGS_KEY = 'h173k_replenish_settings'

// Rent-exempt deposit for a WSOL token account (2039280 lamports)
export const WSOL_ATA_RENT = 0.00204

// Minimum allowed swap priority fee
export const MIN_SWAP_PRIORITY_FEE = 0.0001

// Minimum allowed "Trigger replenish below" value: 2 × WSOL_ATA_RENT
export const MIN_TRIGGER_THRESHOLD = 2 * WSOL_ATA_RENT   // 0.00408

// Minimum allowed "Replenish up to" value: 3 × WSOL_ATA_RENT
export const MIN_REPLENISH_TO = 3 * WSOL_ATA_RENT        // 0.00612

export const DEFAULT_REPLENISH_SETTINGS = {
  replenishTo: MIN_REPLENISH_TO,    // manual top-up target (used by the manual "Replenish"/"Swap for SOL" buttons)
  swapFeeSol: MIN_SWAP_PRIORITY_FEE, // priority fee in SOL added to swap transactions
}

export function getReplenishSettings() {
  try {
    const stored = localStorage.getItem(REPLENISH_SETTINGS_KEY)
    if (!stored) return { ...DEFAULT_REPLENISH_SETTINGS }
    return { ...DEFAULT_REPLENISH_SETTINGS, ...JSON.parse(stored) }
  } catch {
    return { ...DEFAULT_REPLENISH_SETTINGS }
  }
}

export function saveReplenishSettings(settings) {
  try {
    localStorage.setItem(REPLENISH_SETTINGS_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}


// ========== ACCOUNT SPONSORING SETTING ==========
const SPONSOR_KEY = 'h173k_sponsor_accounts'

export function getSponsorAccounts() {
  try { const val = localStorage.getItem(SPONSOR_KEY); return val === null ? false : val === 'true' } catch { return false }
}

export function saveSponsorAccounts(value) {
  try { localStorage.setItem(SPONSOR_KEY, value ? 'true' : 'false') } catch {}
}

// ========== AUTO-LOCK TIMEOUT SETTING ==========
const AUTO_LOCK_KEY = 'h173k_auto_lock_seconds'
export const DEFAULT_AUTO_LOCK_SECONDS = 300
export const AUTO_LOCK_OPTIONS = [60, 300, 900, 1800, 3600] // 1, 5, 15, 30, 60 min

export function getAutoLockSeconds() {
  try {
    const v = parseInt(localStorage.getItem(AUTO_LOCK_KEY), 10)
    if (v >= 30 && v <= 86400) return v
  } catch {}
  return DEFAULT_AUTO_LOCK_SECONDS
}

export function saveAutoLockSeconds(seconds) {
  try { localStorage.setItem(AUTO_LOCK_KEY, String(seconds)) } catch {}
}
// ========== H173K DISPLAY DECIMAL SETTINGS ==========
const H173K_DECIMALS_KEY = 'h173k_display_decimals'
export const DEFAULT_H173K_DECIMALS = 6

export function getH173KDecimals() {
  try {
    const stored = localStorage.getItem(H173K_DECIMALS_KEY)
    if (stored !== null) {
      const val = parseInt(stored, 10)
      if (!isNaN(val) && val >= 0 && val <= 9) return val
    }
  } catch {}
  return DEFAULT_H173K_DECIMALS
}

export function saveH173KDecimals(decimals) {
  try {
    localStorage.setItem(H173K_DECIMALS_KEY, String(decimals))
    return true
  } catch {
    return false
  }
}

// ========== RECEIVE WARNING ACK ==========
// Tracks whether the user has acknowledged that this wallet accepts ONLY h173k and SOL.
// Once acknowledged, the warning modal on the Receive screen no longer appears.
const RECEIVE_WARN_KEY = 'h173k_receive_warn_ack'
export function getReceiveWarnAck() {
  try { return localStorage.getItem(RECEIVE_WARN_KEY) === 'true' } catch { return false }
}
export function saveReceiveWarnAck(value) {
  try { localStorage.setItem(RECEIVE_WARN_KEY, value ? 'true' : 'false') } catch {}
}

// ========== LOTTERY (Win h173k) ==========
//
// ⚠️  PRZED UŻYCIEM: wklej tu adres wdrożonego programu loterii (declare_id! z lib.rs).
//     Dopóki pole jest puste, ekran loterii działa w trybie „podglądu" —
//     pokazuje pełny interfejs, ale spin zwraca komunikat „loteria niewdrożona".
//     Dzięki temu reszta portfela jest całkowicie bezpieczna.
export const LOTTERY_PROGRAM_ID_STR = 'Go148cND1CrZC7hYShNsLEYHUHwnZEJRgqtVaNMGTVRy'

export function getLotteryProgramId() {
  try {
    if (LOTTERY_PROGRAM_ID_STR && LOTTERY_PROGRAM_ID_STR.trim()) {
      return new PublicKey(LOTTERY_PROGRAM_ID_STR.trim())
    }
  } catch {
    /* nieprawidłowy adres → traktuj jako niewdrożone */
  }
  return null
}

export function isLotteryConfigured() {
  return getLotteryProgramId() !== null
}

// Tryby loterii. Skala raw = wartość × 10^TOKEN_DECIMALS.
// Mapowanie zgodne z lib.rs:
//   mode 1 → 1:10   (fee 0.2),   mode 2 → 1:100 (fee 0.02),  mode 3 → 1:1000 (fee 0.002)
// Kolejność swipe w UI: [Ultra High] ← [Very High] → [High]
export const LOTTERY_MODES = [
  { mode: 1, key: 'ultra', oneIn: 10,   feeH173k: 0.2 },
  { mode: 2, key: 'very',  oneIn: 100,  feeH173k: 0.02 },
  { mode: 3, key: 'high',  oneIn: 1000, feeH173k: 0.002 },
]

// Indeks domyślnego trybu w LOTTERY_MODES → „Very High" (1:100), środkowy.
export const LOTTERY_DEFAULT_MODE_INDEX = 1

// Maksymalna nagroda (MAX_PRIZE w lib.rs): 1 h173k. Realna wygrana = min(vault/2, 1 h173k).
export const LOTTERY_MAX_PRIZE_H173K = 1

// Stała przewaga domu (token-sink, lib.rs: „przewaga domu = 50 % zawsze").
export const LOTTERY_HOUSE_EDGE = 0.5

// Limit odczytów RPC przy wyszukiwaniu ostatniego zwycięzcy (nie szukaj zbyt agresywnie).
export const LOTTERY_LAST_WINNER_READ_BUDGET = 100

// „Nie pokazuj mi tego więcej" dla potwierdzenia kosztu spinu.
const LOTTERY_SKIP_COST_KEY = 'h173k_lottery_skip_cost_confirm'
export function getLotterySkipCostConfirm() {
  try { return localStorage.getItem(LOTTERY_SKIP_COST_KEY) === 'true' } catch { return false }
}
export function saveLotterySkipCostConfirm(value) {
  try { localStorage.setItem(LOTTERY_SKIP_COST_KEY, value ? 'true' : 'false') } catch {}
}

// Czy gracz potwierdził prompt powitalny (zrozumienie zasady token-sink) w tej przeglądarce.
const LOTTERY_INTRO_KEY = 'h173k_lottery_intro_ack'
export function getLotteryIntroAck() {
  try { return localStorage.getItem(LOTTERY_INTRO_KEY) === 'true' } catch { return false }
}
export function saveLotteryIntroAck(value) {
  try { localStorage.setItem(LOTTERY_INTRO_KEY, value ? 'true' : 'false') } catch {}
}

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
