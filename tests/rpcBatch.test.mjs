/** Batched balance read tests.  Run: node --experimental-loader ./tests/resolve-hook.mjs tests/rpcBatch.test.mjs */
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
const { Keypair, PublicKey } = await import('@solana/web3.js')
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = await import('@solana/spl-token')
const { tokenAmountOf, fetchWalletBalances } = await import('../src/rpcBatch.js')
const { TOKEN_MINT, USDT_MINT } = await import('../src/constants.js')
let failures = 0, passes = 0
const ok = (c, m) => { if (c) passes++; else { failures++; console.error('FAIL:', m) } }

const tokenAcc = (amount, owner = TOKEN_PROGRAM_ID) => {
  const data = Buffer.alloc(165)
  data.writeBigUInt64LE(BigInt(amount), 64)
  return { data, owner, lamports: 2039280, executable: false }
}
ok(tokenAmountOf(tokenAcc(123456789012n)) === 123456789012n, 'u64 amount decoded')
ok(tokenAmountOf(null) === 0n, 'missing account → 0')
ok(tokenAmountOf(tokenAcc(5n, Keypair.generate().publicKey)) === 0n, 'not a token account → 0')

const owner = Keypair.generate().publicKey
let calls = 0, asked = null
const conn = { getMultipleAccountsInfo: async (keys) => { calls++; asked = keys
  return [tokenAcc(2_500_000_000n), { lamports: 12_345_678, data: Buffer.alloc(0), owner: new PublicKey('11111111111111111111111111111111') }, tokenAcc(7_000_000n)] } }
const b = await fetchWalletBalances(conn, owner)
ok(calls === 1, 'one request for all three balances')
ok(asked[0].equals(getAssociatedTokenAddressSync(TOKEN_MINT, owner)) && asked[1].equals(owner) && asked[2].equals(getAssociatedTokenAddressSync(USDT_MINT, owner)), 'asks for h173k ATA, wallet, USDT ATA')
ok(b.h173kRaw === 2_500_000_000n && b.lamports === 12_345_678 && b.usdtRaw === 7_000_000n, 'balances decoded')
const empty = await fetchWalletBalances({ getMultipleAccountsInfo: async () => [null, null, null] }, owner)
ok(empty.h173kRaw === 0n && empty.lamports === 0 && empty.usdtRaw === 0n, 'fresh wallet (no accounts) → zeros')

console.log(`\nrpc batch tests: ${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
