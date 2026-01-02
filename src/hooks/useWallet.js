/**
 * H173K Wallet - React Hooks for Wallet Management
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { 
  sessionWallet, 
  walletExists, 
  generateMnemonic, 
  importWallet, 
  loadWallet,
  storeEncryptedWallet,
  deriveKeypairFromMnemonic,
  exportMnemonic,
  deleteWallet
} from '../crypto/wallet'
import { 
  setupPIN, 
  verifyPIN, 
  isPINSetup,
  checkBiometricSupport,
  setupBiometric,
  authenticateBiometric,
  isBiometricSetup,
  isLockedOut
} from '../crypto/auth'
import { TOKEN_MINT, TOKEN_DECIMALS, getRpcEndpoint } from '../constants'

/**
 * Main wallet hook
 */
export function useWallet() {
  const [initialized, setInitialized] = useState(false)
  const [hasWallet, setHasWallet] = useState(false)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [publicKey, setPublicKey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // Check wallet state on mount
  useEffect(() => {
    const checkWallet = () => {
      const exists = walletExists()
      setHasWallet(exists)
      setIsUnlocked(sessionWallet.isUnlocked())
      setPublicKey(sessionWallet.getPublicKey())
      setLoading(false)
      setInitialized(true)
    }
    
    checkWallet()
  }, [])
  
  // Create new wallet
  const createWallet = useCallback(async (password, pin) => {
    setLoading(true)
    setError(null)
    
    try {
      const mnemonic = generateMnemonic()
      storeEncryptedWallet(mnemonic, password)
      setupPIN(pin)
      
      sessionWallet.unlock(password)
      setHasWallet(true)
      setIsUnlocked(true)
      setPublicKey(sessionWallet.getPublicKey())
      
      return mnemonic
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])
  
  // Import existing wallet
  const importExistingWallet = useCallback(async (mnemonic, password, pin) => {
    setLoading(true)
    setError(null)
    
    try {
      importWallet(mnemonic, password)
      setupPIN(pin)
      
      sessionWallet.unlock(password)
      setHasWallet(true)
      setIsUnlocked(true)
      setPublicKey(sessionWallet.getPublicKey())
      
      return sessionWallet.getPublicKey()
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])
  
  // Unlock wallet with PIN
  const unlockWithPIN = useCallback(async (pin, password) => {
    setLoading(true)
    setError(null)
    
    try {
      verifyPIN(pin)
      sessionWallet.unlock(password)
      setIsUnlocked(true)
      setPublicKey(sessionWallet.getPublicKey())
      return true
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])
  
  // Unlock with biometric
  const unlockWithBiometric = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const password = await authenticateBiometric()
      sessionWallet.unlock(password)
      setIsUnlocked(true)
      setPublicKey(sessionWallet.getPublicKey())
      return true
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])
  
  // Lock wallet
  const lock = useCallback(() => {
    sessionWallet.lock()
    setIsUnlocked(false)
  }, [])
  
  // Delete wallet
  const deleteCurrentWallet = useCallback(() => {
    deleteWallet()
    sessionWallet.lock()
    setHasWallet(false)
    setIsUnlocked(false)
    setPublicKey(null)
  }, [])
  
  // Get signer for transactions
  const getSigner = useCallback(() => {
    if (!sessionWallet.isUnlocked()) {
      throw new Error('Wallet is locked')
    }
    return sessionWallet
  }, [])
  
  return {
    initialized,
    hasWallet,
    isUnlocked,
    publicKey,
    loading,
    error,
    createWallet,
    importExistingWallet,
    unlockWithPIN,
    unlockWithBiometric,
    lock,
    deleteWallet: deleteCurrentWallet,
    getSigner,
    // Additional auth checks
    isPINSetup: isPINSetup(),
    isBiometricSetup: isBiometricSetup(),
    checkBiometricSupport
  }
}

/**
 * Token balance hook
 */
export function useTokenBalance(connection, publicKey) {
  const [balance, setBalance] = useState(0)
  const [solBalance, setSolBalance] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  const fetchBalance = useCallback(async () => {
    if (!connection || !publicKey) return
    
    setLoading(true)
    setError(null)
    
    try {
      // Fetch H173K balance
      const tokenAccount = await getAssociatedTokenAddress(
        TOKEN_MINT,
        publicKey
      )
      
      try {
        const account = await getAccount(connection, tokenAccount)
        setBalance(Number(account.amount) / Math.pow(10, TOKEN_DECIMALS))
      } catch {
        setBalance(0)
      }
      
      // Fetch SOL balance
      const lamports = await connection.getBalance(publicKey)
      setSolBalance(lamports / LAMPORTS_PER_SOL)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [connection, publicKey])
  
  useEffect(() => {
    fetchBalance()
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchBalance, 30000)
    return () => clearInterval(interval)
  }, [fetchBalance])
  
  return { balance, solBalance, loading, error, refresh: fetchBalance }
}

/**
 * Transaction history hook
 */
export function useTransactionHistory(connection, publicKey) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  const fetchHistory = useCallback(async (limit = 20) => {
    if (!connection || !publicKey) return
    
    setLoading(true)
    setError(null)
    
    try {
      const tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)
      
      // Get signatures for token account
      const signatures = await connection.getSignaturesForAddress(tokenAccount, { limit })
      
      // Get transaction details
      const txDetails = await Promise.all(
        signatures.map(async (sig) => {
          try {
            const tx = await connection.getParsedTransaction(sig.signature, {
              maxSupportedTransactionVersion: 0
            })
            return {
              signature: sig.signature,
              blockTime: sig.blockTime,
              slot: sig.slot,
              err: sig.err,
              memo: sig.memo,
              ...parseTokenTransaction(tx, publicKey, tokenAccount)
            }
          } catch {
            return {
              signature: sig.signature,
              blockTime: sig.blockTime,
              error: true
            }
          }
        })
      )
      
      setTransactions(txDetails.filter(tx => !tx.error))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [connection, publicKey])
  
  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])
  
  return { transactions, loading, error, refresh: fetchHistory }
}

/**
 * Parse token transaction to extract relevant info
 */
function parseTokenTransaction(tx, walletPubkey, tokenAccount) {
  if (!tx || !tx.meta) return { type: 'unknown', amount: 0 }
  
  const tokenAccountStr = tokenAccount.toString()
  const preBalances = tx.meta.preTokenBalances || []
  const postBalances = tx.meta.postTokenBalances || []
  
  // Find our token account in pre/post balances
  const preBalance = preBalances.find(b => b.mint === TOKEN_MINT.toString())
  const postBalance = postBalances.find(b => b.mint === TOKEN_MINT.toString())
  
  const preBal = preBalance?.uiTokenAmount?.uiAmount || 0
  const postBal = postBalance?.uiTokenAmount?.uiAmount || 0
  const diff = postBal - preBal
  
  if (diff > 0) {
    return {
      type: 'receive',
      amount: diff,
      counterparty: findCounterparty(tx, walletPubkey, 'receive')
    }
  } else if (diff < 0) {
    return {
      type: 'send',
      amount: Math.abs(diff),
      counterparty: findCounterparty(tx, walletPubkey, 'send')
    }
  }
  
  return { type: 'unknown', amount: 0 }
}

function findCounterparty(tx, walletPubkey, direction) {
  // Try to find the other party in the transaction
  const accounts = tx.transaction?.message?.accountKeys || []
  for (const acc of accounts) {
    const pubkey = acc.pubkey || acc
    if (pubkey.toString() !== walletPubkey.toString()) {
      return pubkey.toString()
    }
  }
  return null
}

/**
 * SOL requirement check hook
 */
export function useSOLRequirement(connection, publicKey, minSOL = 0.01) {
  const [needsSOL, setNeedsSOL] = useState(false)
  const [currentSOL, setCurrentSOL] = useState(0)
  const [requiredSOL, setRequiredSOL] = useState(minSOL)
  
  useEffect(() => {
    if (!connection || !publicKey) return
    
    const check = async () => {
      try {
        const lamports = await connection.getBalance(publicKey)
        const sol = lamports / LAMPORTS_PER_SOL
        setCurrentSOL(sol)
        setNeedsSOL(sol < minSOL)
      } catch {
        setNeedsSOL(true)
      }
    }
    
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [connection, publicKey, minSOL])
  
  return { needsSOL, currentSOL, requiredSOL }
}
