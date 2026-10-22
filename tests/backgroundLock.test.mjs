/**
 * Background lock tests.  Run: node tests/backgroundLock.test.mjs
 * The wallet must lock as soon as the app is hidden / unloaded — except while the app's
 * own system dialog (WebAuthn fingerprint / Face ID sheet) is open.
 */
const { installBackgroundLock, duringSystemDialog, isSystemDialogActive } = await import('../src/crypto/backgroundLock.js')

let failures = 0, passes = 0
const ok = (c, m) => { if (c) passes++; else { failures++; console.error('FAIL:', m) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class FakeDoc extends EventTarget { constructor() { super(); this.visibilityState = 'visible' } }
const doc = new FakeDoc(), win = new EventTarget()
const wallet = { unlocked: true, locks: [], isUnlocked() { return this.unlocked }, lock(reason) { this.locks.push(reason); this.unlocked = false } }
const hide = () => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) }
const show = () => { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')) }

const cleanup = installBackgroundLock(wallet, doc, win)

show()
ok(wallet.locks.length === 0, 'becoming visible does not lock')
hide()
ok(wallet.locks.length === 1 && wallet.locks[0] === 'background', 'hidden → locked with reason "background"')
hide()
ok(wallet.locks.length === 1, 'already locked → no second lock')

wallet.unlocked = true; show()
win.dispatchEvent(new Event('pagehide'))
ok(wallet.locks.length === 2, 'pagehide → locked')

// WebAuthn sheet hides the page: no lock while it is open, nor right after it closes
wallet.unlocked = true; show()
await duringSystemDialog(async () => { ok(isSystemDialogActive(), 'dialog active'); hide(); await sleep(50) })
ok(wallet.locks.length === 2, 'hidden during system dialog → not locked')
show(); hide()
ok(wallet.locks.length === 2, 'hidden just after dialog (grace) → not locked')
await sleep(1600)
ok(!isSystemDialogActive(), 'grace period over')
show(); hide()
ok(wallet.locks.length === 3, 'hidden after the dialog grace period → locked')

// a failing dialog must not leave the guard stuck
wallet.unlocked = true; show()
try { await duringSystemDialog(async () => { throw new Error('cancelled') }) } catch { /* expected */ }
await sleep(1600)
hide()
ok(wallet.locks.length === 4, 'cancelled dialog does not disable the lock')

cleanup()
wallet.unlocked = true; show(); hide()
ok(wallet.locks.length === 4, 'cleanup removes the listeners')

console.log(`\nbackground lock tests: ${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
