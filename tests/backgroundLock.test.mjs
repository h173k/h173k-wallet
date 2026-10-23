/**
 * Background lock tests.  Run: node tests/backgroundLock.test.mjs
 * The wallet must lock as soon as the app is hidden / unloaded — except while the app's
 * own system dialog (WebAuthn fingerprint / Face ID sheet) is open.
 */
const { installBackgroundLock, duringSystemDialog, isSystemDialogActive, duringCriticalOperation, isLockPending, MAX_DEFER_MS } = await import('../src/crypto/backgroundLock.js')

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

// ---------- critical operations (spin, send, staking) defer the lock ----------
{
  const d2 = new FakeDoc(), w2 = new EventTarget()
  let clock = 1_000_000
  const wal = { unlocked: true, locks: [], isUnlocked() { return this.unlocked }, lock(r) { this.locks.push(r); this.unlocked = false } }
  const hide2 = () => { d2.visibilityState = 'hidden'; d2.dispatchEvent(new Event('visibilitychange')) }
  const show2 = () => { d2.visibilityState = 'visible'; d2.dispatchEvent(new Event('visibilitychange')) }
  const off = installBackgroundLock(wal, d2, w2, () => clock)

  // leave mid-operation → no lock until it finishes, then locked at once
  let release
  const op = duringCriticalOperation(() => new Promise((r) => { release = r }))
  hide2()
  ok(wal.locks.length === 0 && isLockPending(), 'hidden during a spin → lock deferred')
  show2()
  ok(wal.locks.length === 0, 'coming back while the spin still runs → still not locked (no interruption)')
  release('done'); ok((await op) === 'done', 'operation result is returned')
  ok(wal.locks.length === 1 && wal.locks[0] === 'background' && !isLockPending(), 'operation finished → locked')

  // a failing operation still releases the pending lock
  wal.unlocked = true; show2()
  try { await duringCriticalOperation(async () => { hide2(); throw new Error('spin failed') }) } catch { /* expected */ }
  ok(wal.locks.length === 2, 'failed operation → pending lock applied')

  // nested operations: lock only after the outermost one ends
  wal.unlocked = true; show2()
  await duringCriticalOperation(async () => {
    await duringCriticalOperation(async () => { hide2() })
    ok(wal.locks.length === 2, 'inner op ended, outer still running → not yet locked')
  })
  ok(wal.locks.length === 3, 'outer op ended → locked')

  // no operation running → immediate, as before
  wal.unlocked = true; show2(); hide2()
  ok(wal.locks.length === 4, 'no operation → immediate lock')

  // a hung operation cannot keep the wallet open: on return after MAX_DEFER_MS → locked
  wal.unlocked = true; show2()
  let release2
  const hung = duringCriticalOperation(() => new Promise((r) => { release2 = r }))
  hide2(); clock += MAX_DEFER_MS + 1; show2()
  ok(wal.locks.length === 5, 'returned after the max deferral → locked even though the op still runs')
  release2(); await hung
  ok(wal.locks.length === 5, 'op ending later does not lock twice')
  off()
}

// ---------- Settings: "Lock when leaving the app" off + auto-lock deadline on return ----------
{
  const d3 = new FakeDoc(), w3 = new EventTarget()
  let clock = 5_000_000
  let enabled = false
  const wal = { unlocked: true, locks: [], lockDeadline: clock + 300_000,
    isUnlocked() { return this.unlocked }, lock(r) { this.locks.push(r); this.unlocked = false } }
  const hide3 = () => { d3.visibilityState = 'hidden'; d3.dispatchEvent(new Event('visibilitychange')) }
  const show3 = () => { d3.visibilityState = 'visible'; d3.dispatchEvent(new Event('visibilitychange')) }
  const off = installBackgroundLock(wal, d3, w3, () => clock, () => enabled)

  hide3(); w3.dispatchEvent(new Event('pagehide'))
  ok(wal.locks.length === 0, 'setting off → leaving the app does not lock')
  clock += 60_000; show3()
  ok(wal.locks.length === 0, 'back before the auto-lock time → still unlocked')

  hide3(); clock += 600_000; show3()   // phone slept the app past the auto-lock time
  ok(wal.locks.length === 1 && wal.locks[0] === 'auto', 'back after the auto-lock time → locked (timer slept)')

  // a running operation is not cut by the deadline check either
  wal.unlocked = true; wal.lockDeadline = clock - 1
  let rel
  const op = duringCriticalOperation(() => new Promise((r) => { rel = r }))
  show3()
  ok(wal.locks.length === 1, 'deadline passed during a running op → not cut in half')
  rel(); await op

  // switching the setting on takes effect immediately (read at the moment of leaving)
  wal.unlocked = true; wal.lockDeadline = clock + 300_000; enabled = true
  hide3()
  ok(wal.locks.length === 2 && wal.locks[1] === 'background', 'setting switched on → next leave locks at once')
  off()
}

console.log(`\nbackground lock tests: ${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
