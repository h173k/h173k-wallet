/** Remembered failed SOL top-ups.  Run: node --experimental-loader ./tests/resolve-hook.mjs tests/solTopUp.test.mjs */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.document = { documentElement: {} }
const { markTopUpPending, clearTopUpPending, isTopUpPending, topUpFailedError, isTopUpFailedError } = await import('../src/solTopUp.js')
let failures = 0, passes = 0
const ok = (c, m) => { if (c) passes++; else { failures++; console.error('FAIL:', m) } }
ok(!isTopUpPending('A'), 'nothing pending at start')
markTopUpPending('A', 'Failed to fetch')
ok(isTopUpPending('A'), 'failed top-up remembered')
ok(!isTopUpPending('B'), 'per wallet address')
ok(JSON.parse(mem.get('h173k_sol_topup_pending')).reason === 'Failed to fetch', 'reason stored (survives restart)')
clearTopUpPending()
ok(!isTopUpPending('A'), 'cleared after a successful swap')
const e = topUpFailedError(new Error('x'))
ok(isTopUpFailedError(e) && e.code === 'SOL_TOPUP_FAILED' && e.message.length > 20, 'stop error has a code and a readable message')
console.log(`\nsol top-up tests: ${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
