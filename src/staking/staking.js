// ============================================================================
// h173k staking — on-chain layer (program 4AoDWX…, see lib.rs / state.rs).
//
// Reading:  ONE getMultipleAccountsInfo (pool + the user's UserStake), only when the
//           user opens the Send screen, presses "refresh", or confirms an action.
//           No polling, no background reads, and NO transaction is ever sent to
//           "query" the contract (no `sync`, no simulations). Plain account reads
//           are free — they cost no SOL.
// Writing:  stake (+ optional redeem_code in the same tx), unstake, claim_profit —
//           only after the user confirms on the confirm screen.
//
// Instructions are built by hand (Anchor discriminator + Borsh args) so the wallet
// does not depend on an IDL file matching the deployed Anchor version.
// ============================================================================

import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token'
import { sha256 } from '@noble/hashes/sha256'
import { TOKEN_MINT } from '../constants'
import { emptyUser } from './stakingMath'

export const STAKING_PROGRAM_ID = new PublicKey('4AoDWXQYziuAZbSYVpwGyWNSJdSd1sFVZMbRoyfxNipE')

const enc = new TextEncoder()
const POOL_SEED = enc.encode('pool')
const VAULT_SEED = enc.encode('vault')
const USER_SEED = enc.encode('user')
const CODE_SEED = enc.encode('code')

/** 8 + UserStake::INIT_SPACE (149) — rent paid by the user on the first stake. */
export const USER_STAKE_SPACE = 157
/** Rent-exempt minimum for USER_STAKE_SPACE: (128 + space) * 6960 lamports. */
export const USER_STAKE_RENT_SOL = ((128 + USER_STAKE_SPACE) * 6960) / 1e9
export const ATA_RENT_SOL = 0.00204

const disc = (prefix, name) => sha256(enc.encode(`${prefix}:${name}`)).slice(0, 8)
const IX = {
  stake: disc('global', 'stake'),
  unstake: disc('global', 'unstake'),
  claimProfit: disc('global', 'claim_profit'),
  redeemCode: disc('global', 'redeem_code'),
}
const ACC = {
  Pool: disc('account', 'Pool'),
  UserStake: disc('account', 'UserStake'),
  BonusCode: disc('account', 'BonusCode'),
}

// ---------- PDAs ----------
export function getPoolPda() {
  return PublicKey.findProgramAddressSync([POOL_SEED, TOKEN_MINT.toBytes()], STAKING_PROGRAM_ID)[0]
}
export function getVaultPda(pool) {
  return PublicKey.findProgramAddressSync([VAULT_SEED, pool.toBytes()], STAKING_PROGRAM_ID)[0]
}
export function getUserStakePda(pool, owner) {
  return PublicKey.findProgramAddressSync([USER_SEED, pool.toBytes(), owner.toBytes()], STAKING_PROGRAM_ID)[0]
}
/** hash = sha256(code_utf8 || wallet_pubkey) — a code only works for its wallet. */
export function bonusCodeHash(code, owner) {
  const c = enc.encode(code)
  const buf = new Uint8Array(c.length + 32)
  buf.set(c, 0)
  buf.set(owner.toBytes(), c.length)
  return sha256(buf)
}
export function getBonusCodePda(pool, hash) {
  return PublicKey.findProgramAddressSync([CODE_SEED, pool.toBytes(), hash], STAKING_PROGRAM_ID)[0]
}

// ---------- Borsh reader ----------
class Reader {
  constructor(data) { this.b = data; this.o = 8 }
  pk() { const v = new PublicKey(this.b.slice(this.o, this.o + 32)); this.o += 32; return v }
  u8() { return this.b[this.o++] }
  bool() { return this.u8() !== 0 }
  uN(bytes) {
    let v = 0n
    for (let i = bytes - 1; i >= 0; i--) v = (v << 8n) | BigInt(this.b[this.o + i])
    this.o += bytes
    return v
  }
  u16() { return Number(this.uN(2)) }
  u64() { return this.uN(8) }
  i64() { const v = this.uN(8); return v >= (1n << 63n) ? v - (1n << 64n) : v }
  u128() { return this.uN(16) }
}

function hasDisc(data, d) {
  if (!data || data.length < 8) return false
  for (let i = 0; i < 8; i++) if (data[i] !== d[i]) return false
  return true
}

export function decodePool(data) {
  if (!hasDisc(data, ACC.Pool)) throw new Error('Not a staking Pool account')
  const r = new Reader(data)
  return {
    admin: r.pk(), mint: r.pk(), vault: r.pk(), bump: r.u8(), vaultBump: r.u8(),
    totalStaked: r.u64(), totalShares: r.u64(), totalBonusWeight: r.u128(), accBonus: r.u128(),
    bonusReserve: r.u64(),
    lastRewardAmount: r.u64(), lastRewardWeight: r.u64(), lastRewardTs: r.i64(),
    prevRewardTs: r.i64(), firstRewardTs: r.i64(), totalRewards: r.u64(), rewardCount: r.u64(),
  }
}

export function decodeUserStake(data) {
  if (!hasDisc(data, ACC.UserStake)) throw new Error('Not a UserStake account')
  const r = new Reader(data)
  return {
    exists: true,
    owner: r.pk(), pool: r.pk(), bump: r.u8(), shares: r.u64(),
    bonusUsed: r.bool(), bonusActive: r.bool(), bonusBps: r.u16(), bonusCap: r.u64(),
    bonusAccrued: r.u64(), bonusWeight: r.u128(), accCheckpoint: r.u128(),
    principal: r.u64(), profitWithdrawn: r.u64(), bonusTotal: r.u64(),
  }
}

export function decodeBonusCode(data) {
  if (!hasDisc(data, ACC.BonusCode)) throw new Error('Not a BonusCode account')
  const r = new Reader(data)
  return { pool: r.pk(), hash: r.b.slice(r.o, (r.o += 32)), bonusBps: r.u16(), bonusCap: r.u64() }
}

/**
 * Single read of the staking state. Returns
 *   { available:false }                     — pool not initialized
 *   { available:true, pool, user, poolPda, userPda, isAdmin }
 */
export async function fetchStakingState(connection, owner) {
  const poolPda = getPoolPda()
  const userPda = owner ? getUserStakePda(poolPda, owner) : null
  const keys = userPda ? [poolPda, userPda] : [poolPda]
  const [poolInfo, userInfo] = await connection.getMultipleAccountsInfo(keys, 'confirmed')
  if (!poolInfo || !poolInfo.owner.equals(STAKING_PROGRAM_ID)) return { available: false }
  const pool = decodePool(poolInfo.data)
  let user = emptyUser()
  if (userInfo && userInfo.owner.equals(STAKING_PROGRAM_ID)) user = decodeUserStake(userInfo.data)
  return {
    available: true,
    pool, user, poolPda, userPda,
    isAdmin: !!owner && pool.admin.equals(owner),
    fetchedAt: Date.now(),
  }
}

/** Looks up a bonus code for this wallet (one account read). null = invalid/used code. */
export async function lookupBonusCode(connection, poolPda, owner, code) {
  const hash = bonusCodeHash(code, owner)
  const pda = getBonusCodePda(poolPda, hash)
  const info = await connection.getAccountInfo(pda, 'confirmed')
  if (!info || !info.owner.equals(STAKING_PROGRAM_ID)) return null
  try {
    const bc = decodeBonusCode(info.data)
    if (!bc.pool.equals(poolPda)) return null
    return { pda, ...bc }
  } catch { return null }
}

// ---------- instruction builders ----------
const u64le = (v) => {
  const b = new Uint8Array(8)
  let x = BigInt(v)
  for (let i = 0; i < 8; i++) { b[i] = Number(x & 0xffn); x >>= 8n }
  return b
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return Buffer.from(out)
}
const m = (pubkey, isWritable, isSigner = false) => ({ pubkey, isWritable, isSigner })

function stakeIx({ owner, poolPda, userPda, vault, ownerToken }, amountRaw) {
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      m(owner, true, true), m(poolPda, true), m(userPda, true), m(TOKEN_MINT, false),
      m(vault, true), m(ownerToken, true), m(TOKEN_PROGRAM_ID, false), m(SystemProgram.programId, false),
    ],
    data: concat(IX.stake, u64le(amountRaw)),
  })
}

function unstakeKeys({ owner, poolPda, userPda, vault, ownerToken }) {
  return [
    m(owner, false, true), m(poolPda, true), m(userPda, true), m(TOKEN_MINT, false),
    m(vault, true), m(ownerToken, true), m(TOKEN_PROGRAM_ID, false),
  ]
}

function unstakeIx(accts, shares) {
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID, keys: unstakeKeys(accts), data: concat(IX.unstake, u64le(shares)),
  })
}

function claimProfitIx(accts) {
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID, keys: unstakeKeys(accts), data: concat(IX.claimProfit),
  })
}

function redeemCodeIx({ owner, admin, poolPda, userPda, bonusCodePda }, code) {
  const c = enc.encode(code)
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, c.length, true)
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      m(owner, true, true), m(admin, true), m(poolPda, true), m(userPda, true),
      m(bonusCodePda, true), m(SystemProgram.programId, false),
    ],
    data: concat(IX.redeemCode, len, c),
  })
}

async function accountsFor(owner, state) {
  const poolPda = state.poolPda
  return {
    owner,
    poolPda,
    userPda: state.userPda,
    vault: state.pool.vault ?? getVaultPda(poolPda),
    ownerToken: await getAssociatedTokenAddress(TOKEN_MINT, owner),
    admin: state.pool.admin,
  }
}

async function signSendConfirm(connection, wallet, tx) {
  const { blockhash } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = wallet.publicKey
  const signed = wallet.signTransaction(tx)
  // Preflight stays ON: a transaction the program would reject (wrong code, too small,
  // no profit…) fails in simulation and costs nothing.
  const sig = await connection.sendRawTransaction(signed.serialize())
  await connection.confirmTransaction(sig, 'confirmed')
  return sig
}

/** stake (optionally preceded by redeem_code in the SAME transaction). */
export async function sendStake(connection, wallet, state, amountRaw, bonus /* {code, pda} | null */) {
  const a = await accountsFor(wallet.publicKey, state)
  const tx = new Transaction()
  if (bonus) tx.add(redeemCodeIx({ ...a, bonusCodePda: bonus.pda }, bonus.code))
  tx.add(stakeIx(a, amountRaw))
  return signSendConfirm(connection, wallet, tx)
}

/** unstake(shares) — U64_MAX withdraws everything. */
export async function sendUnstake(connection, wallet, state, shares) {
  const a = await accountsFor(wallet.publicKey, state)
  const tx = new Transaction()
  tx.add(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, a.ownerToken, wallet.publicKey, TOKEN_MINT))
  tx.add(unstakeIx(a, shares))
  return signSendConfirm(connection, wallet, tx)
}

export async function sendClaimProfit(connection, wallet, state) {
  const a = await accountsFor(wallet.publicKey, state)
  const tx = new Transaction()
  tx.add(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, a.ownerToken, wallet.publicKey, TOKEN_MINT))
  tx.add(claimProfitIx(a))
  return signSendConfirm(connection, wallet, tx)
}

// ---------- errors ----------
// Anchor custom errors start at 6000 (0x1770), in StakingError declaration order.
const STAKING_ERRORS = [
  'ZeroAmount', 'NoStakers', 'InsufficientShares', 'TooSmallDeposit', 'BonusAlreadyActive',
  'InvalidCode', 'InvalidBonusParams', 'Overflow', 'NoProfit', 'Unauthorized',
  'NoActiveBonus', 'AdminCannotStake',
]

/** Maps a failed tx to a StakingError name (or Anchor/SPL name), else null. */
export function stakingErrorName(err) {
  const blob = String(err?.message || err || '') + ' ' + (err?.logs || []).join(' ')
  const hex = blob.match(/custom program error: 0x([0-9a-f]+)/i)
  if (hex) {
    const code = parseInt(hex[1], 16)
    if (code >= 6000 && code < 6000 + STAKING_ERRORS.length) return STAKING_ERRORS[code - 6000]
    if (code === 3012) return 'AccountNotInitialized'
    if (code === 1 && /tokenkeg/i.test(blob)) return 'InsufficientTokens'
  }
  const named = blob.match(/Error Code: (\w+)/)
  if (named && STAKING_ERRORS.includes(named[1])) return named[1]
  return null
}
