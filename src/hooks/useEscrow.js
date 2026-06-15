import { useCallback, useState, useRef } from 'react'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction
} from '@solana/spl-token'
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
import { PROGRAM_ID, TOKEN_MINT, TOKEN_DECIMALS, OfferStatus } from '../constants'
import { IDL } from '../idl'
import { translate } from '../i18n'
import { 
  getBuyerIndexPDA, 
  getSellerIndexPDA,
  getOfferPDA, 
  getEscrowVaultAuthorityPDA, 
  hashCode,
  toTokenAmount,
  fromTokenAmount,
  parseOfferStatus
} from '../utils'
import {
  getReferrer,
  calculateReferralBonusLamports,
  getLastKnownPrice,
  storeLastKnownPrice
} from '../referral'
import { getH173KPrice } from './useSwap'

// ============================================================================
// HELPER: GET PRICE FOR REFERRAL CALCULATIONS
// ============================================================================

/**
 * Get price for referral bonus calculation from multiple sources
 * Priority: 1. Provided price, 2. Last known price from localStorage, 3. Direct pool price
 * @param {Connection} connection - Solana connection
 * @param {number|null} providedPrice - Price passed as parameter
 * @returns {Promise<number|null>} Price in SOL per H173K token
 */
async function getReferralPrice(connection, providedPrice) {
  // 1. Use provided price if available
  if (providedPrice && providedPrice > 0) {
    console.log('🎁 Using provided price:', providedPrice)
    return providedPrice
  }
  
  // 2. Try last known price from localStorage
  const lastKnown = getLastKnownPrice()
  if (lastKnown && lastKnown > 0) {
    console.log('🎁 Using last known price:', lastKnown)
    return lastKnown
  }
  
  // 3. Fetch price directly from Raydium pool
  console.log('🎁 Fetching price from pool...')
  try {
    const poolPrice = await getH173KPrice(connection)
    if (poolPrice && poolPrice > 0) {
      console.log('🎁 Got price from pool:', poolPrice)
      // Store it for future use
      storeLastKnownPrice(poolPrice)
      return poolPrice
    }
  } catch (err) {
    console.warn('🎁 Failed to fetch pool price:', err.message)
  }
  
  console.warn('🎁 No price available from any source')
  return null
}

// ============================================================================
// LOCAL STORAGE KEYS & CACHE MANAGEMENT
// ============================================================================

const OFFERS_CACHE_KEY = 'h173k_offers_cache'
const LAST_SYNC_KEY = 'h173k_last_sync'

// Limits
const MAX_OPEN_CONTRACTS = 50   // max simultaneously open (active) contracts per user
const MAX_ONCHAIN_FETCH = 100   // max contracts verified against the blockchain per list load
const MAX_CACHE_HISTORY = 200   // max offers kept in localStorage per wallet (oldest evicted)
const MULTI_FETCH_CHUNK = 100   // getMultipleAccounts hard limit per request

// Rotating cursor for paginated verification of suspected-stale offers (per wallet)
const VERIFY_CURSOR_KEY = 'h173k_verify_cursor'

function loadVerifyCursor(walletPubkey) {
  try {
    const raw = localStorage.getItem(VERIFY_CURSOR_KEY)
    if (!raw) return 0
    const data = JSON.parse(raw)
    return Number(data[walletPubkey]) || 0
  } catch {
    return 0
  }
}

function saveVerifyCursor(walletPubkey, cursor) {
  try {
    const raw = localStorage.getItem(VERIFY_CURSOR_KEY)
    const data = raw ? JSON.parse(raw) : {}
    data[walletPubkey] = cursor
    localStorage.setItem(VERIFY_CURSOR_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

/**
 * Load cached offers from localStorage
 */
function loadCachedOffers(walletPubkey) {
  try {
    const cached = localStorage.getItem(OFFERS_CACHE_KEY)
    if (!cached) return {}
    const data = JSON.parse(cached)
    // Return only offers for this wallet
    return data[walletPubkey] || {}
  } catch (err) {
    console.error('Error loading cached offers:', err)
    return {}
  }
}

/**
 * Recency key used for cache eviction (most recent activity first)
 */
function offerRecency(o) {
  return (o && (o.terminalAt || o.lastUpdated)) || 0
}

/**
 * Keep cache within MAX_CACHE_HISTORY entries per wallet.
 * Open (non-terminal) offers are always kept; the oldest terminal offers are
 * evicted first, so adding a new offer pushes out the oldest one at the limit.
 */
function pruneOffers(offers) {
  const keys = Object.keys(offers)
  if (keys.length <= MAX_CACHE_HISTORY) return offers

  const open = keys.filter(k => !offers[k].isTerminal)
  const terminal = keys
    .filter(k => offers[k].isTerminal)
    .sort((a, b) => offerRecency(offers[b]) - offerRecency(offers[a])) // newest first

  const keepTerminal = terminal.slice(0, Math.max(0, MAX_CACHE_HISTORY - open.length))
  const keep = new Set([...open, ...keepTerminal])

  const pruned = {}
  for (const k of keep) pruned[k] = offers[k]
  return pruned
}

/**
 * Save offers to localStorage cache (pruned to MAX_CACHE_HISTORY per wallet)
 */
function saveCachedOffers(walletPubkey, offers) {
  try {
    const cached = localStorage.getItem(OFFERS_CACHE_KEY)
    const data = cached ? JSON.parse(cached) : {}
    data[walletPubkey] = pruneOffers(offers)
    localStorage.setItem(OFFERS_CACHE_KEY, JSON.stringify(data))
  } catch (err) {
    console.error('Error saving cached offers:', err)
  }
}

/**
 * Update single offer in cache
 */
function updateCachedOffer(walletPubkey, offerPubkey, offerData) {
  const cached = loadCachedOffers(walletPubkey)
  cached[offerPubkey] = {
    ...cached[offerPubkey],
    ...offerData,
    lastUpdated: Date.now()
  }
  saveCachedOffers(walletPubkey, cached)
}

/**
 * Mark offer as terminal state in cache (completed/burned/cancelled)
 */
function markOfferTerminal(walletPubkey, offerPubkey, status) {
  const cached = loadCachedOffers(walletPubkey)
  if (cached[offerPubkey]) {
    cached[offerPubkey] = {
      ...cached[offerPubkey],
      status,
      isTerminal: true,
      terminalAt: Date.now()
    }
    saveCachedOffers(walletPubkey, cached)
  }
}

/**
 * Serialize offer data for cache (convert PublicKeys to strings, BN to numbers)
 */
function serializeOffer(offer, pubkey) {
  return {
    publicKey: pubkey.toString(),
    buyer: offer.buyer.toString(),
    seller: offer.seller?.toString() || null,
    amount: typeof offer.amount === 'object' ? offer.amount.toNumber() : Number(offer.amount),
    buyerDeposit: typeof offer.buyerDeposit === 'object' ? offer.buyerDeposit.toNumber() : Number(offer.buyerDeposit),
    sellerDeposit: typeof offer.sellerDeposit === 'object' ? offer.sellerDeposit.toNumber() : Number(offer.sellerDeposit),
    status: parseOfferStatus(offer.status),
    nonce: typeof offer.nonce === 'object' ? offer.nonce.toNumber() : Number(offer.nonce),
    buyerConfirmed: offer.buyerConfirmed,
    sellerConfirmed: offer.sellerConfirmed,
    isClosed: offer.isClosed,
    codeHash: Array.from(offer.codeHash),
    lastUpdated: Date.now()
  }
}

/**
 * Deserialize offer from cache (convert strings back to PublicKeys)
 */
function deserializeOffer(cached) {
  return {
    publicKey: new PublicKey(cached.publicKey),
    buyer: new PublicKey(cached.buyer),
    seller: cached.seller ? new PublicKey(cached.seller) : new PublicKey('11111111111111111111111111111111'),
    amount: { toNumber: () => cached.amount },
    buyerDeposit: { toNumber: () => cached.buyerDeposit },
    sellerDeposit: { toNumber: () => cached.sellerDeposit },
    status: cached.status,
    nonce: { toNumber: () => cached.nonce, toString: () => cached.nonce.toString() },
    buyerConfirmed: cached.buyerConfirmed,
    sellerConfirmed: cached.sellerConfirmed,
    isClosed: cached.isClosed,
    codeHash: new Uint8Array(cached.codeHash),
    _fromCache: true,
    _isTerminal: cached.isTerminal || false,
    _lastUpdated: cached.lastUpdated
  }
}

/**
 * Check if status is terminal (no need to refresh from blockchain)
 */
function isTerminalStatus(status) {
  const statusValue = parseOfferStatus(status)
  return statusValue === OfferStatus.Completed || 
         statusValue === OfferStatus.Burned || 
         statusValue === OfferStatus.Cancelled
}

/**
 * Prepare referral bonus instructions for a transaction
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} walletPublicKey - User's wallet public key
 * @param {PublicKey} userTokenAccount - User's token account to send bonus from
 * @param {number|null} currentPrice - Current token price (optional)
 * @returns {Promise<{preInstructions: Array, postInstructions: Array}>}
 */
async function prepareReferralInstructions(connection, walletPublicKey, userTokenAccount, currentPrice) {
  const preInstructions = []
  const postInstructions = []
  
  try {
    const referrer = getReferrer()
    console.log('🎁 Referral check - referrer:', referrer)
    
    if (!referrer || referrer === walletPublicKey.toString()) {
      console.log('🎁 No referral - referrer is null or same as wallet')
      return { preInstructions, postInstructions }
    }
    
    // Get price with multiple fallbacks (provided -> localStorage -> pool)
    const priceToUse = await getReferralPrice(connection, currentPrice)
    
    if (!priceToUse || priceToUse <= 0) {
      console.warn('🎁 No valid price available from any source')
      return { preInstructions, postInstructions }
    }
    
    const referralBonusLamports = calculateReferralBonusLamports(priceToUse, TOKEN_DECIMALS)
    console.log('🎁 Referral bonus lamports:', referralBonusLamports)
    
    if (!referralBonusLamports || referralBonusLamports <= 0) {
      console.log('🎁 No referral bonus - lamports is null or 0')
      return { preInstructions, postInstructions }
    }
    
    const referrerPubkey = new PublicKey(referrer)
    const referrerTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, referrerPubkey)
    
    // Check if referrer token account exists.
    // If it doesn't exist, skip the bonus entirely — the referrer must create their own ATA first.
    try {
      await getAccount(connection, referrerTokenAccount)
      console.log('🎁 Referrer token account exists')
    } catch {
      console.warn('🎁 Skipping referral bonus: referrer has no token account')
      return { preInstructions, postInstructions }
    }

    // NOTE: Referrer never receives SOL sponsorship — only token bonus.
    // Add referral bonus transfer
    postInstructions.push(
      createTransferInstruction(
        userTokenAccount,
        referrerTokenAccount,
        walletPublicKey,
        BigInt(referralBonusLamports)
      )
    )
    console.log(`🎁 Adding referral bonus: ${referralBonusLamports} lamports to ${referrer}`)
    
  } catch (err) {
    console.warn('🎁 Could not prepare referral bonus:', err.message)
  }
  
  return { preInstructions, postInstructions }
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Hook for interacting with the escrow program with optimized RPC usage
 */
export function useEscrowProgram(connection, wallet) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  // Cache for seller index existence check
  const sellerIndexExistsRef = useRef({})
  
  // Log only once on mount
  const hasLoggedRef = useRef(false)
  if (!hasLoggedRef.current) {
    console.log('🔐 Program ID:', PROGRAM_ID.toString())
    console.log('📋 IDL:', IDL.name)
    hasLoggedRef.current = true
  }

  /**
   * Get Anchor program instance
   */
  const getProgram = useCallback(() => {
    if (!wallet?.publicKey) return null
    
    const provider = new AnchorProvider(
      connection,
      wallet,
      { commitment: 'confirmed', preflightCommitment: 'confirmed' }
    )
    
    return new Program(IDL, PROGRAM_ID, provider)
  }, [connection, wallet])

  /**
   * Get or create buyer index
   */
  const getOrCreateBuyerIndex = useCallback(async () => {
    const program = getProgram()
    if (!program || !wallet?.publicKey) throw new Error('Wallet not connected')

    const [buyerIndexPDA] = getBuyerIndexPDA(wallet.publicKey)
    
    try {
      const account = await program.account.buyerIndex.fetch(buyerIndexPDA)
      return { pda: buyerIndexPDA, account, exists: true }
    } catch (err) {
      return { pda: buyerIndexPDA, account: null, exists: false }
    }
  }, [getProgram, wallet?.publicKey])

  /**
   * Get seller index (if exists)
   */
  const getSellerIndex = useCallback(async () => {
    const program = getProgram()
    if (!program || !wallet?.publicKey) return { pda: null, account: null, exists: false }

    const [sellerIndexPDA] = getSellerIndexPDA(wallet.publicKey)
    
    // Use cached result if available
    const cacheKey = wallet.publicKey.toString()
    if (sellerIndexExistsRef.current[cacheKey] === false) {
      return { pda: sellerIndexPDA, account: null, exists: false }
    }
    
    try {
      const account = await program.account.sellerIndex.fetch(sellerIndexPDA)
      sellerIndexExistsRef.current[cacheKey] = true
      return { pda: sellerIndexPDA, account, exists: true }
    } catch (err) {
      sellerIndexExistsRef.current[cacheKey] = false
      return { pda: sellerIndexPDA, account: null, exists: false }
    }
  }, [getProgram, wallet?.publicKey])

  /**
   * Count the user's currently open (active) contracts across both roles.
   * Source of truth = on-chain indexes (they only ever contain active offers).
   */
  const countOpenContracts = useCallback(async () => {
    const open = new Set()

    const buyerIndex = await getOrCreateBuyerIndex()
    if (buyerIndex.exists && buyerIndex.account) {
      for (const pk of buyerIndex.account.activeOffers) open.add(pk.toString())
    }

    const sellerIndex = await getSellerIndex()
    if (sellerIndex.exists && sellerIndex.account) {
      for (const pk of sellerIndex.account.activeOffers) open.add(pk.toString())
    }

    return open.size
  }, [getOrCreateBuyerIndex, getSellerIndex])

  /**
   * Initialize buyer index if needed
   */
  const initializeBuyerIndex = useCallback(async () => {
    const program = getProgram()
    if (!program || !wallet?.publicKey) throw new Error('Wallet not connected')

    const [buyerIndexPDA] = getBuyerIndexPDA(wallet.publicKey)

    const tx = await program.methods
      .initializeBuyerIndex()
      .accounts({
        buyer: wallet.publicKey,
        buyerIndex: buyerIndexPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc()

    return tx
  }, [getProgram, wallet?.publicKey])

  /**
   * Initialize seller index if needed
   */
  const initializeSellerIndex = useCallback(async () => {
    const program = getProgram()
    if (!program || !wallet?.publicKey) throw new Error('Wallet not connected')

    const [sellerIndexPDA] = getSellerIndexPDA(wallet.publicKey)

    const tx = await program.methods
      .initializeSellerIndex()
      .accounts({
        seller: wallet.publicKey,
        sellerIndex: sellerIndexPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc()

    // Update cache
    sellerIndexExistsRef.current[wallet.publicKey.toString()] = true

    return tx
  }, [getProgram, wallet?.publicKey])

  /**
   * Get user's token balance
   */
  const getTokenBalance = useCallback(async () => {
    if (!wallet?.publicKey || !connection) return 0

    try {
      const tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, wallet.publicKey)
      const accountInfo = await connection.getAccountInfo(tokenAccount)
      
      if (!accountInfo) {
        console.log('⚠️ Token account does not exist')
        return 0
      }
      
      const account = await getAccount(connection, tokenAccount)
      return fromTokenAmount(account.amount)
    } catch (err) {
      console.error('❌ Error getting balance:', err.message)
      return 0
    }
  }, [connection, wallet?.publicKey])

  /**
   * OPTIMIZED: Fetch all user offers using indexes + localStorage cache
   * 
   * Strategy:
   * 1. Load cached offers from localStorage
   * 2. Fetch buyerIndex and sellerIndex (2 RPC calls max)
   * 3. For offers in index: fetch from blockchain (only active offers)
   * 4. For cached offers NOT in index: 
   *    - If cancelled locally → use cache (no RPC needed)
   *    - If was active but disappeared → verify status once, then cache
   * 5. Update cache with fresh data
   */
  const fetchAllUserOffers = useCallback(async () => {
    const program = getProgram()
    if (!program || !wallet?.publicKey) return []

    const walletKey = wallet.publicKey.toString()
    const cachedOffers = loadCachedOffers(walletKey)

    console.log(`📦 Cached offers: ${Object.keys(cachedOffers).length}`)

    try {
      // 1. Active offer keys from both on-chain indexes (2 account reads)
      const activeOfferKeys = new Set()

      const buyerIndex = await getOrCreateBuyerIndex()
      if (buyerIndex.exists && buyerIndex.account) {
        for (const pk of buyerIndex.account.activeOffers) activeOfferKeys.add(pk.toString())
        console.log(`📋 Buyer index: ${buyerIndex.account.activeOffers.length} active`)
      }

      const sellerIndex = await getSellerIndex()
      if (sellerIndex.exists && sellerIndex.account) {
        for (const pk of sellerIndex.account.activeOffers) activeOfferKeys.add(pk.toString())
        console.log(`📋 Seller index: ${sellerIndex.account.activeOffers.length} active`)
      }

      console.log(`📊 Total unique active offers in indexes: ${activeOfferKeys.size}`)

      // 2. Suspected-stale candidates: cached, owned, left the index, not terminal yet.
      //    These have either been closed by the counterparty (and we missed the sync)
      //    or are mid-transition. Most-recent first (stable tie-break on key).
      const candidateKeys = []
      for (const [pkStr, cached] of Object.entries(cachedOffers)) {
        if (cached.buyer !== walletKey && cached.seller !== walletKey) continue
        if (activeOfferKeys.has(pkStr)) continue
        if (!cached.isTerminal) candidateKeys.push(pkStr)
      }
      candidateKeys.sort((a, b) => {
        const d = offerRecency(cachedOffers[b]) - offerRecency(cachedOffers[a])
        return d !== 0 ? d : (a < b ? -1 : 1)
      })

      // 3a. Verification budget: all active (mandatory) + a rotating window of candidates,
      //     capped at MAX_ONCHAIN_FETCH. Candidates outside the window are shown as
      //     "syncing" (neutral) instead of their possibly-stale open status, and are
      //     picked up on the next refresh (paginated verification over successive loads).
      const remaining = Math.max(0, MAX_ONCHAIN_FETCH - activeOfferKeys.size)
      let windowKeys = candidateKeys
      const syncingKeys = []

      if (candidateKeys.length > remaining) {
        let cursor = loadVerifyCursor(walletKey)
        if (cursor >= candidateKeys.length || cursor < 0) cursor = 0
        windowKeys = []
        for (let i = 0; i < remaining; i++) {
          windowKeys.push(candidateKeys[(cursor + i) % candidateKeys.length])
        }
        const windowSet = new Set(windowKeys)
        for (const k of candidateKeys) {
          if (!windowSet.has(k)) syncingKeys.push(k)
        }
        // Advance the cursor so the next refresh verifies the following slice.
        saveVerifyCursor(walletKey, remaining > 0 ? (cursor + remaining) % candidateKeys.length : 0)
      } else {
        // Everything fits this round — nothing left in limbo, reset the cursor.
        saveVerifyCursor(walletKey, 0)
      }

      const syncingSet = new Set(syncingKeys)
      const verifyKeys = [...activeOfferKeys, ...windowKeys]

      // 3. Batch-read with getMultipleAccounts (fetchMultiple), chunked to 100 per request.
      //    null  -> account does not exist (definitively closed / terminal)
      //    undefined -> the RPC request itself failed (429/network): DO NOT poison cache.
      const pubkeys = verifyKeys.map(k => new PublicKey(k))
      const accounts = new Array(pubkeys.length).fill(undefined)
      for (let i = 0; i < pubkeys.length; i += MULTI_FETCH_CHUNK) {
        const chunk = pubkeys.slice(i, i + MULTI_FETCH_CHUNK)
        try {
          const fetched = await program.account.offer.fetchMultiple(chunk)
          for (let j = 0; j < fetched.length; j++) accounts[i + j] = fetched[j]
        } catch (err) {
          // Transient failure: leave this chunk as `undefined` so we keep last known status.
          console.warn(`  ❌ fetchMultiple chunk [${i}] failed:`, err.message)
        }
      }

      // 4. Reconcile results with the cache.
      const offers = []
      const updatedCache = { ...cachedOffers }
      const handled = new Set()

      for (let i = 0; i < verifyKeys.length; i++) {
        const pkStr = verifyKeys[i]
        const pubkey = pubkeys[i]
        const account = accounts[i]
        handled.add(pkStr)

        if (account === undefined) {
          // RPC gave no definitive answer → keep last known cache, never mark terminal.
          // For a non-terminal contract that left the index, surface it as "syncing"
          // rather than its possibly-stale open status.
          const cached = cachedOffers[pkStr]
          if (cached) {
            offers.push(cached.isTerminal
              ? deserializeOffer(cached)
              : { ...deserializeOffer(cached), _syncing: true })
          }
          continue
        }

        if (account === null) {
          // Account definitively does not exist → contract is closed/terminal.
          const cached = cachedOffers[pkStr]
          if (cached) {
            if (!cached.isTerminal) {
              const inferredStatus = cached.buyerConfirmed && cached.sellerConfirmed
                ? OfferStatus.Completed
                : cached.status
              cached.isTerminal = true
              cached.terminalAt = Date.now()
              cached.status = inferredStatus
              updatedCache[pkStr] = cached
            }
            offers.push(deserializeOffer(cached))
          }
          continue
        }

        // Account exists → fresh on-chain data wins.
        const serialized = serializeOffer(account, pubkey)
        if (isTerminalStatus(parseOfferStatus(account.status))) {
          serialized.isTerminal = true
          serialized.terminalAt = Date.now()
        }
        updatedCache[pkStr] = serialized
        offers.push({
          publicKey: pubkey,
          ...account,
          _fromBlockchain: true
        })
      }

      // 5. Everything else from cache:
      //    - terminal history → trust cache.
      //    - suspected-stale candidates not verified this round → neutral "syncing"
      //      (their stale open status is not shown); verified on a later refresh.
      for (const [pkStr, cached] of Object.entries(cachedOffers)) {
        if (handled.has(pkStr)) continue
        if (cached.buyer !== walletKey && cached.seller !== walletKey) continue
        if (syncingSet.has(pkStr)) {
          offers.push({ ...deserializeOffer(cached), _syncing: true })
        } else {
          offers.push(deserializeOffer(cached))
        }
      }

      // 6. Persist (pruned to MAX_CACHE_HISTORY inside saveCachedOffers).
      saveCachedOffers(walletKey, updatedCache)

      console.log(`📊 Total offers returned: ${offers.length}`)
      return offers

    } catch (err) {
      console.error('Error fetching offers:', err)

      // Fallback to cache only
      const fallbackOffers = Object.values(cachedOffers)
        .filter(c => c.buyer === walletKey || c.seller === walletKey)
        .map(deserializeOffer)

      console.log(`⚠️ Using ${fallbackOffers.length} cached offers as fallback`)
      return fallbackOffers
    }
  }, [getProgram, getOrCreateBuyerIndex, getSellerIndex, wallet?.publicKey])

  /**
   * Search for offer by code - optimized for sellers accepting offers
   * Only searches pending offers (not all offers)
   */
  const findOfferByCode = useCallback(async (code) => {
    const program = getProgram()
    if (!program) throw new Error('Wallet not connected')

    try {
      // Get all offers - but only check PendingSeller status
      // This is necessary since we don't know the buyer
      const offers = await program.account.offer.all()
      
      console.log(`🔍 Searching ${offers.length} offers for code...`)
      
      for (const { publicKey, account } of offers) {
        const status = parseOfferStatus(account.status)
        if (status !== OfferStatus.PendingSeller) continue
        
        const testHash = hashCode(code.trim(), publicKey)
        if (Buffer.from(testHash).equals(Buffer.from(account.codeHash))) {
          console.log('✅ Found matching offer:', publicKey.toString())
          return { publicKey, ...account }
        }
      }
      
      console.log('❌ No matching offer found')
      return null
    } catch (err) {
      console.error('Error searching:', err)
      throw err
    }
  }, [getProgram])

  /**
   * Read offer by code - for import functionality
   * This is the ONLY case where we search all offers including closed ones
   */
  const readOfferByCode = useCallback(async (code, forceBlockchainCheck = false) => {
    const program = getProgram()
    if (!program) throw new Error('Wallet not connected')

    const walletKey = wallet.publicKey.toString()
    const cachedOffers = loadCachedOffers(walletKey)

    // First check cache if not forcing blockchain
    if (!forceBlockchainCheck) {
      for (const [pkStr, cached] of Object.entries(cachedOffers)) {
        // We can't check code hash without the publicKey, so we need to verify
        const offerPubkey = new PublicKey(pkStr)
        const testHash = hashCode(code.trim(), offerPubkey)
        if (Buffer.from(testHash).equals(Buffer.from(new Uint8Array(cached.codeHash)))) {
          console.log('✅ Found in cache:', pkStr.slice(0, 8))
          return deserializeOffer(cached)
        }
      }
    }

    // Full blockchain search for import
    console.log('🔍 Searching blockchain for import...')
    try {
      const offers = await program.account.offer.all()
      
      for (const { publicKey, account } of offers) {
        const testHash = hashCode(code.trim(), publicKey)
        if (Buffer.from(testHash).equals(Buffer.from(account.codeHash))) {
          console.log('✅ Found on blockchain:', publicKey.toString())
          
          // Check participation
          const isBuyer = account.buyer.equals(wallet.publicKey)
          const isSeller = account.seller && 
            !account.seller.equals(new PublicKey('11111111111111111111111111111111')) && 
            account.seller.equals(wallet.publicKey)
          
          if (!isBuyer && !isSeller) {
            const status = parseOfferStatus(account.status)
            if (status !== OfferStatus.PendingSeller) {
              throw new Error('You are not a participant in this contract')
            }
          }
          
          // Cache this offer
          const serialized = serializeOffer(account, publicKey)
          if (isTerminalStatus(account.status)) {
            serialized.isTerminal = true
            serialized.terminalAt = Date.now()
          }
          updateCachedOffer(walletKey, publicKey.toString(), serialized)
          
          return { publicKey, ...account }
        }
      }
      
      return null
    } catch (err) {
      console.error('Error in readOfferByCode:', err)
      throw err
    }
  }, [getProgram, wallet?.publicKey])

  /**
   * Create a new offer
   */
  const createOffer = useCallback(async (amount, code, name, currentPrice = null) => {
    setLoading(true)
    setError(null)

    try {
      const program = getProgram()
      if (!program || !wallet?.publicKey) throw new Error('Wallet not connected')

      console.log('🔐 Creating offer...')

      // Enforce the cap on simultaneously open contracts.
      const openCount = await countOpenContracts()
      if (openCount >= MAX_OPEN_CONTRACTS) {
        throw new Error(translate('escrow.maxOpenReached', { n: MAX_OPEN_CONTRACTS }))
      }

      // Ensure buyer index exists
      const buyerIndex = await getOrCreateBuyerIndex()
      if (!buyerIndex.exists) {
        console.log('  Creating buyer index...')
        await initializeBuyerIndex()
        await new Promise(r => setTimeout(r, 2000))
      }

      // Get current nonce
      const [buyerIndexPDA] = getBuyerIndexPDA(wallet.publicKey)
      const buyerIndexAccount = await program.account.buyerIndex.fetch(buyerIndexPDA)
      const nonce = buyerIndexAccount.nextNonce

      // Derive PDAs
      const [offerPDA] = getOfferPDA(wallet.publicKey, nonce)
      const [escrowVaultAuthorityPDA] = getEscrowVaultAuthorityPDA(offerPDA)

      const buyerTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, wallet.publicKey)
      const escrowVault = await getAssociatedTokenAddress(TOKEN_MINT, escrowVaultAuthorityPDA, true)

      const codeHash = hashCode(code, offerPDA)
      const tokenAmount = toTokenAmount(amount)

      // Prepare referral bonus instructions
      const { preInstructions, postInstructions } = await prepareReferralInstructions(
        connection, wallet.publicKey, buyerTokenAccount, currentPrice
      )

      const tx = await program.methods
        .createOffer(tokenAmount, Array.from(codeHash))
        .accounts({
          buyer: wallet.publicKey,
          buyerIndex: buyerIndexPDA,
          offer: offerPDA,
          escrowVault: escrowVault,
          escrowVaultAuthority: escrowVaultAuthorityPDA,
          mint: TOKEN_MINT,
          buyerToken: buyerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions(preInstructions)
        .postInstructions(postInstructions)
        .rpc()

      console.log('✅ Created:', tx)

      // Cache the new offer immediately
      const walletKey = wallet.publicKey.toString()
      const nonceNum = typeof nonce === 'object' && nonce.toNumber ? nonce.toNumber() : Number(nonce)
      updateCachedOffer(walletKey, offerPDA.toString(), {
        publicKey: offerPDA.toString(),
        buyer: wallet.publicKey.toString(),
        seller: null,
        amount: amount * Math.pow(10, TOKEN_DECIMALS),
        buyerDeposit: amount * 2 * Math.pow(10, TOKEN_DECIMALS),
        sellerDeposit: 0,
        status: OfferStatus.PendingSeller,
        nonce: nonceNum,
        buyerConfirmed: false,
        sellerConfirmed: false,
        isClosed: false,
        codeHash: Array.from(codeHash),
        lastUpdated: Date.now()
      })

      return {
        success: true,
        txHash: tx,
        offerPDA,
        code,
        name,
        amount,
      }
    } catch (err) {
      console.error('❌ Create error:', err)
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [connection, getProgram, wallet?.publicKey, getOrCreateBuyerIndex, initializeBuyerIndex, countOpenContracts])

  /**
   * Accept an offer (as seller)
   */
  const acceptOffer = useCallback(async (offerPubkey, code, currentPrice = null) => {
    setLoading(true)
    setError(null)

    try {
      const program = getProgram()
      if (!program || !wallet?.publicKey) throw new Error('Wallet not connected')

      console.log('🔵 Accepting offer:', offerPubkey.toString())

      // Enforce the cap on simultaneously open contracts.
      const openCount = await countOpenContracts()
      if (openCount >= MAX_OPEN_CONTRACTS) {
        throw new Error(translate('escrow.maxOpenReached', { n: MAX_OPEN_CONTRACTS }))
      }

      const offer = await program.account.offer.fetch(offerPubkey)
      const [escrowVaultAuthorityPDA] = getEscrowVaultAuthorityPDA(offerPubkey)
      const [sellerIndexPDA] = getSellerIndexPDA(wallet.publicKey)

      // Check if seller index exists, create if not
      const sellerIndex = await getSellerIndex()
      if (!sellerIndex.exists) {
        console.log('  Creating seller index...')
        await initializeSellerIndex()
        await new Promise(r => setTimeout(r, 2000))
      }

      const sellerTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, wallet.publicKey)
      const escrowVault = await getAssociatedTokenAddress(TOKEN_MINT, escrowVaultAuthorityPDA, true)

      // Prepare referral bonus instructions
      const { preInstructions, postInstructions } = await prepareReferralInstructions(
        connection, wallet.publicKey, sellerTokenAccount, currentPrice
      )

      const tx = await program.methods
        .acceptOffer(code)
        .accounts({
          seller: wallet.publicKey,
          sellerIndex: sellerIndexPDA,
          offer: offerPubkey,
          sellerToken: sellerTokenAccount,
          escrowVault: escrowVault,
          escrowVaultAuthority: escrowVaultAuthorityPDA,
          mint: TOKEN_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions(preInstructions)
        .postInstructions(postInstructions)
        .rpc()

      console.log('✅ Accepted:', tx)

      // Update cache
      const walletKey = wallet.publicKey.toString()
      updateCachedOffer(walletKey, offerPubkey.toString(), {
        seller: wallet.publicKey.toString(),
        sellerDeposit: offer.amount.toNumber(),
        status: OfferStatus.Locked,
        lastUpdated: Date.now()
      })

      return { success: true, txHash: tx }
    } catch (err) {
      console.error('❌ Accept error:', err)
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [connection, getProgram, wallet?.publicKey, getSellerIndex, initializeSellerIndex, countOpenContracts])

  /**
   * Cancel an offer (only if pending)
   */
  const cancelOffer = useCallback(async (offerPubkey, currentPrice = null) => {
    setLoading(true)
    setError(null)

    try {
      const program = getProgram()
      if (!program || !wallet?.publicKey) throw new Error('Wallet not connected')

      const offer = await program.account.offer.fetch(offerPubkey)
      const [buyerIndexPDA] = getBuyerIndexPDA(offer.buyer)
      const [escrowVaultAuthorityPDA] = getEscrowVaultAuthorityPDA(offerPubkey)

      const buyerTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, offer.buyer)
      const escrowVault = await getAssociatedTokenAddress(TOKEN_MINT, escrowVaultAuthorityPDA, true)

      // Prepare referral bonus instructions
      const { preInstructions, postInstructions } = await prepareReferralInstructions(
        connection, wallet.publicKey, buyerTokenAccount, currentPrice
      )

      const tx = await program.methods
        .cancelOffer()
        .accounts({
          buyer: wallet.publicKey,
          offer: offerPubkey,
          buyerToken: buyerTokenAccount,
          escrowVault: escrowVault,
          escrowVaultAuthority: escrowVaultAuthorityPDA,
          buyerIndex: buyerIndexPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions(preInstructions)
        .postInstructions(postInstructions)
        .rpc()

      console.log('✅ Cancelled:', tx)

      // Mark as terminal in cache - NO future RPC needed!
      const walletKey = wallet.publicKey.toString()
      markOfferTerminal(walletKey, offerPubkey.toString(), OfferStatus.Cancelled)

      return { success: true, txHash: tx }
    } catch (err) {
      console.error('❌ Cancel error:', err)
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [connection, getProgram, wallet?.publicKey])

  /**
   * Release/confirm completion of an offer
   */
  const releaseOffer = useCallback(async (offerPubkey, currentPrice = null) => {
    setLoading(true)
    setError(null)

    try {
      const program = getProgram()
      if (!program || !wallet?.publicKey) throw new Error('Wallet not connected')

      const offer = await program.account.offer.fetch(offerPubkey)
      const [buyerIndexPDA] = getBuyerIndexPDA(offer.buyer)
      const [sellerIndexPDA] = getSellerIndexPDA(offer.seller)
      const [escrowVaultAuthorityPDA] = getEscrowVaultAuthorityPDA(offerPubkey)

      const buyerTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, offer.buyer)
      const sellerTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, offer.seller)
      const escrowVault = await getAssociatedTokenAddress(TOKEN_MINT, escrowVaultAuthorityPDA, true)

      // Determine which token account to use for referral (buyer or seller based on who is calling)
      const isBuyerForReferral = offer.buyer.equals(wallet.publicKey)
      const userTokenAccountForReferral = isBuyerForReferral ? buyerTokenAccount : sellerTokenAccount

      // Prepare referral bonus instructions
      const { preInstructions, postInstructions } = await prepareReferralInstructions(
        connection, wallet.publicKey, userTokenAccountForReferral, currentPrice
      )

      const tx = await program.methods
        .confirmCompletion()
        .accounts({
          user: wallet.publicKey,
          offer: offerPubkey,
          buyerToken: buyerTokenAccount,
          sellerToken: sellerTokenAccount,
          escrowVault: escrowVault,
          escrowVaultAuthority: escrowVaultAuthorityPDA,
          buyerIndex: buyerIndexPDA,
          sellerIndex: sellerIndexPDA,
          buyer: offer.buyer,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions(preInstructions)
        .postInstructions(postInstructions)
        .rpc()

      console.log('✅ Released:', tx)

      // Update cache based on who confirmed
      const walletKey = wallet.publicKey.toString()
      const isBuyer = offer.buyer.equals(wallet.publicKey)
      
      const cached = loadCachedOffers(walletKey)[offerPubkey.toString()] || {}
      const newStatus = isBuyer 
        ? (cached.sellerConfirmed ? OfferStatus.Completed : OfferStatus.BuyerConfirmed)
        : (cached.buyerConfirmed ? OfferStatus.Completed : OfferStatus.SellerConfirmed)
      
      updateCachedOffer(walletKey, offerPubkey.toString(), {
        buyerConfirmed: isBuyer ? true : cached.buyerConfirmed,
        sellerConfirmed: !isBuyer ? true : cached.sellerConfirmed,
        status: newStatus,
        ...(newStatus === OfferStatus.Completed && { isTerminal: true, terminalAt: Date.now() })
      })

      return { success: true, txHash: tx }
    } catch (err) {
      console.error('❌ Release error:', err)
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [connection, getProgram, wallet?.publicKey])

  /**
   * Burn all deposits for an offer
   */
  const burnOffer = useCallback(async (offerPubkey, currentPrice = null) => {
    setLoading(true)
    setError(null)

    try {
      const program = getProgram()
      if (!program || !wallet?.publicKey) throw new Error('Wallet not connected')

      const offer = await program.account.offer.fetch(offerPubkey)
      const [buyerIndexPDA] = getBuyerIndexPDA(offer.buyer)
      const [sellerIndexPDA] = getSellerIndexPDA(offer.seller)
      const [escrowVaultAuthorityPDA] = getEscrowVaultAuthorityPDA(offerPubkey)

      const escrowVault = await getAssociatedTokenAddress(TOKEN_MINT, escrowVaultAuthorityPDA, true)

      // Determine which token account to use for referral (buyer or seller based on who is calling)
      const isBuyerForReferral = offer.buyer.equals(wallet.publicKey)
      const userTokenAccountForReferral = isBuyerForReferral 
        ? await getAssociatedTokenAddress(TOKEN_MINT, offer.buyer)
        : await getAssociatedTokenAddress(TOKEN_MINT, offer.seller)

      // Prepare referral bonus instructions
      const { preInstructions, postInstructions } = await prepareReferralInstructions(
        connection, wallet.publicKey, userTokenAccountForReferral, currentPrice
      )

      const tx = await program.methods
        .burnDeposits()
        .accounts({
          signer: wallet.publicKey,
          offer: offerPubkey,
          escrowVault: escrowVault,
          escrowVaultAuthority: escrowVaultAuthorityPDA,
          buyerIndex: buyerIndexPDA,
          sellerIndex: sellerIndexPDA,
          buyer: offer.buyer,
          mint: TOKEN_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions(preInstructions)
        .postInstructions(postInstructions)
        .rpc()

      console.log('✅ Burned:', tx)

      // Mark as terminal
      const walletKey = wallet.publicKey.toString()
      markOfferTerminal(walletKey, offerPubkey.toString(), OfferStatus.Burned)

      return { success: true, txHash: tx }
    } catch (err) {
      console.error('❌ Burn error:', err)
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [connection, getProgram, wallet?.publicKey])

  /**
   * Fetch single offer status (for manual refresh)
   */
  const fetchOfferStatus = useCallback(async (offerPubkey) => {
    const program = getProgram()
    if (!program) throw new Error('Wallet not connected')

    try {
      const offer = await program.account.offer.fetch(offerPubkey)
      
      // Update cache
      const walletKey = wallet.publicKey.toString()
      const serialized = serializeOffer(offer, offerPubkey)
      if (isTerminalStatus(offer.status)) {
        serialized.isTerminal = true
        serialized.terminalAt = Date.now()
      }
      updateCachedOffer(walletKey, offerPubkey.toString(), serialized)
      
      return { publicKey: offerPubkey, ...offer }
    } catch (err) {
      console.error('Error fetching offer:', err)
      throw err
    }
  }, [getProgram, wallet?.publicKey])

  return {
    loading,
    error,
    getTokenBalance,
    fetchAllUserOffers,
    findOfferByCode,
    readOfferByCode,
    fetchOfferStatus,
    createOffer,
    acceptOffer,
    cancelOffer,
    releaseOffer,
    burnOffer,
    initializeBuyerIndex,
    initializeSellerIndex,
  }
}