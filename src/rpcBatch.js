// ============================================================================
// Batched RPC reads — fewer requests against the user's RPC quota.
//
// getMultipleAccountsInfo is a standard RPC method: on Helius (free tier included)
// it costs 1 credit for the whole batch (up to 100 accounts), versus 1 credit PER
// call for getAccount / getBalance / getTokenAccountBalance.
// ============================================================================

import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { TOKEN_MINT, USDT_MINT } from './constants'

/** Raw amount (u64 at offset 64) of an SPL token account; 0n when it does not exist. */
export function tokenAmountOf(info) {
  if (!info || !info.data || info.data.length < 72) return 0n
  const owner = info.owner instanceof PublicKey ? info.owner : new PublicKey(info.owner)
  if (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID)) return 0n
  const d = info.data
  let v = 0n
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[64 + i])
  return v
}

/**
 * h173k, SOL and USDT balances of a wallet in ONE request (was three).
 * @returns {{ h173kRaw: bigint, lamports: number, usdtRaw: bigint }}
 */
export async function fetchWalletBalances(connection, owner) {
  const h173kAta = getAssociatedTokenAddressSync(TOKEN_MINT, owner)
  const usdtAta = getAssociatedTokenAddressSync(USDT_MINT, owner)
  const [tok, own, usdt] = await connection.getMultipleAccountsInfo([h173kAta, owner, usdtAta], 'confirmed')
  return {
    h173kRaw: tokenAmountOf(tok),
    lamports: own ? own.lamports : 0,
    usdtRaw: tokenAmountOf(usdt),
  }
}
