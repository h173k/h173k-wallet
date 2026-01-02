/**
 * H173K Wallet - Direct Raydium CPMM Pool Swap
 * Swaps directly on Raydium CPMM pool without external API
 */

import { useState, useCallback } from 'react'
import { 
  Connection, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  SystemProgram
} from '@solana/web3.js'
import { 
  TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  getAccount
} from '@solana/spl-token'
import { TOKEN_MINT, TOKEN_DECIMALS } from '../constants'

// H173K-SOL Pool ID (CPMM type)
const POOL_ID = new PublicKey('8A7r3ZT7nXjtghKKnmVhrwnApJHG4tpvBF9BDCBmHWqr')

// Wrapped SOL Mint
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')

// Raydium CPMM Program
const RAYDIUM_CPMM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C')

// Pool addresses from on-chain analysis (hardcoded for reliability)
// These are extracted from pool account data at specific offsets
const POOL_CONFIG = {
  ammConfig: new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2'),      // offset 8-39
  token0Vault: new PublicKey('8cK4Bh1FUrnJR8ax41HFeNzs9GTJXY6a7QJECAHSjCHM'),    // offset 72-103
  token1Vault: new PublicKey('8yMT1LSnB8jXjb7bmZpfD684DUe5M8KJsntVQoG5TcdY'),    // offset 104-135
  lpMint: new PublicKey('3JC5J6GHZXW2J2D4qc5pC87T8qCTJh84cmVofehaaGJz'),         // offset 136-167
  token0Mint: TOKEN_MINT,                                                         // H173K - offset 168-199
  token1Mint: WSOL_MINT,                                                          // WSOL - offset 200-231
  observationKey: new PublicKey('DbajbtNyRaTSgvKQHJA3paU1B83aWFqmKLwoQLkSpciJ')  // offset 296-327
}

// Minimum SOL required to execute a swap transaction
const MIN_SOL_FOR_SWAP = 0.003

// SOL buffer added when replenishing
const SOL_BUFFER = 0.006

/**
 * Get CPMM Authority PDA
 */
function getCPMMAuthority() {
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    RAYDIUM_CPMM
  )
  return authority
}

/**
 * Hook for direct Raydium CPMM pool swapping
 */
export function useSwap(connection, wallet) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [quote, setQuote] = useState(null)
  const [poolInfo, setPoolInfo] = useState(null)
  
  /**
   * Fetch pool reserves from vault accounts
   */
  const fetchPoolData = useCallback(async () => {
    try {
      console.log('Fetching pool data...')
      console.log('Token 0 Vault:', POOL_CONFIG.token0Vault.toString())
      console.log('Token 1 Vault:', POOL_CONFIG.token1Vault.toString())
      
      // Fetch vault balances directly
      const [vault0Balance, vault1Balance] = await Promise.all([
        connection.getTokenAccountBalance(POOL_CONFIG.token0Vault),
        connection.getTokenAccountBalance(POOL_CONFIG.token1Vault)
      ])
      
      const pool = {
        ...POOL_CONFIG,
        token0Reserve: BigInt(vault0Balance.value.amount),
        token1Reserve: BigInt(vault1Balance.value.amount),
        // H173K is token0 in this pool
        isH173KToken0: POOL_CONFIG.token0Mint.equals(TOKEN_MINT)
      }
      
      console.log('Token 0 Reserve:', pool.token0Reserve.toString())
      console.log('Token 1 Reserve:', pool.token1Reserve.toString())
      console.log('Is H173K Token 0:', pool.isH173KToken0)
      
      setPoolInfo(pool)
      return pool
    } catch (err) {
      console.error('Failed to fetch pool data:', err)
      throw err
    }
  }, [connection])
  
  /**
   * Calculate swap output using constant product formula
   * Fee: 0.25% (25 bps) for CPMM
   */
  const calculateOutput = useCallback((amountIn, reserveIn, reserveOut, feeBps = 25) => {
    const amountInBigInt = BigInt(amountIn)
    // Apply fee
    const feeAmount = (amountInBigInt * BigInt(feeBps)) / 10000n
    const amountInAfterFee = amountInBigInt - feeAmount
    
    // Constant product: amountOut = reserveOut * amountIn / (reserveIn + amountIn)
    const numerator = reserveOut * amountInAfterFee
    const denominator = reserveIn + amountInAfterFee
    return numerator / denominator
  }, [])
  
  /**
   * Get swap quote (H173K -> SOL)
   */
  const getSwapQuote = useCallback(async (inputAmount, slippagePct = 1) => {
    setLoading(true)
    setError(null)
    
    try {
      let pool = poolInfo
      if (!pool) {
        pool = await fetchPoolData()
      }
      
      const inputLamports = BigInt(Math.floor(inputAmount * Math.pow(10, TOKEN_DECIMALS)))
      
      // Determine reserves based on token position
      const reserveH173K = pool.isH173KToken0 ? pool.token0Reserve : pool.token1Reserve
      const reserveSOL = pool.isH173KToken0 ? pool.token1Reserve : pool.token0Reserve
      
      const outputLamports = calculateOutput(inputLamports, reserveH173K, reserveSOL, 25)
      
      const outputAmount = Number(outputLamports) / LAMPORTS_PER_SOL
      const minOutput = outputAmount * (1 - slippagePct / 100)
      const priceImpact = (Number(inputLamports) / Number(reserveH173K)) * 100
      
      const quoteData = {
        inputAmount,
        outputAmount,
        minimumOutput: minOutput,
        minimumOutputLamports: BigInt(Math.floor(minOutput * LAMPORTS_PER_SOL)),
        priceImpact,
        pool
      }
      
      setQuote(quoteData)
      return quoteData
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [poolInfo, fetchPoolData, calculateOutput])
  
  /**
   * Get swap quote (SOL -> H173K)
   */
  const getSwapQuoteSOLtoH173K = useCallback(async (solAmount, slippagePct = 1) => {
    setLoading(true)
    setError(null)
    
    try {
      let pool = poolInfo
      if (!pool) {
        pool = await fetchPoolData()
      }
      
      const inputLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL))
      
      const reserveH173K = pool.isH173KToken0 ? pool.token0Reserve : pool.token1Reserve
      const reserveSOL = pool.isH173KToken0 ? pool.token1Reserve : pool.token0Reserve
      
      const outputLamports = calculateOutput(inputLamports, reserveSOL, reserveH173K, 25)
      
      const outputAmount = Number(outputLamports) / Math.pow(10, TOKEN_DECIMALS)
      const minOutput = outputAmount * (1 - slippagePct / 100)
      const priceImpact = (Number(inputLamports) / Number(reserveSOL)) * 100
      
      return {
        inputAmount: solAmount,
        outputAmount,
        minimumOutput: minOutput,
        minimumOutputLamports: BigInt(Math.floor(minOutput * Math.pow(10, TOKEN_DECIMALS))),
        priceImpact,
        pool
      }
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [poolInfo, fetchPoolData, calculateOutput])
  
  /**
   * Create CPMM swap instruction
   * Discriminator for swap_base_input: [143, 190, 90, 218, 196, 30, 51, 222]
   */
  const createCPMMSwapInstruction = useCallback((
    pool,
    userInputAccount,
    userOutputAccount,
    inputVault,
    outputVault,
    inputMint,
    outputMint,
    userOwner,
    amountIn,
    minAmountOut
  ) => {
    const authority = getCPMMAuthority()
    
    const keys = [
      { pubkey: userOwner, isSigner: true, isWritable: false },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: pool.ammConfig, isSigner: false, isWritable: false },
      { pubkey: POOL_ID, isSigner: false, isWritable: true },
      { pubkey: userInputAccount, isSigner: false, isWritable: true },
      { pubkey: userOutputAccount, isSigner: false, isWritable: true },
      { pubkey: inputVault, isSigner: false, isWritable: true },
      { pubkey: outputVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: inputMint, isSigner: false, isWritable: false },
      { pubkey: outputMint, isSigner: false, isWritable: false },
      { pubkey: pool.observationKey, isSigner: false, isWritable: true }
    ]
    
    // swap_base_input discriminator + amount_in + min_amount_out
    const discriminator = Buffer.from([143, 190, 90, 218, 196, 30, 51, 222])
    const data = Buffer.alloc(8 + 8 + 8)
    discriminator.copy(data, 0)
    data.writeBigUInt64LE(BigInt(amountIn), 8)
    data.writeBigUInt64LE(BigInt(minAmountOut), 16)
    
    return new TransactionInstruction({
      programId: RAYDIUM_CPMM,
      keys,
      data
    })
  }, [])
  
  /**
   * Execute swap transaction
   */
  const executeSwap = useCallback(async (quoteResponse, direction = 'H173KtoSOL') => {
    if (!wallet?.publicKey) {
      throw new Error('Wallet not connected')
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const pool = quoteResponse.pool
      const transaction = new Transaction()
      
      // Get user token accounts
      const userH173KAccount = await getAssociatedTokenAddress(TOKEN_MINT, wallet.publicKey)
      const userWSOLAccount = await getAssociatedTokenAddress(WSOL_MINT, wallet.publicKey)
      
      let userInputAccount, userOutputAccount
      let inputVault, outputVault
      let inputMint, outputMint
      let inputLamports, minOutputLamports
      let needsWSOLCreate = false
      let needsWSOLWrap = false
      let needsWSOLClose = false
      
      if (direction === 'H173KtoSOL') {
        userInputAccount = userH173KAccount
        userOutputAccount = userWSOLAccount
        
        if (pool.isH173KToken0) {
          inputVault = pool.token0Vault
          outputVault = pool.token1Vault
          inputMint = pool.token0Mint
          outputMint = pool.token1Mint
        } else {
          inputVault = pool.token1Vault
          outputVault = pool.token0Vault
          inputMint = pool.token1Mint
          outputMint = pool.token0Mint
        }
        
        inputLamports = Math.floor(quoteResponse.inputAmount * Math.pow(10, TOKEN_DECIMALS))
        minOutputLamports = Number(quoteResponse.minimumOutputLamports)
        
        // Check if WSOL account exists
        try {
          await getAccount(connection, userWSOLAccount)
        } catch {
          needsWSOLCreate = true
        }
        needsWSOLClose = true
        
      } else {
        // SOL -> H173K
        userInputAccount = userWSOLAccount
        userOutputAccount = userH173KAccount
        
        if (pool.isH173KToken0) {
          inputVault = pool.token1Vault
          outputVault = pool.token0Vault
          inputMint = pool.token1Mint
          outputMint = pool.token0Mint
        } else {
          inputVault = pool.token0Vault
          outputVault = pool.token1Vault
          inputMint = pool.token0Mint
          outputMint = pool.token1Mint
        }
        
        inputLamports = Math.floor(quoteResponse.inputAmount * LAMPORTS_PER_SOL)
        minOutputLamports = Number(quoteResponse.minimumOutputLamports)
        
        // Check if WSOL account exists
        try {
          await getAccount(connection, userWSOLAccount)
        } catch {
          needsWSOLCreate = true
        }
        needsWSOLWrap = true
        needsWSOLClose = true
      }
      
      // Create WSOL account if needed
      if (needsWSOLCreate) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            userWSOLAccount,
            wallet.publicKey,
            WSOL_MINT
          )
        )
      }
      
      // Wrap SOL if needed
      if (needsWSOLWrap) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: userWSOLAccount,
            lamports: inputLamports
          }),
          createSyncNativeInstruction(userWSOLAccount)
        )
      }
      
      // Add swap instruction
      transaction.add(
        createCPMMSwapInstruction(
          pool,
          userInputAccount,
          userOutputAccount,
          inputVault,
          outputVault,
          inputMint,
          outputMint,
          wallet.publicKey,
          inputLamports,
          minOutputLamports
        )
      )
      
      // Close WSOL account to unwrap
      if (needsWSOLClose) {
        transaction.add(
          createCloseAccountInstruction(
            userWSOLAccount,
            wallet.publicKey,
            wallet.publicKey
          )
        )
      }
      
      // Get recent blockhash and send
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = wallet.publicKey
      
      const signedTx = await wallet.signTransaction(transaction)
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3
      })
      
      await connection.confirmTransaction(signature, 'confirmed')
      
      return {
        success: true,
        signature,
        inputAmount: quoteResponse.inputAmount,
        outputAmount: quoteResponse.outputAmount
      }
    } catch (err) {
      console.error('Swap error:', err)
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [connection, wallet, createCPMMSwapInstruction])
  
  /**
   * Calculate how much H173K needed for target SOL
   */
  const calculateSwapForSOL = useCallback(async (targetSOL) => {
    let pool = poolInfo
    if (!pool) {
      pool = await fetchPoolData()
    }
    
    const reserveH173K = pool.isH173KToken0 ? pool.token0Reserve : pool.token1Reserve
    const reserveSOL = pool.isH173KToken0 ? pool.token1Reserve : pool.token0Reserve
    
    const targetLamports = BigInt(Math.floor(targetSOL * LAMPORTS_PER_SOL))
    
    // Reverse calculation with fee buffer
    const numerator = reserveH173K * targetLamports
    const denominator = reserveSOL - targetLamports
    const h173kNeededRaw = (numerator / denominator) * 10025n / 10000n
    const h173kNeeded = Number(h173kNeededRaw) / Math.pow(10, TOKEN_DECIMALS)
    
    const quote = await getSwapQuote(h173kNeeded * 1.02)
    
    return { h173kNeeded: quote.inputAmount, solOutput: quote.outputAmount, quote }
  }, [poolInfo, fetchPoolData, getSwapQuote])
  
  /**
   * Check if auto-replenish is possible
   */
  const checkAutoReplenish = useCallback(async (currentSOL, currentH173K, targetSOL = 0.02) => {
    if (currentSOL >= targetSOL) {
      return { canReplenish: true, h173kNeeded: 0, solOutput: 0, alreadySufficient: true }
    }
    
    if (currentSOL < MIN_SOL_FOR_SWAP) {
      return { 
        canReplenish: false, 
        h173kNeeded: 0, 
        solOutput: 0, 
        error: 'Not enough SOL to execute swap transaction',
        needsDeposit: true
      }
    }
    
    try {
      const neededSOL = targetSOL - currentSOL + 0.005
      const { h173kNeeded, solOutput, quote } = await calculateSwapForSOL(neededSOL)
      
      if (h173kNeeded > currentH173K) {
        return {
          canReplenish: false,
          h173kNeeded,
          solOutput,
          error: `Need ${h173kNeeded.toFixed(2)} h173k but only have ${currentH173K.toFixed(2)}`,
          insufficientH173K: true
        }
      }
      
      return { canReplenish: true, h173kNeeded, solOutput, quote }
    } catch (err) {
      return { canReplenish: false, h173kNeeded: 0, solOutput: 0, error: err.message }
    }
  }, [calculateSwapForSOL])
  
  /**
   * Auto-replenish SOL
   */
  const autoReplenishSOL = useCallback(async (targetSOL = 0.02) => {
    if (!wallet?.publicKey) {
      throw new Error('Wallet not connected')
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const lamports = await connection.getBalance(wallet.publicKey)
      const currentSOL = lamports / LAMPORTS_PER_SOL
      
      if (currentSOL >= targetSOL) {
        return { success: true, message: 'SOL balance sufficient', currentSOL }
      }
      
      if (currentSOL < MIN_SOL_FOR_SWAP) {
        throw new Error('Not enough SOL to execute swap. Please deposit SOL first.')
      }
      
      const neededSOL = targetSOL - currentSOL + 0.005
      const { h173kNeeded, quote } = await calculateSwapForSOL(neededSOL)
      
      const tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, wallet.publicKey)
      const tokenBalance = await connection.getTokenAccountBalance(tokenAccount)
      const h173kBalance = Number(tokenBalance.value.uiAmount)
      
      if (h173kNeeded > h173kBalance) {
        throw new Error(`Insufficient H173K. Need ${h173kNeeded.toFixed(2)}, have ${h173kBalance.toFixed(2)}`)
      }
      
      const result = await executeSwap(quote, 'H173KtoSOL')
      
      return {
        success: true,
        signature: result.signature,
        h173kSwapped: result.inputAmount,
        solReceived: result.outputAmount,
        newSOLBalance: currentSOL + result.outputAmount
      }
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [connection, wallet, calculateSwapForSOL, executeSwap])
  
  /**
   * Convert SOL to H173K
   */
  const convertSOLtoH173K = useCallback(async (solAmount) => {
    if (!wallet?.publicKey) {
      throw new Error('Wallet not connected')
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const quote = await getSwapQuoteSOLtoH173K(solAmount)
      const result = await executeSwap(quote, 'SOLtoH173K')
      
      return {
        success: true,
        signature: result.signature,
        solSwapped: result.inputAmount,
        h173kReceived: result.outputAmount
      }
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [wallet, getSwapQuoteSOLtoH173K, executeSwap])
  
  /**
   * Swap H173K to get more SOL
   * @param {number} targetSOL - How much SOL to get
   * @returns {Object} - Swap result
   */
  const swapForSOL = useCallback(async (targetSOL) => {
    console.log(`🔄 swapForSOL: Getting ${targetSOL.toFixed(6)} SOL...`)
    
    // Check current SOL
    const currentLamports = await connection.getBalance(wallet.publicKey)
    const currentSOL = currentLamports / LAMPORTS_PER_SOL
    
    console.log(`💰 Current SOL balance: ${currentSOL.toFixed(6)} SOL`)
    
    // Need at least some SOL to pay for swap transaction fees
    const MIN_SOL_FOR_SWAP_TX = 0.003
    
    if (currentSOL < MIN_SOL_FOR_SWAP_TX) {
      throw new Error(`NO_SOL:Not enough SOL to execute swap. Have ${currentSOL.toFixed(6)} SOL, need at least ${MIN_SOL_FOR_SWAP_TX} SOL. Please deposit SOL first.`)
    }
    
    // Calculate how much H173K we need to swap
    const { h173kNeeded, quote } = await calculateSwapForSOL(targetSOL)
    
    // Check H173K balance
    const tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, wallet.publicKey)
    const tokenBalance = await connection.getTokenAccountBalance(tokenAccount)
    const h173kBalance = Number(tokenBalance.value.uiAmount)
    
    console.log(`🪙 H173K needed: ${h173kNeeded.toFixed(2)}, H173K balance: ${h173kBalance.toFixed(2)}`)
    
    if (h173kNeeded > h173kBalance) {
      throw new Error(`NO_H173K:Insufficient h173k to get more SOL. Need ${h173kNeeded.toFixed(2)} h173k, have ${h173kBalance.toFixed(2)} h173k. Please add more h173k to your wallet.`)
    }
    
    // Execute swap
    console.log(`🔄 Executing swap: ${h173kNeeded.toFixed(2)} H173K -> ~${targetSOL.toFixed(4)} SOL...`)
    
    const result = await executeSwap(quote, 'H173KtoSOL')
    console.log(`✅ Swap complete! Got ${result.outputAmount.toFixed(6)} SOL`)
    
    return {
      success: true,
      h173kUsed: result.inputAmount,
      solReceived: result.outputAmount,
      signature: result.signature
    }
  }, [connection, wallet, calculateSwapForSOL, executeSwap])
  
  /**
   * Execute an operation with automatic SOL replenishment
   * Simply retries with more SOL if operation fails (max 2 retries)
   * 
   * @param {Function} operation - Async function to execute
   * @param {Function} onSwap - Optional callback when swap occurs (for UI feedback)
   * @returns {any} - Result of the operation
   */
  const withAutoSOL = useCallback(async (operation, onSwap) => {
    if (!wallet?.publicKey) {
      throw new Error('Wallet not connected')
    }
    
    const MAX_RETRIES = 2
    let lastError = null
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      console.log(`🚀 withAutoSOL: Attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)
      
      try {
        // Try the operation
        return await operation()
      } catch (error) {
        lastError = error
        console.log(`❌ Attempt ${attempt + 1} failed:`, error?.message || error)
        
        // If this was the last retry, don't try to swap again
        if (attempt >= MAX_RETRIES) {
          console.log('❌ Max retries reached, giving up')
          break
        }
        
        // Try to get more SOL
        const solToGet = SOL_BUFFER * (attempt + 1) // Increase each retry: 0.006, 0.012
        console.log(`💡 Will try to swap for ${solToGet.toFixed(4)} SOL and retry...`)
        
        try {
          // Notify UI about swap
          if (onSwap) {
            onSwap({ status: 'swapping', attempt: attempt + 1 })
          }
          
          setLoading(true)
          const swapResult = await swapForSOL(solToGet)
          setLoading(false)
          
          // Notify UI about swap completion
          if (onSwap) {
            onSwap({ 
              status: 'swapped', 
              h173kUsed: swapResult.h173kUsed, 
              solReceived: swapResult.solReceived 
            })
          }
          
          // Wait a moment for balance to update
          await new Promise(r => setTimeout(r, 1500))
          
          console.log('🔄 Retrying operation...')
          // Continue to next iteration to retry
          
        } catch (swapError) {
          setLoading(false)
          console.log('❌ Swap failed:', swapError?.message)
          
          // Check if it's because no H173K or no SOL
          if (swapError?.message?.startsWith('NO_H173K:')) {
            throw new Error(swapError.message.replace('NO_H173K:', ''))
          }
          if (swapError?.message?.startsWith('NO_SOL:')) {
            throw new Error(swapError.message.replace('NO_SOL:', ''))
          }
          
          // Swap failed for other reason, throw original error
          throw lastError
        }
      }
    }
    
    // All retries exhausted
    throw lastError
  }, [wallet, swapForSOL])
  
  return {
    loading,
    error,
    quote,
    getSwapQuote,
    getSwapQuoteSOLtoH173K,
    executeSwap,
    calculateSwapForSOL,
    withAutoSOL,
    convertSOLtoH173K,
    fetchPoolData,
    MIN_SOL_FOR_SWAP
  }
}

/**
 * Get current H173K/SOL price from pool
 */
export async function getH173KPrice(connection) {
  try {
    const [vault0Balance, vault1Balance] = await Promise.all([
      connection.getTokenAccountBalance(POOL_CONFIG.token0Vault),
      connection.getTokenAccountBalance(POOL_CONFIG.token1Vault)
    ])
    
    const isH173KToken0 = POOL_CONFIG.token0Mint.equals(TOKEN_MINT)
    const h173kReserve = isH173KToken0 
      ? Number(vault0Balance.value.amount) 
      : Number(vault1Balance.value.amount)
    const solReserve = isH173KToken0 
      ? Number(vault1Balance.value.amount) 
      : Number(vault0Balance.value.amount)
    
    return (solReserve / LAMPORTS_PER_SOL) / (h173kReserve / Math.pow(10, TOKEN_DECIMALS))
  } catch {
    return null
  }
}
