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
  SystemProgram,
  ComputeBudgetProgram
} from '@solana/web3.js'
import { 
  TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  getAccount
} from '@solana/spl-token'
import { TOKEN_MINT, TOKEN_DECIMALS, getReplenishSettings } from '../constants'

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

// Minimum SOL required to execute a swap transaction.
// Real cost: WSOL ATA creation (0.00204) + priority fee + base fee.
const MIN_SOL_FOR_SWAP = 0.00204 + 0.000005 // ~0.002045

// SOL buffer added when replenishing
const SOL_BUFFER = 0.007

// Recognise a SOL-shortfall error specifically. MUST NOT match an SPL-Token
// "insufficient funds" (custom program error 0x1) — otherwise a token-side
// shortage would wrongly trigger an h173k→SOL swap and burn even more h173k.
function isInsufficientSolError(e) {
  const blob = (String(e?.message || e || '') + ' ' + (e?.logs || []).join(' ')).toLowerCase()
  // Token-program shortfall → NOT a SOL problem.
  if (
    blob.includes('custom program error: 0x1') ||
    (blob.includes('error: insufficient funds') && blob.includes('tokenkeg'))
  ) return false
  return (
    blob.includes('insufficient lamports') ||
    blob.includes('insufficient funds for rent') ||
    blob.includes('no record of a prior credit') ||
    blob.includes('debit an account')
  )
}

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
      
      // Add priority fee (compute budget) from settings
      const { swapFeeSol } = getReplenishSettings()
      const SWAP_COMPUTE_UNITS = 250_000
      if (swapFeeSol > 0) {
        const priorityFeeLamports = Math.round(swapFeeSol * LAMPORTS_PER_SOL)
        const microLamportsPerCU = Math.ceil((priorityFeeLamports * 1_000_000) / SWAP_COMPUTE_UNITS)
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: SWAP_COMPUTE_UNITS }))
        transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: microLamportsPerCU }))
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
    
    // swapFeeSol is the inviolable minimum – swap is exempt from this floor (it acquires more SOL)
    // but we need at least swapFeeSol + base fee to pay for this very transaction
    const { swapFeeSol: swapFeeFloor } = getReplenishSettings()
    // ✅ useSwap.js ~591
    const WSOL_ATA_RENT = 0.00204
    const MIN_SOL_FOR_SWAP_TX = swapFeeFloor + 0.000005 + WSOL_ATA_RENT  // = 0.002145 SOL
    
    if (currentSOL < MIN_SOL_FOR_SWAP_TX) {
      throw new Error(`NO_SOL:Not enough SOL to execute swap. Have ${currentSOL.toFixed(6)} SOL, need at least ${MIN_SOL_FOR_SWAP_TX.toFixed(6)} SOL. Please deposit a small amount of SOL first.`)
    }

    // Net cost of THIS swap tx. The WSOL account is created AND closed in the same
    // transaction, so its rent round-trips and is NOT a real cost — only base fee +
    // priority fee are. swapForSOL is the single source of truth for its own cost:
    // callers pass the NET SOL they want and we gross it up here.
    const swapCost = swapFeeFloor + 0.000005

    // Economical guard: never run a swap whose net yield would not exceed its own cost.
    // (Prevents burning h173k on a tx that nets ~0 SOL.)
    if (targetSOL <= swapCost) {
      console.log(`⏭️ swapForSOL skipped: target ${targetSOL.toFixed(6)} ≤ swap cost ${swapCost.toFixed(6)} — not economical`)
      return { success: false, skipped: true, h173kUsed: 0, solReceived: 0 }
    }

    // Ask the pool for the requested NET amount PLUS this tx's own cost, so the wallet
    // lands at `targetSOL` AFTER fees instead of below it.
    const grossTarget = targetSOL + swapCost

    // Calculate how much H173K we need to swap (for the gross output)
    const { h173kNeeded, quote } = await calculateSwapForSOL(grossTarget)
    
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
  const withAutoSOL = useCallback(async (operation, onSwap, extraSOLNeeded = 0) => {
    if (!wallet?.publicKey) {
      throw new Error('Wallet not connected')
    }

    const settings = getReplenishSettings()

    // === REPLENISH FLOOR ===
    // Minimum SOL needed to pay for the replenish swap transaction itself.
    // Guard: wallet must have at least this much to initiate a swap at all.
    const swapTxCost = settings.swapFeeSol + 0.000005

    // SOL the operation itself must have to execute: rents for accounts it creates
    // (extraSOLNeeded) plus a small tx-fee buffer. Operations that only pay a fee — or
    // that REFUND rent, like cancel — pass extraSOLNeeded≈0, so they are essentially free
    // and must NEVER be blocked by the swap-reserve logic below.
    const WSOL_ATA_RENT = 0.00204
    const FEE_BUFFER = 0.00005
    const operationCost = extraSOLNeeded + FEE_BUFFER

    // The swap itself needs SOL to bootstrap: fees + the temporary WSOL ATA rent
    // (~0.00204, reclaimed on close). Below this floor a swap cannot run at all.
    const swapFloor = WSOL_ATA_RENT + swapTxCost  // === MIN_SOL_FOR_SWAP_TX

    // Reserve we'd LIKE to keep so the NEXT swap can still bootstrap. This is a TARGET,
    // not a hard requirement — it may trigger a top-up but must never block an operation
    // the wallet can already afford. Hoisted so the reactive retry can reuse it.
    const BOOTSTRAP_RESERVE_MARGIN = 0.0003
    const reserveFloor = operationCost + swapFloor + BOOTSTRAP_RESERVE_MARGIN

    // === PROACTIVE CHECK ===
    // Swap before the operation ONLY when current SOL cannot fund it. We never
    // force-buy up to the comfort target, because that would drain h173k the
    // operation itself needs (e.g. the 2× escrow deposit).
    try {
      const currentLamports = await connection.getBalance(wallet.publicKey)
      const currentSOL = currentLamports / LAMPORTS_PER_SOL

      // Hard-fail ONLY when the operation is genuinely UNAFFORDABLE *and* we cannot even
      // bootstrap a swap to fix it. An affordable op (e.g. cancel, which only pays a fee
      // and refunds rent) is never blocked here, regardless of the reserve.
      if (currentSOL < operationCost && currentSOL < swapFloor) {
        throw new Error(`NO_SOL:Not enough SOL to auto-convert h173k. Have ${currentSOL.toFixed(6)} SOL, need at least ${swapFloor.toFixed(6)} SOL to start the conversion. Please deposit a small amount of SOL first.`)
      }

      // Swap when finishing the operation would leave SOL BELOW the bootstrap floor —
      // i.e. when currentSOL < operationCost + swapFloor. This is the MINIMAL trigger that
      // prevents depletion: it does NOT fire when SOL comfortably covers the operation and
      // still leaves a bootstrap reserve, but it DOES fire just before the wallet would
      // strand itself (so it can never run out of SOL while h173k is available to convert).
      // When it fires we top up to reserveFloor so a small reserve remains afterwards.
      const minSafeSOL = operationCost + swapFloor
      const needsSwap = currentSOL < minSafeSOL && currentSOL >= swapFloor
      if (needsSwap) {
        const neededSOL = reserveFloor - currentSOL
        if (neededSOL > 0) {
          console.log(`⚡ Proactive replenish: ${currentSOL.toFixed(6)} SOL → reserve ${reserveFloor.toFixed(6)} SOL (net deficit ${neededSOL.toFixed(6)})`)
          if (onSwap) onSwap({ status: 'swapping', attempt: 0 })
          try {
            setLoading(true)
            const swapResult = await swapForSOL(neededSOL)
            setLoading(false)
            if (swapResult?.skipped) {
              console.log('⚡ Proactive swap skipped (not economical) — proceeding without it')
            } else {
              if (onSwap) onSwap({ status: 'swapped', h173kUsed: swapResult.h173kUsed, solReceived: swapResult.solReceived })
              await new Promise(r => setTimeout(r, 1500))

              // === POST-SWAP SLIPPAGE CHECK ===
              // Only top up if still short of the OPERATION FLOOR (not the comfort target).
              // A tiny remaining shortfall is auto-skipped by swapForSOL's economical guard.
              try {
                const afterLamports = await connection.getBalance(wallet.publicKey)
                const afterSOL = afterLamports / LAMPORTS_PER_SOL
                const stillNeeded = reserveFloor - afterSOL
                if (stillNeeded > 0 && afterSOL >= swapTxCost) {
                  console.log(`⚡ Slippage top-up: ${afterSOL.toFixed(6)} SOL still below floor by ${stillNeeded.toFixed(6)} SOL`)
                  if (onSwap) onSwap({ status: 'swapping', attempt: 0 })
                  setLoading(true)
                  const topUpResult = await swapForSOL(stillNeeded)
                  setLoading(false)
                  if (!topUpResult?.skipped && onSwap) onSwap({ status: 'swapped', h173kUsed: topUpResult.h173kUsed, solReceived: topUpResult.solReceived })
                  await new Promise(r => setTimeout(r, 1500))
                }
              } catch (topUpErr) {
                setLoading(false)
                if (topUpErr?.message?.startsWith('NO_H173K:') || topUpErr?.message?.startsWith('NO_SOL:')) throw topUpErr
                console.log('Warning: Slippage top-up failed, continuing:', topUpErr?.message)
              }
            }
          } catch (swapErr) {
            setLoading(false)
            if (swapErr?.message?.startsWith('NO_H173K:') || swapErr?.message?.startsWith('NO_SOL:')) throw swapErr
            console.log('Warning: Proactive swap failed, continuing:', swapErr?.message)
          }
        }
      }
    } catch (err) {
      // Surface fatal fund shortfalls as clean, user-facing messages; swallow only
      // transient issues (e.g. a failed getBalance) so the operation can still try.
      const m = err?.message || ''
      if (m.startsWith('NO_H173K:')) throw new Error(m.replace('NO_H173K:', ''))
      if (m.startsWith('NO_SOL:')) throw new Error(m.replace('NO_SOL:', ''))
    }

    const MAX_RETRIES = 2
    let lastError = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      console.log(`🚀 withAutoSOL: Attempt ${attempt + 1}/${MAX_RETRIES + 1}...`)

      try {
        return await operation()
      } catch (error) {
        lastError = error
        console.log(`❌ Attempt ${attempt + 1} failed:`, error?.message || error)

        if (attempt >= MAX_RETRIES) {
          console.log('❌ Max retries reached, giving up')
          break
        }

        // Only a genuine SOL shortfall justifies a swap-and-retry. A token-side
        // failure (e.g. SPL-Token 0x1 on the escrow deposit) must surface immediately —
        // swapping more h173k for SOL would only deepen the token shortage.
        if (!isInsufficientSolError(error)) {
          console.log('⛔ Not a SOL-shortfall error — not swapping, surfacing the error')
          throw error
        }

        // Re-fetch balance and buy only the NET deficit up to the operation floor.
        let solToGet = reserveFloor
        try {
          const lamports = await connection.getBalance(wallet.publicKey)
          const currentSOL = lamports / LAMPORTS_PER_SOL
          solToGet = reserveFloor - currentSOL
        } catch { /* fall back to reserveFloor */ }

        // Already at/above the floor → more SOL cannot help. Stop rather than spin.
        if (solToGet <= 0) {
          console.log('⛔ Already at operation floor — extra SOL would not help, giving up')
          throw lastError
        }

        console.log(`💡 Reactive replenish: getting ${solToGet.toFixed(6)} SOL (reserve=${reserveFloor.toFixed(6)})`)

        let swapResult
        try {
          if (onSwap) onSwap({ status: 'swapping', attempt: attempt + 1 })
          setLoading(true)
          swapResult = await swapForSOL(solToGet)
          setLoading(false)
        } catch (swapError) {
          setLoading(false)
          console.log('❌ Swap failed:', swapError?.message)
          if (swapError?.message?.startsWith('NO_H173K:')) throw new Error(swapError.message.replace('NO_H173K:', ''))
          if (swapError?.message?.startsWith('NO_SOL:')) throw new Error(swapError.message.replace('NO_SOL:', ''))
          throw lastError
        }

        // Swap wasn't economical (net yield ≤ its own cost) → don't burn h173k for nothing.
        if (swapResult?.skipped) {
          console.log('⛔ Reactive swap not economical — giving up rather than burning h173k')
          throw lastError
        }

        if (onSwap) onSwap({ status: 'swapped', h173kUsed: swapResult.h173kUsed, solReceived: swapResult.solReceived })
        await new Promise(r => setTimeout(r, 1500))
        console.log('🔄 Retrying operation...')
      }
    }

    throw lastError
  }, [wallet, swapForSOL, connection])

  /**
   * Read-only estimate of how much h173k the *proactive* auto-SOL replenishment
   * inside withAutoSOL would consume for an operation needing `extraSOLNeeded` SOL.
   * Performs NO swap and NO state change — it only mirrors withAutoSOL's TARGET /
   * threshold math so callers can pre-validate funds before starting the operation.
   *
   * @returns {Promise<{willSwap:boolean, h173kForSwap:number, canSwap:boolean,
   *                     currentSOL:number, estimateFailed?:boolean}>}
   *   - willSwap: a replenish swap would be triggered
   *   - canSwap: wallet has enough SOL to even initiate that swap
   *   - h173kForSwap: estimated h173k the swap would spend (0 if none / unknown)
   *   - estimateFailed: balance or pool quote couldn't be read (caller should fall
   *                     back to existing behavior instead of hard-blocking)
   */
  const estimateAutoSOLCostH173K = useCallback(async (extraSOLNeeded = 0) => {
    if (!wallet?.publicKey) {
      return { willSwap: false, h173kForSwap: 0, canSwap: true, currentSOL: 0 }
    }

    const settings = getReplenishSettings()
    const swapTxCost = settings.swapFeeSol + 0.000005
    const WSOL_ATA_RENT = 0.00204
    const FEE_BUFFER = 0.00005
    const BOOTSTRAP_RESERVE_MARGIN = 0.0003
    // Mirror withAutoSOL exactly: operationCost = what the op must have to run; swapFloor =
    // bootstrap minimum for a swap; reserveFloor = op + reserve target.
    const operationCost = extraSOLNeeded + FEE_BUFFER
    const swapFloor = WSOL_ATA_RENT + swapTxCost  // === MIN_SOL_FOR_SWAP_TX
    const reserveFloor = operationCost + swapFloor + BOOTSTRAP_RESERVE_MARGIN

    let currentSOL = 0
    try {
      const lamports = await connection.getBalance(wallet.publicKey)
      currentSOL = lamports / LAMPORTS_PER_SOL
    } catch {
      return { willSwap: false, h173kForSwap: 0, canSwap: true, currentSOL: 0, estimateFailed: true }
    }

    // No swap needed only when SOL covers the operation AND still leaves the bootstrap
    // floor afterwards (currentSOL - operationCost >= swapFloor).
    const minSafeSOL = operationCost + swapFloor
    if (currentSOL >= minSafeSOL) {
      return { willSwap: false, h173kForSwap: 0, canSwap: true, currentSOL }
    }

    // A swap is needed (to afford the op, or to avoid post-op depletion). Below the
    // bootstrap floor it cannot run → block only if the op itself is unaffordable; an
    // affordable op (e.g. cancel, extraSOLNeeded≈0) just proceeds without a reserve top-up.
    if (currentSOL < swapFloor) {
      if (currentSOL < operationCost) {
        return { willSwap: true, h173kForSwap: 0, canSwap: false, currentSOL } // → errNeedSolDeposit
      }
      return { willSwap: false, h173kForSwap: 0, canSwap: true, currentSOL }
    }

    // Can bootstrap → a swap will run up to the reserve floor (op + reserve). swapForSOL
    // grosses the request up by its own tx cost, so estimate for that.
    const neededSOL = reserveFloor - currentSOL
    if (neededSOL <= 0) {
      return { willSwap: false, h173kForSwap: 0, canSwap: true, currentSOL }
    }

    try {
      const { h173kNeeded } = await calculateSwapForSOL(neededSOL + swapTxCost)
      return { willSwap: true, h173kForSwap: h173kNeeded, canSwap: true, currentSOL }
    } catch {
      // Pool/RPC quote unavailable — report no usable estimate.
      return { willSwap: true, h173kForSwap: 0, canSwap: true, currentSOL, estimateFailed: true }
    }
  }, [wallet?.publicKey, connection, calculateSwapForSOL])

  return {
    loading,
    error,
    quote,
    getSwapQuote,
    getSwapQuoteSOLtoH173K,
    executeSwap,
    calculateSwapForSOL,
    swapForSOL,
    withAutoSOL,
    estimateAutoSOLCostH173K,
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
