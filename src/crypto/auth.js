/**
 * H173K Wallet - Authentication Module
 * Supports PIN code and biometric authentication
 */

import CryptoJS from 'crypto-js'

const PIN_HASH_KEY = 'h173k_pin_hash'
const BIOMETRIC_KEY = 'h173k_biometric_credential'
const AUTH_METHOD_KEY = 'h173k_auth_method'
const FAILED_ATTEMPTS_KEY = 'h173k_failed_attempts'
const LOCKOUT_UNTIL_KEY = 'h173k_lockout_until'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Check if WebAuthn (biometric) is available
 */
export function isBiometricAvailable() {
  return !!(window.PublicKeyCredential && 
            window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable)
}

/**
 * Check if device supports biometric authentication
 */
export async function checkBiometricSupport() {
  if (!isBiometricAvailable()) return false
  
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/**
 * Hash PIN for storage
 */
function hashPIN(pin) {
  return CryptoJS.SHA256(pin + '_h173k_pin_salt_v1').toString()
}

/**
 * Set up PIN authentication
 * New PINs must be exactly 6 digits
 */
export function setupPIN(pin) {
  if (pin.length !== 6) {
    throw new Error('PIN must be exactly 6 digits')
  }
  if (!/^\d+$/.test(pin)) {
    throw new Error('PIN must contain only digits')
  }
  
  const hashedPIN = hashPIN(pin)
  localStorage.setItem(PIN_HASH_KEY, hashedPIN)
  localStorage.setItem(AUTH_METHOD_KEY, 'pin')
  
  // Reset failed attempts
  localStorage.removeItem(FAILED_ATTEMPTS_KEY)
  localStorage.removeItem(LOCKOUT_UNTIL_KEY)
  
  return true
}

/**
 * Check if locked out due to failed attempts
 */
export function isLockedOut() {
  const lockoutUntil = localStorage.getItem(LOCKOUT_UNTIL_KEY)
  if (!lockoutUntil) return false
  
  const lockoutTime = parseInt(lockoutUntil, 10)
  if (Date.now() < lockoutTime) {
    return {
      locked: true,
      remainingMs: lockoutTime - Date.now()
    }
  }
  
  // Lockout expired
  localStorage.removeItem(LOCKOUT_UNTIL_KEY)
  localStorage.removeItem(FAILED_ATTEMPTS_KEY)
  return false
}

/**
 * Record failed authentication attempt
 */
function recordFailedAttempt() {
  const attempts = parseInt(localStorage.getItem(FAILED_ATTEMPTS_KEY) || '0', 10) + 1
  localStorage.setItem(FAILED_ATTEMPTS_KEY, attempts.toString())
  
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    const lockoutUntil = Date.now() + LOCKOUT_DURATION_MS
    localStorage.setItem(LOCKOUT_UNTIL_KEY, lockoutUntil.toString())
    return {
      locked: true,
      remainingMs: LOCKOUT_DURATION_MS
    }
  }
  
  return {
    locked: false,
    attemptsRemaining: MAX_FAILED_ATTEMPTS - attempts
  }
}

/**
 * Clear failed attempts on successful auth
 */
function clearFailedAttempts() {
  localStorage.removeItem(FAILED_ATTEMPTS_KEY)
  localStorage.removeItem(LOCKOUT_UNTIL_KEY)
}

/**
 * Verify PIN
 * Accepts 4-8 digits for backward compatibility with existing wallets
 */
export function verifyPIN(pin) {
  const lockout = isLockedOut()
  if (lockout && lockout.locked) {
    throw new Error(`Too many attempts. Try again in ${Math.ceil(lockout.remainingMs / 1000)} seconds`)
  }
  
  // Accept 4-8 digits for backward compatibility
  if (pin.length < 4 || pin.length > 8) {
    throw new Error('Invalid PIN')
  }
  
  const storedHash = localStorage.getItem(PIN_HASH_KEY)
  if (!storedHash) {
    throw new Error('PIN not set up')
  }
  
  const inputHash = hashPIN(pin)
  if (inputHash === storedHash) {
    clearFailedAttempts()
    return true
  }
  
  const result = recordFailedAttempt()
  if (result.locked) {
    throw new Error(`Too many attempts. Try again in ${Math.ceil(result.remainingMs / 1000)} seconds`)
  }
  
  throw new Error(`Invalid PIN. ${result.attemptsRemaining} attempts remaining`)
}

/**
 * Change PIN
 */
export function changePIN(oldPIN, newPIN) {
  verifyPIN(oldPIN)
  return setupPIN(newPIN)
}

/**
 * Check if PIN is set up
 */
export function isPINSetup() {
  return !!localStorage.getItem(PIN_HASH_KEY)
}

/**
 * Set up biometric authentication
 */
export async function setupBiometric(userPassword) {
  const isSupported = await checkBiometricSupport()
  if (!isSupported) {
    throw new Error('Biometric authentication not supported on this device')
  }
  
  try {
    // Create a challenge
    const challenge = new Uint8Array(32)
    crypto.getRandomValues(challenge)
    
    // Encode the password with the credential for later retrieval
    const encodedPassword = new TextEncoder().encode(userPassword)
    
    // Create credential
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'H173K Wallet',
          id: window.location.hostname
        },
        user: {
          id: new Uint8Array(16),
          name: 'h173k-user',
          displayName: 'H173K Wallet User'
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' }  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          requireResidentKey: false
        },
        timeout: 60000
      }
    })
    
    if (!credential) {
      throw new Error('Failed to create biometric credential')
    }
    
    // Store credential ID and encrypted password
    const credentialData = {
      credentialId: Array.from(new Uint8Array(credential.rawId)),
      encryptedPassword: CryptoJS.AES.encrypt(userPassword, 'h173k_biometric_key').toString()
    }
    
    localStorage.setItem(BIOMETRIC_KEY, JSON.stringify(credentialData))
    localStorage.setItem(AUTH_METHOD_KEY, 'biometric')
    
    return true
  } catch (err) {
    console.error('Biometric setup error:', err)
    throw new Error('Failed to set up biometric: ' + err.message)
  }
}

/**
 * Authenticate with biometric and return password
 */
export async function authenticateBiometric() {
  const credentialDataStr = localStorage.getItem(BIOMETRIC_KEY)
  if (!credentialDataStr) {
    throw new Error('Biometric not set up')
  }
  
  const credentialData = JSON.parse(credentialDataStr)
  const credentialId = new Uint8Array(credentialData.credentialId)
  
  try {
    const challenge = new Uint8Array(32)
    crypto.getRandomValues(challenge)
    
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: credentialId,
          type: 'public-key',
          transports: ['internal']
        }],
        userVerification: 'required',
        timeout: 60000
      }
    })
    
    if (!assertion) {
      throw new Error('Biometric authentication failed')
    }
    
    // Decrypt and return the password
    const decrypted = CryptoJS.AES.decrypt(credentialData.encryptedPassword, 'h173k_biometric_key')
    const password = decrypted.toString(CryptoJS.enc.Utf8)
    
    clearFailedAttempts()
    return password
  } catch (err) {
    console.error('Biometric auth error:', err)
    throw new Error('Biometric authentication failed')
  }
}

/**
 * Check if biometric is set up
 */
export function isBiometricSetup() {
  return !!localStorage.getItem(BIOMETRIC_KEY)
}

/**
 * Get current authentication method
 */
export function getAuthMethod() {
  return localStorage.getItem(AUTH_METHOD_KEY) || null
}

/**
 * Remove biometric authentication
 */
export function removeBiometric() {
  localStorage.removeItem(BIOMETRIC_KEY)
  if (getAuthMethod() === 'biometric') {
    localStorage.setItem(AUTH_METHOD_KEY, 'pin')
  }
}

/**
 * Get failed attempts count
 */
export function getFailedAttempts() {
  return parseInt(localStorage.getItem(FAILED_ATTEMPTS_KEY) || '0', 10)
}

/**
 * Reset all authentication data
 */
export function resetAuth() {
  localStorage.removeItem(PIN_HASH_KEY)
  localStorage.removeItem(BIOMETRIC_KEY)
  localStorage.removeItem(AUTH_METHOD_KEY)
  localStorage.removeItem(FAILED_ATTEMPTS_KEY)
  localStorage.removeItem(LOCKOUT_UNTIL_KEY)
}
