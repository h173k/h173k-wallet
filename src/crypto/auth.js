/**
 * H173K Wallet - Authentication Module (SECURITY FIXED)
 * Supports PIN code and biometric authentication
 * 
 * POPRAWKI BEZPIECZEŃSTWA:
 * 1. Unikalny salt dla każdego użytkownika (zamiast statycznego)
 * 2. PBKDF2 z 100,000 iteracji (zamiast prostego SHA256)
 * 3. Unikalny klucz szyfrujący per urządzenie (zamiast hardcoded)
 * 4. Losowy IV dla każdej operacji szyfrowania
 */

import CryptoJS from 'crypto-js'

const PIN_HASH_KEY = 'h173k_pin_hash'
const PIN_SALT_KEY = 'h173k_pin_salt'
const BIOMETRIC_KEY = 'h173k_biometric_credential'
const BIOMETRIC_DEVICE_KEY = 'h173k_biometric_device_key' // NOWE: unikalny klucz per urządzenie
const AUTH_METHOD_KEY = 'h173k_auth_method'
const FAILED_ATTEMPTS_KEY = 'h173k_failed_attempts'
const LOCKOUT_UNTIL_KEY = 'h173k_lockout_until'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 5 * 60 * 1000 // 5 minutes
const PBKDF2_ITERATIONS = 100000 // Wysoka liczba iteracji dla bezpieczeństwa

/**
 * Generuje kryptograficznie bezpieczny losowy string
 */
function generateSecureRandom(bytes = 32) {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Pobiera lub tworzy salt dla PIN-u użytkownika
 */
function getOrCreatePinSalt() {
  let salt = localStorage.getItem(PIN_SALT_KEY)
  if (!salt) {
    salt = generateSecureRandom(32)
    localStorage.setItem(PIN_SALT_KEY, salt)
  }
  return salt
}

/**
 * Pobiera lub tworzy unikalny klucz szyfrujący dla tego urządzenia
 * POPRAWKA: Zamiast hardcoded klucza, każde urządzenie ma swój unikalny klucz
 */
function getOrCreateDeviceKey() {
  let deviceKey = localStorage.getItem(BIOMETRIC_DEVICE_KEY)
  if (!deviceKey) {
    deviceKey = generateSecureRandom(32)
    localStorage.setItem(BIOMETRIC_DEVICE_KEY, deviceKey)
  }
  return deviceKey
}

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
 * Hash PIN for storage using PBKDF2 with unique salt
 * POPRAWKA: Używamy PBKDF2 z unikalnym salt zamiast prostego SHA256
 */
function hashPIN(pin) {
  const salt = getOrCreatePinSalt()
  return CryptoJS.PBKDF2(pin, salt + '_pin_hash_v2', {
    keySize: 256 / 32,
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256
  }).toString()
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
  
  // Generuj nowy salt przy tworzeniu PIN-u
  const salt = generateSecureRandom(32)
  localStorage.setItem(PIN_SALT_KEY, salt)
  
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
 * POPRAWKA: Używamy unikalnego klucza per urządzenie zamiast hardcoded
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
    
    // POPRAWKA: Używamy unikalnego klucza per urządzenie
    const deviceKey = getOrCreateDeviceKey()
    
    // Generujemy losowy IV dla szyfrowania
    const iv = generateSecureRandom(16)
    
    // Derywujemy klucz z deviceKey używając PBKDF2
    const encryptionKey = CryptoJS.PBKDF2(deviceKey, iv + '_biometric_enc', {
      keySize: 256 / 32,
      iterations: 10000, // Mniej iteracji bo deviceKey jest już silny
      hasher: CryptoJS.algo.SHA256
    })
    
    // Store credential ID and encrypted password
    const credentialData = {
      credentialId: Array.from(new Uint8Array(credential.rawId)),
      encryptedPassword: CryptoJS.AES.encrypt(userPassword, encryptionKey, {
        iv: CryptoJS.enc.Hex.parse(iv),
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      }).toString(),
      iv: iv
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
 * POPRAWKA: Używamy unikalnego klucza per urządzenie
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
    
    // POPRAWKA: Używamy unikalnego klucza per urządzenie
    const deviceKey = localStorage.getItem(BIOMETRIC_DEVICE_KEY)
    if (!deviceKey) {
      throw new Error('Device key not found. Please re-enable biometric.')
    }
    
    // Derywujemy klucz z deviceKey
    const encryptionKey = CryptoJS.PBKDF2(deviceKey, credentialData.iv + '_biometric_enc', {
      keySize: 256 / 32,
      iterations: 10000,
      hasher: CryptoJS.algo.SHA256
    })
    
    // Decrypt the password
    const decrypted = CryptoJS.AES.decrypt(credentialData.encryptedPassword, encryptionKey, {
      iv: CryptoJS.enc.Hex.parse(credentialData.iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    })
    const password = decrypted.toString(CryptoJS.enc.Utf8)
    
    if (!password) {
      throw new Error('Failed to decrypt password. Please re-enable biometric.')
    }
    
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
  // Uwaga: NIE usuwamy deviceKey - może być używany ponownie
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
  localStorage.removeItem(PIN_SALT_KEY)
  localStorage.removeItem(BIOMETRIC_KEY)
  localStorage.removeItem(BIOMETRIC_DEVICE_KEY)
  localStorage.removeItem(AUTH_METHOD_KEY)
  localStorage.removeItem(FAILED_ATTEMPTS_KEY)
  localStorage.removeItem(LOCKOUT_UNTIL_KEY)
}
