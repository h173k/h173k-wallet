/**
 * H173K Wallet - Cryptographic Wallet Module (SECURITY FIXED)
 * Uses browser-native libraries: @scure/bip39, @noble/hashes, tweetnacl
 * Compatible with Phantom/Solflare seed phrase format (BIP39 + BIP44)
 * 
 * POPRAWKI BEZPIECZEŃSTWA:
 * 1. Unikalny salt dla każdego portfela
 * 2. PBKDF2 z 100,000 iteracji do derywacji klucza z hasła
 * 3. Losowy IV dla każdej operacji szyfrowania
 * 4. Bezpieczne czyszczenie pamięci przy blokowaniu
 */

import { Keypair } from '@solana/web3.js'
import { generateMnemonic as genMnemonic, mnemonicToSeedSync, validateMnemonic as validateMnem } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { sha512 } from '@noble/hashes/sha512'
import { hmac } from '@noble/hashes/hmac'
import nacl from 'tweetnacl'
import CryptoJS from 'crypto-js'

// Storage keys
const ENCRYPTED_SEED_KEY = 'h173k_encrypted_seed'
const WALLET_EXISTS_KEY = 'h173k_wallet_exists'
const AUTH_HASH_KEY = 'h173k_auth_hash'
const WALLET_SALT_KEY = 'h173k_wallet_salt'
const ENCRYPTION_IV_KEY = 'h173k_encryption_iv'

const PBKDF2_ITERATIONS = 100000

/**
 * Generuje kryptograficznie bezpieczny losowy string
 */
function generateSecureRandom(bytes = 32) {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Pobiera lub tworzy salt dla portfela
 */
function getOrCreateWalletSalt() {
  let salt = localStorage.getItem(WALLET_SALT_KEY)
  if (!salt) {
    salt = generateSecureRandom(32)
    localStorage.setItem(WALLET_SALT_KEY, salt)
  }
  return salt
}

/**
 * Derywuje klucz z hasła używając PBKDF2
 */
function deriveKeyFromPassword(password, salt) {
  return CryptoJS.PBKDF2(password, salt, {
    keySize: 256 / 32,
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256
  })
}

/**
 * Derive ed25519 key from seed using SLIP-0010
 * Path: m/44'/501'/0'/0' (Solana/Phantom standard)
 */
function derivePath(path, seed) {
  const HARDENED_OFFSET = 0x80000000
  
  // Master key derivation
  const I = hmac(sha512, 'ed25519 seed', seed)
  let key = I.slice(0, 32)
  let chainCode = I.slice(32)
  
  // Parse path
  const segments = path.split('/')
    .slice(1) // remove 'm'
    .map(seg => {
      const hardened = seg.endsWith("'")
      const index = parseInt(hardened ? seg.slice(0, -1) : seg, 10)
      return hardened ? index + HARDENED_OFFSET : index
    })
  
  // Derive each segment
  for (const index of segments) {
    const indexBuffer = new Uint8Array(4)
    new DataView(indexBuffer.buffer).setUint32(0, index, false) // big-endian
    
    const data = new Uint8Array(1 + 32 + 4)
    data[0] = 0x00
    data.set(key, 1)
    data.set(indexBuffer, 33)
    
    const I = hmac(sha512, chainCode, data)
    key = I.slice(0, 32)
    chainCode = I.slice(32)
  }
  
  return { key }
}

/**
 * Generate a new 12-word mnemonic (compatible with Phantom)
 */
export function generateMnemonic() {
  return genMnemonic(wordlist, 128) // 12 words
}

/**
 * Generate 24-word mnemonic for extra security
 */
export function generateMnemonic24() {
  return genMnemonic(wordlist, 256) // 24 words
}

/**
 * Validate a mnemonic phrase
 */
export function validateMnemonic(mnemonic) {
  try {
    return validateMnem(mnemonic.trim().toLowerCase(), wordlist)
  } catch {
    return false
  }
}

/**
 * Derive Solana keypair from mnemonic using BIP44 path
 * This is compatible with Phantom wallet's derivation
 */
export function deriveKeypairFromMnemonic(mnemonic, accountIndex = 0) {
  const seed = mnemonicToSeedSync(mnemonic.trim().toLowerCase())
  const path = `m/44'/501'/${accountIndex}'/0'`
  const { key } = derivePath(path, seed)
  
  // Generate ed25519 keypair from seed
  const keypair = nacl.sign.keyPair.fromSeed(key)
  
  return Keypair.fromSecretKey(keypair.secretKey)
}

/**
 * Encrypt mnemonic with password using AES-256 + PBKDF2
 * POPRAWKA: Używamy PBKDF2 i losowy IV
 */
export function encryptMnemonic(mnemonic, password) {
  const salt = getOrCreateWalletSalt()
  const iv = generateSecureRandom(16)
  
  // Derywuj klucz z hasła
  const key = deriveKeyFromPassword(password, salt)
  
  // Szyfruj z losowym IV
  const encrypted = CryptoJS.AES.encrypt(mnemonic, key, {
    iv: CryptoJS.enc.Hex.parse(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  })
  
  localStorage.setItem(ENCRYPTION_IV_KEY, iv)
  
  return encrypted.toString()
}

/**
 * Decrypt mnemonic with password
 * POPRAWKA: Używamy PBKDF2
 */
export function decryptMnemonic(encryptedMnemonic, password) {
  try {
    const salt = localStorage.getItem(WALLET_SALT_KEY)
    const iv = localStorage.getItem(ENCRYPTION_IV_KEY)
    
    if (!salt || !iv) {
      throw new Error('Missing encryption parameters')
    }
    
    const key = deriveKeyFromPassword(password, salt)
    
    const decrypted = CryptoJS.AES.decrypt(encryptedMnemonic, key, {
      iv: CryptoJS.enc.Hex.parse(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    })
    
    const mnemonic = decrypted.toString(CryptoJS.enc.Utf8)
    if (!mnemonic || !validateMnemonic(mnemonic)) {
      throw new Error('Invalid password or corrupted data')
    }
    return mnemonic
  } catch (err) {
    throw new Error('Invalid password')
  }
}

/**
 * Hash password for verification using PBKDF2
 * POPRAWKA: Używamy PBKDF2 z unikalnym salt
 */
export function hashPassword(password) {
  const salt = getOrCreateWalletSalt()
  return CryptoJS.PBKDF2(password, salt + '_auth_hash_v2', {
    keySize: 256 / 32,
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256
  }).toString()
}

/**
 * Store encrypted wallet
 */
export function storeEncryptedWallet(mnemonic, password) {
  // Generuj nowy salt dla nowego portfela
  const salt = generateSecureRandom(32)
  localStorage.setItem(WALLET_SALT_KEY, salt)
  
  const encrypted = encryptMnemonic(mnemonic, password)
  const passwordHash = hashPassword(password)
  
  localStorage.setItem(ENCRYPTED_SEED_KEY, encrypted)
  localStorage.setItem(AUTH_HASH_KEY, passwordHash)
  localStorage.setItem(WALLET_EXISTS_KEY, 'true')
  
  return true
}

/**
 * Check if wallet exists in storage
 */
export function walletExists() {
  return localStorage.getItem(WALLET_EXISTS_KEY) === 'true'
}

/**
 * Verify password against stored hash
 */
export function verifyPassword(password) {
  const storedHash = localStorage.getItem(AUTH_HASH_KEY)
  if (!storedHash) return false
  return hashPassword(password) === storedHash
}

/**
 * Load and decrypt wallet
 */
export function loadWallet(password) {
  const encrypted = localStorage.getItem(ENCRYPTED_SEED_KEY)
  if (!encrypted) {
    throw new Error('No wallet found')
  }
  
  const mnemonic = decryptMnemonic(encrypted, password)
  const keypair = deriveKeypairFromMnemonic(mnemonic)
  
  return {
    mnemonic,
    keypair,
    publicKey: keypair.publicKey
  }
}

/**
 * Export wallet for session use (returns keypair without mnemonic)
 */
export function unlockWalletForSession(password) {
  const wallet = loadWallet(password)
  return {
    keypair: wallet.keypair,
    publicKey: wallet.publicKey
  }
}

/**
 * Get mnemonic for backup (requires password)
 */
export function exportMnemonic(password) {
  const wallet = loadWallet(password)
  return wallet.mnemonic
}

/**
 * Import wallet from mnemonic
 */
export function importWallet(mnemonic, password) {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase')
  }
  
  const keypair = deriveKeypairFromMnemonic(mnemonic)
  storeEncryptedWallet(mnemonic.trim().toLowerCase(), password)
  
  return {
    keypair,
    publicKey: keypair.publicKey
  }
}

/**
 * Delete wallet from storage
 */
export function deleteWallet() {
  localStorage.removeItem(ENCRYPTED_SEED_KEY)
  localStorage.removeItem(AUTH_HASH_KEY)
  localStorage.removeItem(WALLET_EXISTS_KEY)
  localStorage.removeItem(WALLET_SALT_KEY)
  localStorage.removeItem(ENCRYPTION_IV_KEY)
}

/**
 * Change wallet password
 */
export function changePassword(oldPassword, newPassword) {
  const wallet = loadWallet(oldPassword)
  
  // Generuj nowy salt dla nowego hasła
  const newSalt = generateSecureRandom(32)
  localStorage.setItem(WALLET_SALT_KEY, newSalt)
  
  storeEncryptedWallet(wallet.mnemonic, newPassword)
  return true
}

/**
 * Session wallet class for maintaining unlocked state
 */
export class SessionWallet {
  constructor() {
    this.keypair = null
    this.publicKey = null
    this.unlocked = false
    this.lockTimeout = null
    this.autoLockMinutes = 5
  }
  
  unlock(password) {
    const wallet = unlockWalletForSession(password)
    this.keypair = wallet.keypair
    this.publicKey = wallet.publicKey
    this.unlocked = true
    this.resetAutoLock()
    return this.publicKey
  }
  
  lock() {
    // POPRAWKA: Bezpieczne czyszczenie pamięci
    if (this.keypair && this.keypair.secretKey) {
      // Nadpisz secretKey zerami przed usunięciem
      try {
        this.keypair.secretKey.fill(0)
      } catch (e) {
        // Ignoruj błędy jeśli secretKey jest immutable
      }
    }
    this.keypair = null
    this.publicKey = null
    this.unlocked = false
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout)
      this.lockTimeout = null
    }
  }
  
  resetAutoLock() {
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout)
    }
    this.lockTimeout = setTimeout(() => {
      this.lock()
    }, this.autoLockMinutes * 60 * 1000)
  }
  
  setAutoLockMinutes(minutes) {
    this.autoLockMinutes = minutes
    this.resetAutoLock()
  }
  
  isUnlocked() {
    return this.unlocked && this.keypair !== null
  }
  
  getKeypair() {
    if (!this.isUnlocked()) {
      throw new Error('Wallet is locked')
    }
    this.resetAutoLock()
    return this.keypair
  }
  
  getPublicKey() {
    return this.publicKey
  }
  
  signTransaction(transaction) {
    if (!this.isUnlocked()) {
      throw new Error('Wallet is locked')
    }
    this.resetAutoLock()
    transaction.sign(this.keypair)
    return transaction
  }
  
  signAllTransactions(transactions) {
    if (!this.isUnlocked()) {
      throw new Error('Wallet is locked')
    }
    this.resetAutoLock()
    return transactions.map(tx => {
      tx.sign(this.keypair)
      return tx
    })
  }
  
  signMessage(message) {
    if (!this.isUnlocked()) {
      throw new Error('Wallet is locked')
    }
    this.resetAutoLock()
    const messageBytes = typeof message === 'string' 
      ? new TextEncoder().encode(message)
      : message
    return nacl.sign.detached(messageBytes, this.keypair.secretKey)
  }
}

// Global session wallet instance
export const sessionWallet = new SessionWallet()
