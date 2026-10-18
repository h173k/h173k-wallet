// ============================================================================
// h173k staking — pure math (BigInt port of state.rs). No network, no imports.
//
// The wallet NEVER calls `sync` or any other instruction just to read values.
// Instead, everything a `sync` would settle (a pending bonus) is simulated here
// locally on a copy of the decoded accounts, exactly as Pool::sync_user does it,
// so the displayed numbers match what the program would pay out.
// ============================================================================

export const BPS = 10_000n
export const ACC_PRECISION = 1_000_000_000_000_000_000n // 1e18
export const U64_MAX = (1n << 64n) - 1n

/** Floor for the displayed APY (business promise: min 3.5 % per year). */
export const MIN_APY = 0.035

const DAY = 86_400
const YEAR = 365 * DAY

const min = (a, b) => (a < b ? a : b)
const satSub = (a, b) => (a > b ? a - b : 0n)

/** Shares for `amount` (rounded down, in favour of the pool). */
export function sharesForAmount(pool, amount) {
  if (pool.totalShares === 0n) return amount
  if (pool.totalStaked === 0n) throw new Error('Pool has shares but no stake')
  return (amount * pool.totalShares) / pool.totalStaked
}

/** h173k for `shares` (rounded down). */
export function amountForShares(pool, shares) {
  if (pool.totalShares === 0n) return 0n
  return (shares * pool.totalStaked) / pool.totalShares
}

function refreshWeight(pool, user) {
  pool.totalBonusWeight -= user.bonusWeight
  user.bonusWeight = user.bonusActive ? user.shares * BigInt(user.bonusBps) : 0n
  pool.totalBonusWeight += user.bonusWeight
  if (pool.totalBonusWeight === 0n && pool.bonusReserve > 0n) {
    pool.totalStaked += pool.bonusReserve
    pool.bonusReserve = 0n
  }
}

/**
 * Pool::sync_user on COPIES of the accounts. Returns { pool, user } as they would
 * be right after a `sync` — without sending anything.
 */
export function simulateSync(poolIn, userIn) {
  const pool = { ...poolIn }
  const user = { ...userIn }
  if (user.bonusActive && user.bonusWeight > 0n && pool.accBonus > user.accCheckpoint) {
    const delta = pool.accBonus - user.accCheckpoint
    const pending = min((user.bonusWeight * delta) / ACC_PRECISION, pool.bonusReserve)
    pool.bonusReserve -= pending
    const left = satSub(user.bonusCap, user.bonusAccrued)
    const give = min(pending, left)
    const excess = pending - give
    if (give > 0n) {
      const newShares = sharesForAmount(pool, give)
      pool.totalStaked += give
      pool.totalShares += newShares
      user.shares += newShares
      user.bonusAccrued += give
      user.bonusTotal += give
    }
    if (excess > 0n) pool.totalStaked += excess
    if (user.bonusAccrued >= user.bonusCap) user.bonusActive = false
  }
  user.accCheckpoint = pool.accBonus
  refreshWeight(pool, user)
  return { pool, user }
}

/** Empty UserStake (account does not exist yet). */
export function emptyUser() {
  return {
    exists: false,
    shares: 0n, bonusUsed: false, bonusActive: false, bonusBps: 0, bonusCap: 0n,
    bonusAccrued: 0n, bonusWeight: 0n, accCheckpoint: 0n,
    principal: 0n, profitWithdrawn: 0n, bonusTotal: 0n,
  }
}

/**
 * Everything the UI shows about a position, computed on the synced copy.
 * All amounts in raw base units (BigInt).
 */
export function positionSummary(poolIn, userIn) {
  const { pool, user } = simulateSync(poolIn, userIn)
  const value = amountForShares(pool, user.shares)
  const profit = satSub(value, user.principal)
  // claim_profit pays amount_for_shares(floor(profit * S / T)) — mirror it exactly.
  let claimable = 0n
  if (pool.totalStaked > 0n && user.shares > 0n) {
    const sh = min((profit * pool.totalShares) / pool.totalStaked, user.shares)
    claimable = amountForShares(pool, sh)
  }
  return {
    pool, user,
    shares: user.shares,
    value,
    principal: user.principal,
    profit,
    claimable,
    lifetimeProfit: profit + user.profitWithdrawn,
    profitWithdrawn: user.profitWithdrawn,
    bonusActive: user.bonusActive,
    bonusBps: user.bonusBps,
    bonusCap: user.bonusCap,
    bonusAccrued: user.bonusAccrued,
    bonusTotal: user.bonusTotal,
    poolShare: pool.totalShares > 0n ? Number((user.shares * 1_000_000n) / pool.totalShares) / 1_000_000 : 0,
  }
}

/**
 * Amounts within this distance of the whole stake mean "unstake everything"
 * (0.000001 h173k). Covers rounding dust: the share price only ever rises, by a unit
 * or two whenever someone else stakes/unstakes, so a value read a moment ago may be a
 * hair below the current one — withdrawing "all but 2 base units" is never intended.
 */
export const UNSTAKE_ALL_TOLERANCE = 1000n

/**
 * Shares to burn so the user receives AT LEAST `amount` (ceil), capped at all
 * shares. Returns U64_MAX when the request covers the whole position (within
 * UNSTAKE_ALL_TOLERANCE either way). Computed on the synced state, because unstake()
 * syncs first.
 */
export function sharesToUnstake(poolIn, userIn, amount) {
  const { pool, user } = simulateSync(poolIn, userIn)
  const value = amountForShares(pool, user.shares)
  if (amount <= 0n) throw new Error('ZERO')
  if (amount > value + UNSTAKE_ALL_TOLERANCE) throw new Error('EXCEEDS')
  if (amount + UNSTAKE_ALL_TOLERANCE >= value) return { shares: U64_MAX, expected: value, all: true }
  const shares = (amount * pool.totalShares + pool.totalStaked - 1n) / pool.totalStaked
  if (shares >= user.shares) return { shares: U64_MAX, expected: value, all: true }
  return { shares, expected: amountForShares(pool, shares), all: false }
}

/** True when `amount` means "everything" for a position worth `value`. */
export function coversWholeStake(amount, value) {
  return amount !== null && amount + UNSTAKE_ALL_TOLERANCE >= value
}

/**
 * Current yearly yield, derived from the last reward deposit:
 *   rate per period = last_reward_amount / last_reward_weight
 *   period          = last_reward_ts - prev_reward_ts (≥ 1 day, payouts are daily)
 *   APY             = (1 + rate)^(year / period) - 1     (shares compound)
 * The displayed value never goes below MIN_APY (3.5 %): temporary shortfalls
 * are made up later by higher rewards.
 * Returns { apy, measured, floored } — measured is null when no reward was paid yet.
 */
export function computeApy(pool) {
  let measured = null
  if (pool && pool.rewardCount > 0n && pool.lastRewardWeight > 0n && pool.lastRewardAmount > 0n) {
    const rate = Number(pool.lastRewardAmount) / Number(pool.lastRewardWeight)
    const last = Number(pool.lastRewardTs)
    const prev = Number(pool.prevRewardTs)
    const period = Math.max(DAY, prev > 0 ? last - prev : DAY)
    const apy = Math.pow(1 + rate, YEAR / period) - 1
    if (Number.isFinite(apy)) measured = apy
  }
  const apy = measured === null ? MIN_APY : Math.max(MIN_APY, measured)
  return { apy, measured, floored: measured === null || measured < MIN_APY }
}

// ---------- raw <-> UI number helpers ----------
export function rawToNumber(raw, decimals) {
  const neg = raw < 0n
  const v = neg ? -raw : raw
  const base = 10n ** BigInt(decimals)
  const n = Number(v / base) + Number(v % base) / Number(base)
  return neg ? -n : n
}

/** Parse a decimal string ("12.5") into raw units without float rounding. */
export function parseAmountToRaw(str, decimals) {
  const s = String(str ?? '').trim().replace(',', '.')
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null
  const [i, f = ''] = s.split('.')
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(i || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0')
}

/**
 * Raw → exact display string with thousands separators and every significant decimal
 * ("1,234.645517998"). Staking shows amounts like this everywhere, so the panel, the
 * MAX value, the confirm screen and messages always show the very same number.
 */
export function formatRawExact(raw, decimals) {
  const [i, f] = rawToInputString(raw, decimals).split('.')
  const int = BigInt(i).toLocaleString('en-US')
  return f ? `${int}.${f}` : int
}

/** Raw → plain decimal string (for filling the amount input). */
export function rawToInputString(raw, decimals) {
  const base = 10n ** BigInt(decimals)
  const i = raw / base
  const f = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return f ? `${i}.${f}` : `${i}`
}
