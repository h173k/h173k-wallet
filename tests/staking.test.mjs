/**
 * Staking client tests.  Run:  node --experimental-loader ./tests/resolve-hook.mjs tests/staking.test.mjs
 *
 * The wallet only READS the contract and simulates `sync` locally, so its numbers
 * must match what state.rs would compute. This file ports the WRITE side of
 * state.rs (stake / apply_reward / unstake / claim_profit / activate_bonus) as a
 * reference model, replays the scenarios from the Rust tests with the same
 * expected values, and fuzzes the client math against that model.
 */
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.window = { location: { origin: 'x', search: '', href: 'x' }, addEventListener() {}, removeEventListener() {} }
globalThis.document = { documentElement: {} }

const M = await import('../src/staking/stakingMath.js')
const S = await import('../src/staking/staking.js')
const { PublicKey, Keypair } = await import('@solana/web3.js')
const { sha256 } = await import('@noble/hashes/sha256')

let failures = 0, passes = 0
const ok = (cond, msg) => { if (cond) passes++; else { failures++; console.error('FAIL:', msg) } }
const D = 1_000_000_000n

// ---------- reference model (port of state.rs write paths) ----------
const newPool = () => ({ totalStaked: 0n, totalShares: 0n, totalBonusWeight: 0n, accBonus: 0n, bonusReserve: 0n,
  lastRewardAmount: 0n, lastRewardWeight: 0n, lastRewardTs: 0n, prevRewardTs: 0n, firstRewardTs: 0n, totalRewards: 0n, rewardCount: 0n })
const newUser = () => ({ ...M.emptyUser(), exists: true })
// state.rs mutates in place; simulateSync returns copies, so write them back.
function sync(p, u) { const r = M.simulateSync(p, u); Object.assign(p, r.pool); Object.assign(u, r.user) }
function refresh(p, u) { // refresh_weight
  p.totalBonusWeight -= u.bonusWeight
  u.bonusWeight = u.bonusActive ? u.shares * BigInt(u.bonusBps) : 0n
  p.totalBonusWeight += u.bonusWeight
  if (p.totalBonusWeight === 0n && p.bonusReserve > 0n) { p.totalStaked += p.bonusReserve; p.bonusReserve = 0n }
}
function stake(p, u, amt) {
  sync(p, u)
  const sh = M.sharesForAmount(p, amt); if (sh === 0n) throw new Error('TooSmall')
  p.totalStaked += amt; p.totalShares += sh; u.shares += sh; u.principal += amt; refresh(p, u); return sh
}
function applyReward(p, amt, now) {
  if (p.totalShares === 0n) throw new Error('NoStakers')
  const w = p.totalShares * M.BPS + p.totalBonusWeight
  let bonus = (amt * p.totalBonusWeight) / w
  const inc = bonus > 0n ? (bonus * M.ACC_PRECISION) / p.totalBonusWeight : 0n
  if (inc === 0n) bonus = 0n
  const weightTokens = (p.totalStaked * w) / (p.totalShares * M.BPS)
  p.totalStaked += amt - bonus; p.bonusReserve += bonus; p.accBonus += inc
  p.lastRewardAmount = amt; p.lastRewardWeight = weightTokens; p.prevRewardTs = p.lastRewardTs; p.lastRewardTs = BigInt(now)
  if (p.firstRewardTs === 0n) p.firstRewardTs = BigInt(now)
  p.totalRewards += amt; p.rewardCount += 1n
}
function burn(p, u, sh, amt) {
  p.totalStaked -= amt; p.totalShares -= sh; u.shares -= sh
  if (u.shares === 0n) { u.bonusActive = false; u.principal = 0n }
  refresh(p, u)
}
function unstake(p, u, sharesIn) {
  sync(p, u)
  const sh = sharesIn === M.U64_MAX ? u.shares : sharesIn
  if (sh === 0n) throw new Error('Zero'); if (sh > u.shares) throw new Error('Insufficient')
  const amt = M.amountForShares(p, sh)
  const pp = sh === u.shares ? u.principal : (u.principal * sh) / u.shares
  u.principal -= pp; u.profitWithdrawn += amt > pp ? amt - pp : 0n
  burn(p, u, sh, amt); return amt
}
function claim(p, u) {
  sync(p, u)
  const v = M.amountForShares(p, u.shares); const profit = v > u.principal ? v - u.principal : 0n
  let sh = (profit * p.totalShares) / p.totalStaked; if (sh > u.shares) sh = u.shares
  if (sh === 0n) throw new Error('NoProfit')
  const amt = M.amountForShares(p, sh); u.profitWithdrawn += amt; burn(p, u, sh, amt); return amt
}
function activate(p, u, bps, cap) {
  sync(p, u); if (u.bonusActive) throw new Error('Active')
  u.bonusUsed = true; u.bonusActive = true; u.bonusBps = bps; u.bonusCap = cap; u.bonusAccrued = 0n; u.accCheckpoint = p.accBonus; refresh(p, u)
}
const val = (p, u) => Number(M.positionSummary(p, u).value) / 1e9

// ---------- scenarios from state.rs tests ----------
{ // example_without_bonus
  const p = newPool(), a = newUser(), b = newUser()
  stake(p, a, 2n * D); stake(p, b, 8n * D); applyReward(p, D, 1)
  ok(M.positionSummary(p, a).value === 2_200_000_000n, 'no-bonus A 2.2')
  ok(M.positionSummary(p, b).value === 8_800_000_000n, 'no-bonus B 8.8')
  applyReward(p, (D * 11n) / 10n, 2)
  ok(M.positionSummary(p, a).value === 2_420_000_000n, 'no-bonus A 2.42')
  ok(M.positionSummary(p, b).value === 9_680_000_000n, 'no-bonus B 9.68')
}
{ // with bonus — display must already include the UNSYNCED bonus (simulated sync)
  const p = newPool(), a = newUser(), b = newUser()
  stake(p, a, 2n * D); stake(p, b, 8n * D); activate(p, b, 5000, D)
  applyReward(p, D, 1)          // no sync sent on chain
  ok(Math.abs(val(p, b) - (8 + 6 / 7)) < 1e-8, `bonus B shown ${val(p, b)} ≈ 8.857`)
  ok(Math.abs(val(p, a) - (2 + 1 / 7)) < 1e-8, `bonus A ${val(p, a)}`)
  const s = M.positionSummary(p, b)
  ok(Math.abs(Number(s.bonusAccrued) / 1e9 - 2 / 7) < 1e-8, 'bonus accrued 2/7 shown')
}
{ // claim_profit_only: displayed claimable == what claim_profit pays
  const p = newPool(), a = newUser(), b = newUser()
  stake(p, a, 2n * D); stake(p, b, 8n * D)
  ok(M.positionSummary(p, a).claimable === 0n, 'nothing claimable before reward')
  applyReward(p, D, 1)
  ok(M.positionSummary(p, a).profit === 200_000_000n, 'profit 0.2')
  const shown = M.positionSummary(p, a).claimable
  const got = claim(p, a)
  ok(shown === got, `claimable shown ${shown} == paid ${got}`)
}
{ // partial_withdrawal_splits_principal_and_profit + sharesToUnstake
  const p = newPool(), a = newUser(), b = newUser()
  stake(p, a, 2n * D); stake(p, b, 8n * D); applyReward(p, D, 1)
  const plan = M.sharesToUnstake(p, a, 550_000_000n)
  ok(!plan.all && plan.expected >= 550_000_000n, `plan expected ${plan.expected}`)
  const got = unstake(p, a, plan.shares)
  ok(got === plan.expected && got >= 550_000_000n, `unstake 0.55 got ${got}`)
  const allPlan = M.sharesToUnstake(p, a, M.positionSummary(p, a).value)
  ok(allPlan.all && allPlan.shares === M.U64_MAX, 'full amount → u64::MAX')
  let threw = false; try { M.sharesToUnstake(p, a, 100n * D) } catch (e) { threw = e.message === 'EXCEEDS' }
  ok(threw, 'too much → EXCEEDS')
}

// ---------- fuzz: client math vs reference model ----------
{
  let seed = 0x9E3779B97F4A7C15n
  const rnd = (n) => { seed ^= (seed << 13n) & M.U64_MAX; seed ^= seed >> 7n; seed ^= (seed << 17n) & M.U64_MAX; return seed % BigInt(n) }
  let checks = 0
  for (let round = 0; round < 150; round++) {
    const p = newPool(); const users = Array.from({ length: 4 }, newUser)
    for (let t = 0; t < 120; t++) {
      const u = users[Number(rnd(4))]
      try {
        switch (Number(rnd(6))) {
          case 0: case 1: stake(p, u, 1n + rnd(50n * D)); break
          case 2: applyReward(p, 1n + rnd(5n * D), t); break
          case 3: {
            const s = M.positionSummary(p, u)
            if (s.value > 0n) {
              const want = 1n + rnd(s.value)
              const plan = M.sharesToUnstake(p, u, want)
              const got = unstake(p, u, plan.shares)
              ok(got >= want, `unstake got ${got} < wanted ${want}`)
              ok(got === plan.expected, `unstake got ${got} != expected ${plan.expected}`)
              checks++
            }
            break
          }
          case 4: {
            const shown = M.positionSummary(p, u).claimable
            let got = 0n; try { got = claim(p, u) } catch { got = 0n }
            ok(shown === got, `claim shown ${shown} != paid ${got}`); checks++
            break
          }
          default: { try { activate(p, u, 1 + Number(rnd(20000)), 1n + rnd(10n * D)) } catch { /* active */ } }
        }
      } catch (e) { if (!['TooSmall', 'NoStakers'].includes(e.message)) throw e }
      // displayed value == value after a real sync
      const before = M.positionSummary(p, u).value
      sync(p, u)
      ok(M.amountForShares(p, u.shares) === before, 'simulated sync == real sync')
    }
  }
  ok(checks > 1000, `fuzz ran ${checks} checks`)
}

// ---------- APY ----------
{
  const p = newPool()
  ok(M.computeApy(p).apy === M.MIN_APY && M.computeApy(p).measured === null, 'no rewards → 3.5% floor')
  Object.assign(p, { rewardCount: 2n, lastRewardAmount: 1n * D, lastRewardWeight: 10_000n * D, lastRewardTs: 200_000n, prevRewardTs: 200_000n - 86_400n })
  const a = M.computeApy(p)
  ok(Math.abs(a.apy - (Math.pow(1.0001, 365) - 1)) < 1e-12 && !a.floored, `daily 0.01% → ${(a.apy * 100).toFixed(3)}%`)
  Object.assign(p, { lastRewardAmount: D / 100n })
  ok(M.computeApy(p).apy === M.MIN_APY && M.computeApy(p).floored, 'low reward → floored at 3.5%')
  Object.assign(p, { lastRewardAmount: 1n * D, prevRewardTs: 199_990n })
  ok(Math.abs(M.computeApy(p).apy - (Math.pow(1.0001, 365) - 1)) < 1e-12, 'two deposits within a day → period clamped to 1 day')
}

// ---------- account decoding ----------
{
  const disc = (n) => sha256(new TextEncoder().encode(`account:${n}`)).slice(0, 8)
  const le = (v, n) => { const b = new Uint8Array(n); let x = BigInt.asUintN(n * 8, BigInt(v)); for (let i = 0; i < n; i++) { b[i] = Number(x & 0xffn); x >>= 8n } return b }
  const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length } return o }
  const [k1, k2, k3] = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey]
  const poolBuf = cat(disc('Pool'), k1.toBytes(), k2.toBytes(), k3.toBytes(), [254], [253],
    le(11n, 8), le(12n, 8), le(13n, 16), le(14n, 16), le(15n, 8), le(16n, 8), le(17n, 8), le(-18n, 8), le(19n, 8), le(20n, 8), le(21n, 8), le(22n, 8))
  ok(poolBuf.length === 8 + 210, `Pool size ${poolBuf.length}`)
  const pd = S.decodePool(poolBuf)
  ok(pd.admin.equals(k1) && pd.vault.equals(k3) && pd.totalStaked === 11n && pd.totalShares === 12n && pd.totalBonusWeight === 13n &&
     pd.accBonus === 14n && pd.bonusReserve === 15n && pd.lastRewardTs === -18n && pd.rewardCount === 22n, 'Pool decoded')
  const userBuf = cat(disc('UserStake'), k1.toBytes(), k2.toBytes(), [7], le(100n, 8), [1], [0], le(5000, 2), le(200n, 8), le(30n, 8),
    le(40n, 16), le(50n, 16), le(60n, 8), le(70n, 8), le(80n, 8))
  ok(userBuf.length === S.USER_STAKE_SPACE, `UserStake size ${userBuf.length}`)
  const ud = S.decodeUserStake(userBuf)
  ok(ud.shares === 100n && ud.bonusUsed && !ud.bonusActive && ud.bonusBps === 5000 && ud.bonusCap === 200n && ud.bonusAccrued === 30n &&
     ud.bonusWeight === 40n && ud.accCheckpoint === 50n && ud.principal === 60n && ud.profitWithdrawn === 70n && ud.bonusTotal === 80n, 'UserStake decoded')
  let threw = false; try { S.decodePool(userBuf) } catch { threw = true }
  ok(threw, 'wrong discriminator rejected')
  // bonus code hash = sha256(code || wallet)
  const h = S.bonusCodeHash('ABC', k1)
  ok(Buffer.from(h).equals(Buffer.from(sha256(cat(new TextEncoder().encode('ABC'), k1.toBytes())))), 'bonus hash')
  ok(S.stakingErrorName({ message: 'custom program error: 0x1775' }) === 'InvalidCode', 'error 6005 → InvalidCode')
  ok(S.stakingErrorName({ message: 'x', logs: ['Program log: AnchorError ... Error Code: NoProfit. Error Number: 6008'] }) === 'NoProfit', 'named error')
  ok(S.getPoolPda() instanceof PublicKey, 'pool pda')
}

// ---------- amount parsing ----------
ok(M.parseAmountToRaw('1.5', 9) === 1_500_000_000n, 'parse 1.5')
ok(M.parseAmountToRaw('0.000000001', 9) === 1n, 'parse 1 base unit')
ok(M.parseAmountToRaw('abc', 9) === null, 'parse junk')
ok(M.rawToInputString(1_230_000_000n, 9) === '1.23', 'raw→input')

console.log(`\nstaking tests: ${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
