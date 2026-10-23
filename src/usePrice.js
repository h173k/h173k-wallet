/**
 * h173k price — read directly from the on-chain h173k-USDT Raydium CPMM pool.
 *
 * Price (USD per h173k) = USDT reserve / h173k reserve, taken straight from the
 * pool's vault balances. No third-party price API. USDT ≈ $1, so the pool ratio
 * is the USD price.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { PublicKey } from '@solana/web3.js'
import { PRICE_UPDATE_INTERVAL, TOKEN_MINT, TOKEN_DECIMALS, USDT_DECIMALS } from './constants'
import { tokenAmountOf } from './rpcBatch'

// h173k-USDT Raydium CPMM pool
const POOL_ID = new PublicKey('J9ED7D3pR7Uw5W6Y52p1Mq3Gfkmumg8fHRvLEiHLL2S7')
// USDT (SPL) mint on Solana — used to confirm the pool's quote token.
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')

// Raydium CPMM PoolState layout offsets (same layout used by the swap pool).
const OFF = { token0Vault: 72, token1Vault: 104, token0Mint: 168, token1Mint: 200 }

/**
 * h173k price from the h173k/USDT pool reserves.
 * `active` — read only when true (wallet unlocked and on screen). While inactive no
 * request is made at all and the last known price is kept; becoming active refreshes
 * immediately.
 */
export function useTokenPrice(connection, active = true) {
  const [price, setPrice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const intervalRef = useRef(null)
  // Cache the pool's resolved vaults so we only parse the pool account once.
  const poolRef = useRef(null) // { h173kVault: PublicKey, quoteVault: PublicKey }

  const resolvePool = useCallback(async () => {
    if (poolRef.current) return poolRef.current
    const acc = await connection.getAccountInfo(POOL_ID)
    if (!acc || !acc.data) throw new Error('Pool account not found')
    const data = acc.data
    const pk = (start) => new PublicKey(data.subarray(start, start + 32))

    const token0Mint = pk(OFF.token0Mint)
    const token1Mint = pk(OFF.token1Mint)
    const token0Vault = pk(OFF.token0Vault)
    const token1Vault = pk(OFF.token1Vault)

    let h173kVault, quoteVault, quoteMint
    if (token0Mint.equals(TOKEN_MINT)) {
      h173kVault = token0Vault; quoteVault = token1Vault; quoteMint = token1Mint
    } else if (token1Mint.equals(TOKEN_MINT)) {
      h173kVault = token1Vault; quoteVault = token0Vault; quoteMint = token0Mint
    } else {
      // Layout/assumption is wrong — refuse to produce a (possibly bogus) price.
      throw new Error('h173k mint not found in pool (unexpected pool layout)')
    }
    if (!quoteMint.equals(USDT_MINT)) {
      throw new Error('Pool quote token is not USDT')
    }
    poolRef.current = { h173kVault, quoteVault }
    return poolRef.current
  }, [connection])

  const fetchPrice = useCallback(async () => {
    if (!connection) return
    try {
      const { h173kVault, quoteVault } = await resolvePool()

      // Both vaults in ONE request (1 RPC credit instead of 2).
      const [h173kAcc, usdtAcc] = await connection.getMultipleAccountsInfo([h173kVault, quoteVault], 'confirmed')
      if (!h173kAcc || !usdtAcc) throw new Error('Pool vault not found')
      const h173kReserve = Number(tokenAmountOf(h173kAcc)) / Math.pow(10, TOKEN_DECIMALS)
      const usdtReserve = Number(tokenAmountOf(usdtAcc)) / Math.pow(10, USDT_DECIMALS)

      if (h173kReserve > 0 && usdtReserve > 0 && isFinite(usdtReserve / h173kReserve)) {
        setPrice(usdtReserve / h173kReserve)
        setLastUpdated(new Date())
        setError(null)
      } else {
        // Keep the last good price; just flag the issue.
        setError('Price unavailable')
      }
    } catch (err) {
      console.error('Error reading pool price:', err)
      // Keep the last good price on transient RPC errors.
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [connection, resolvePool])

  useEffect(() => {
    if (!connection || !active) return
    fetchPrice()
    intervalRef.current = setInterval(fetchPrice, PRICE_UPDATE_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [connection, fetchPrice, active])

  const toUSD = useCallback((tokenAmount) => {
    if (price === null || tokenAmount === null || tokenAmount === undefined) return null
    return tokenAmount * price
  }, [price])

  return { price, loading, error, lastUpdated, toUSD, refetch: fetchPrice }
}
