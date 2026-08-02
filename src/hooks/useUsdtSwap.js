/**
 * h173k Wallet - h173k <-> USDT Raydium CPMM pool swap.
 *
 * This hook powers two features:
 *   1. Auto-conversion of any incoming USDT into h173k (full balance, no slippage limit).
 *   2. "Send as USDT": convert a chosen h173k amount into USDT, then transfer the USDT.
 *
 * It targets the SAME on-chain pool that usePrice.js reads for pricing
 * (USDT_POOL_ID). Every pool account (ammConfig, both vaults, observation key and the
 * token0/token1 ordering) is resolved DYNAMICALLY from the pool account at runtime, so
 * nothing about this specific pool is hardcoded beyond its address and the USDT mint.
 *
 * Both sides of this pool are plain SPL tokens (h173k and USDT), so — unlike the
 * h173k<->SOL swap in useSwap.js — there is no WSOL wrapping/unwrapping here.
 */

import { useState, useCallback, useRef } from 'react'
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} from '@solana/spl-token'
import {
  TOKEN_MINT,
  TOKEN_DECIMALS,
  USDT_MINT,
  USDT_DECIMALS,
  USDT_POOL_ID,
  getReplenishSettings,
} from '../constants'

// Raydium CPMM program (same program as the h173k-SOL pool).
const RAYDIUM_CPMM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C')

// Raydium CPMM PoolState layout offsets (same layout used by useSwap.js / usePrice.js).
const OFF = {
  ammConfig: 8,
  token0Vault: 72,
  token1Vault: 104,
  token0Mint: 168,
  token1Mint: 200,
  observationKey: 296,
}

// CPMM fee is 0.25% (25 bps) — matches the h173k-SOL swap math.
const FEE_BPS = 25n

// swap_base_input discriminator.
const SWAP_DISCRIMINATOR = Buffer.from([143, 190, 90, 218, 196, 30, 51, 222])

// Compute-unit budget for a CPMM swap (mirrors useSwap.js).
const SWAP_COMPUTE_UNITS = 250_000

// Rent for a freshly created SPL token account (ATA), in SOL.
const ATA_RENT_SOL = 0.00204

// ---------------------------------------------------------------------------
// Cross-component guard.
//
// A "send as USDT" flow briefly holds USDT in the wallet between converting
// h173k->USDT and transferring it out. During that window the background
// auto-converter (which turns any incoming USDT into h173k) must NOT grab it and
// convert it back — otherwise the send would round-trip and lose value. This
// counter lets the send flow pause the auto-converter for its duration.
// ---------------------------------------------------------------------------
let _sendAsUsdtInFlight = 0
export function beginSendAsUsdt() { _sendAsUsdtInFlight++ }
export function endSendAsUsdt() { _sendAsUsdtInFlight = Math.max(0, _sendAsUsdtInFlight - 1) }
export function isSendAsUsdtInFlight() { return _sendAsUsdtInFlight > 0 }

function getCPMMAuthority() {
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    RAYDIUM_CPMM
  )
  return authority
}

export function useUsdtSwap(connection, wallet) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Cache the parsed pool once — its account layout never changes.
  const poolRef = useRef(null)

  /**
   * Read the pool account and extract every address the swap needs.
   * Confirms the pool actually pairs h173k with USDT before trusting it.
   */
  const resolvePool = useCallback(async () => {
    if (poolRef.current) return poolRef.current

    const acc = await connection.getAccountInfo(USDT_POOL_ID)
    if (!acc || !acc.data) throw new Error('USDT pool account not found')
    const data = acc.data
    const pk = (start) => new PublicKey(data.subarray(start, start + 32))

    const ammConfig = pk(OFF.ammConfig)
    const token0Vault = pk(OFF.token0Vault)
    const token1Vault = pk(OFF.token1Vault)
    const token0Mint = pk(OFF.token0Mint)
    const token1Mint = pk(OFF.token1Mint)
    const observationKey = pk(OFF.observationKey)

    let h173kIsToken0, h173kVault, usdtVault, quoteMint
    if (token0Mint.equals(TOKEN_MINT)) {
      h173kIsToken0 = true
      h173kVault = token0Vault
      usdtVault = token1Vault
      quoteMint = token1Mint
    } else if (token1Mint.equals(TOKEN_MINT)) {
      h173kIsToken0 = false
      h173kVault = token1Vault
      usdtVault = token0Vault
      quoteMint = token0Mint
    } else {
      throw new Error('h173k mint not found in USDT pool (unexpected pool layout)')
    }
    if (!quoteMint.equals(USDT_MINT)) {
      throw new Error('Pool quote token is not USDT')
    }

    poolRef.current = {
      ammConfig,
      observationKey,
      h173kIsToken0,
      h173kVault,
      usdtVault,
      token0Mint,
      token1Mint,
    }
    return poolRef.current
  }, [connection])

  /**
   * Fetch current pool reserves (raw base units).
   */
  const fetchReserves = useCallback(async (pool) => {
    const [h173kBal, usdtBal] = await Promise.all([
      connection.getTokenAccountBalance(pool.h173kVault),
      connection.getTokenAccountBalance(pool.usdtVault),
    ])
    return {
      h173kReserve: BigInt(h173kBal.value.amount),
      usdtReserve: BigInt(usdtBal.value.amount),
    }
  }, [connection])

  /**
   * Constant-product output with the 0.25% CPMM fee applied to the input.
   */
  const calcOutput = useCallback((amountIn, reserveIn, reserveOut) => {
    const fee = (amountIn * FEE_BPS) / 10000n
    const amountInAfterFee = amountIn - fee
    return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee)
  }, [])

  /**
   * Quote a swap in either direction.
   * @param {'h173ktoUSDT'|'USDTtoH173K'} direction
   * @param {number} inputAmount - human amount of the INPUT token
   * @returns {Promise<{inputAmount, outputAmount, priceImpact, inputRaw, outputRaw, pool}>}
   */
  const getQuote = useCallback(async (direction, inputAmount) => {
    const pool = await resolvePool()
    const { h173kReserve, usdtReserve } = await fetchReserves(pool)

    let inputRaw, reserveIn, reserveOut, outDecimals
    if (direction === 'h173ktoUSDT') {
      inputRaw = BigInt(Math.floor(inputAmount * Math.pow(10, TOKEN_DECIMALS)))
      reserveIn = h173kReserve
      reserveOut = usdtReserve
      outDecimals = USDT_DECIMALS
    } else {
      inputRaw = BigInt(Math.floor(inputAmount * Math.pow(10, USDT_DECIMALS)))
      reserveIn = usdtReserve
      reserveOut = h173kReserve
      outDecimals = TOKEN_DECIMALS
    }

    const outputRaw = reserveIn > 0n ? calcOutput(inputRaw, reserveIn, reserveOut) : 0n
    const outputAmount = Number(outputRaw) / Math.pow(10, outDecimals)
    // Price impact from the constant-product curve: how big the input is vs the input reserve.
    const priceImpact = reserveIn > 0n
      ? (Number(inputRaw) / Number(reserveIn)) * 100
      : 0

    return { inputAmount, outputAmount, priceImpact, inputRaw, outputRaw, pool }
  }, [resolvePool, fetchReserves, calcOutput])

  /**
   * Build the CPMM swap_base_input instruction for this pool.
   */
  const buildSwapIx = useCallback((pool, accounts, amountInRaw, minOutRaw) => {
    const authority = getCPMMAuthority()

    const {
      userInputAccount,
      userOutputAccount,
      inputVault,
      outputVault,
      inputMint,
      outputMint,
    } = accounts

    const keys = [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: pool.ammConfig, isSigner: false, isWritable: false },
      { pubkey: USDT_POOL_ID, isSigner: false, isWritable: true },
      { pubkey: userInputAccount, isSigner: false, isWritable: true },
      { pubkey: userOutputAccount, isSigner: false, isWritable: true },
      { pubkey: inputVault, isSigner: false, isWritable: true },
      { pubkey: outputVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: inputMint, isSigner: false, isWritable: false },
      { pubkey: outputMint, isSigner: false, isWritable: false },
      { pubkey: pool.observationKey, isSigner: false, isWritable: true },
    ]

    const data = Buffer.alloc(24)
    SWAP_DISCRIMINATOR.copy(data, 0)
    data.writeBigUInt64LE(BigInt(amountInRaw), 8)
    data.writeBigUInt64LE(BigInt(minOutRaw), 16)

    return new TransactionInstruction({ programId: RAYDIUM_CPMM, keys, data })
  }, [wallet])

  /**
   * Execute a swap on the USDT pool.
   * @param {'h173ktoUSDT'|'USDTtoH173K'} dir
   * @param {bigint|number} amountInRaw
   * @param {bigint|number} minOutRaw  - 0 means "no slippage limit" (fill at any price)
   * @returns {Promise<{signature, outputDeltaRaw}>} outputDeltaRaw = actual output received (raw)
   */
  const executeSwap = useCallback(async (dir, amountInRaw, minOutRaw) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected')

    const pool = await resolvePool()

    const userH173K = await getAssociatedTokenAddress(TOKEN_MINT, wallet.publicKey)
    const userUSDT = await getAssociatedTokenAddress(USDT_MINT, wallet.publicKey)

    let userInputAccount, userOutputAccount, inputVault, outputVault, inputMint, outputMint, outputMintPk
    if (dir === 'h173ktoUSDT') {
      userInputAccount = userH173K
      userOutputAccount = userUSDT
      inputVault = pool.h173kVault
      outputVault = pool.usdtVault
      inputMint = TOKEN_MINT
      outputMint = USDT_MINT
      outputMintPk = USDT_MINT
    } else {
      userInputAccount = userUSDT
      userOutputAccount = userH173K
      inputVault = pool.usdtVault
      outputVault = pool.h173kVault
      inputMint = USDT_MINT
      outputMint = TOKEN_MINT
      outputMintPk = TOKEN_MINT
    }

    const transaction = new Transaction()

    // Priority fee, same policy as the h173k-SOL swap.
    const { swapFeeSol } = getReplenishSettings()
    if (swapFeeSol > 0) {
      const priorityFeeLamports = Math.round(swapFeeSol * LAMPORTS_PER_SOL)
      const microLamportsPerCU = Math.ceil((priorityFeeLamports * 1_000_000) / SWAP_COMPUTE_UNITS)
      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: SWAP_COMPUTE_UNITS }))
      transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: microLamportsPerCU }))
    }

    // Create the output ATA if it doesn't exist yet.
    let outputExisted = true
    try {
      await getAccount(connection, userOutputAccount)
    } catch {
      outputExisted = false
      transaction.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userOutputAccount,
          wallet.publicKey,
          outputMintPk
        )
      )
    }

    // Read the output balance BEFORE the swap so we can return the exact amount received.
    let beforeRaw = 0n
    if (outputExisted) {
      try {
        const bal = await connection.getTokenAccountBalance(userOutputAccount)
        beforeRaw = BigInt(bal.value.amount)
      } catch { beforeRaw = 0n }
    }

    transaction.add(
      buildSwapIx(
        pool,
        { userInputAccount, userOutputAccount, inputVault, outputVault, inputMint, outputMint },
        BigInt(amountInRaw),
        BigInt(minOutRaw)
      )
    )

    const { blockhash } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.feePayer = wallet.publicKey

    const signed = await wallet.signTransaction(transaction)
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    })
    await connection.confirmTransaction(signature, 'confirmed')

    // Measure the actual output received (handles slippage precisely).
    let outputDeltaRaw = 0n
    try {
      const bal = await connection.getTokenAccountBalance(userOutputAccount)
      outputDeltaRaw = BigInt(bal.value.amount) - beforeRaw
    } catch { outputDeltaRaw = 0n }

    return { signature, outputDeltaRaw }
  }, [connection, wallet, resolvePool, buildSwapIx])

  /**
   * Read the wallet's raw USDT balance (0n if no account).
   */
  const getUsdtBalanceRaw = useCallback(async () => {
    if (!wallet?.publicKey) return 0n
    try {
      const ata = await getAssociatedTokenAddress(USDT_MINT, wallet.publicKey)
      const bal = await connection.getTokenAccountBalance(ata)
      return BigInt(bal.value.amount)
    } catch {
      return 0n
    }
  }, [connection, wallet])

  /**
   * Convert the ENTIRE USDT balance into h173k, with NO slippage limit (minOut = 0).
   * Returns { skipped } when there is nothing (meaningful) to convert.
   */
  const convertAllUsdtToH173K = useCallback(async () => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected')
    setLoading(true)
    setError(null)
    try {
      const usdtRaw = await getUsdtBalanceRaw()
      const usdtAmount = Number(usdtRaw) / Math.pow(10, USDT_DECIMALS)
      if (usdtRaw <= 0n) {
        return { skipped: true, usdtIn: 0, h173kReceived: 0 }
      }

      // Full conversion, fill at any price (bez uważania na slippage).
      const { signature, outputDeltaRaw } = await executeSwap('USDTtoH173K', usdtRaw, 0)
      const h173kReceived = Number(outputDeltaRaw) / Math.pow(10, TOKEN_DECIMALS)

      return { skipped: false, signature, usdtIn: usdtAmount, h173kReceived }
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [wallet, getUsdtBalanceRaw, executeSwap])

  /**
   * Convert a chosen h173k amount into USDT (NO slippage limit) and return the USDT received.
   * @returns {Promise<{signature, usdtReceivedRaw, usdtReceived, h173kUsed}>}
   */
  const convertH173KtoUSDT = useCallback(async (h173kAmount) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected')
    const amountInRaw = BigInt(Math.floor(h173kAmount * Math.pow(10, TOKEN_DECIMALS)))
    const { signature, outputDeltaRaw } = await executeSwap('h173ktoUSDT', amountInRaw, 0)
    return {
      signature,
      usdtReceivedRaw: outputDeltaRaw,
      usdtReceived: Number(outputDeltaRaw) / Math.pow(10, USDT_DECIMALS),
      h173kUsed: h173kAmount,
    }
  }, [wallet, executeSwap])

  /**
   * Plain SPL transfer of a raw USDT amount to a recipient, creating the recipient's
   * USDT ATA if needed. Kept separate from the swap so each step is retry-safe.
   */
  const transferUsdt = useCallback(async (recipientPubkey, amountRaw) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected')
    const senderUsdt = await getAssociatedTokenAddress(USDT_MINT, wallet.publicKey)
    const recipientUsdt = await getAssociatedTokenAddress(USDT_MINT, recipientPubkey)

    const transaction = new Transaction()
    try {
      await getAccount(connection, recipientUsdt)
    } catch {
      transaction.add(
        createAssociatedTokenAccountInstruction(wallet.publicKey, recipientUsdt, recipientPubkey, USDT_MINT)
      )
    }
    transaction.add(
      createTransferInstruction(senderUsdt, recipientUsdt, wallet.publicKey, BigInt(amountRaw))
    )

    const { blockhash } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.feePayer = wallet.publicKey

    const signed = await wallet.signTransaction(transaction)
    const signature = await connection.sendRawTransaction(signed.serialize())
    await connection.confirmTransaction(signature, 'confirmed')
    return signature
  }, [connection, wallet])

  /**
   * Read-only estimate of the SOL a "send as USDT" of `h173kAmount` will incur, so the
   * caller can pass it to withAutoSOL as extraSOLNeeded (which then reserves the matching
   * h173k). Covers: sender USDT ATA rent (if missing), recipient USDT ATA rent (if missing),
   * plus the swap + transfer priority/base fees.
   */
  const estimateSendAsUsdtSOL = useCallback(async (recipientPubkey) => {
    const { swapFeeSol } = getReplenishSettings()
    const BASE_FEE = 0.000005
    let extra = swapFeeSol + BASE_FEE * 2 // swap tx + transfer tx

    try {
      const senderUsdt = await getAssociatedTokenAddress(USDT_MINT, wallet.publicKey)
      try { await getAccount(connection, senderUsdt) } catch { extra += ATA_RENT_SOL }
    } catch { extra += ATA_RENT_SOL }

    if (recipientPubkey) {
      try {
        const recipientUsdt = await getAssociatedTokenAddress(USDT_MINT, recipientPubkey)
        try { await getAccount(connection, recipientUsdt) } catch { extra += ATA_RENT_SOL }
      } catch { extra += ATA_RENT_SOL }
    }

    return extra
  }, [connection, wallet])

  return {
    loading,
    error,
    getQuote,
    getUsdtBalanceRaw,
    convertAllUsdtToH173K,
    convertH173KtoUSDT,
    transferUsdt,
    estimateSendAsUsdtSOL,
  }
}
