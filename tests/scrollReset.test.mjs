/** Scroll reset tests.  Run: node tests/scrollReset.test.mjs */
const { scrollAppToTop, installScrollResetOnReturn } = await import('../src/scrollReset.js')
let failures = 0, passes = 0
const ok = (c, m) => { if (c) passes++; else { failures++; console.error('FAIL:', m) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class FakeDoc extends EventTarget {
  constructor() {
    super(); this.visibilityState = 'visible'
    this.body = { scrollTop: 0 }; this.documentElement = { scrollTop: 0 }; this.scrollingElement = this.documentElement
    this.activeElement = { blurred: false, blur() { this.blurred = true } }
  }
}
class FakeWin extends EventTarget { constructor() { super(); this.y = 0 } scrollTo(x, y) { this.y = y } }
const doc = new FakeDoc(), win = new FakeWin()
const scrollDown = () => { win.y = 240; doc.body.scrollTop = 240; doc.documentElement.scrollTop = 240 }
const atTop = () => win.y === 0 && doc.body.scrollTop === 0 && doc.documentElement.scrollTop === 0

scrollDown(); scrollAppToTop(doc, win)
ok(atTop(), 'scrollAppToTop resets window, <html> and <body>')
ok(doc.activeElement.blurred, 'focused field is blurred (keyboard closes)')

const cleanup = installScrollResetOnReturn(doc, win, 50)
scrollDown(); doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'))
ok(!atTop(), 'leaving the app does not scroll')
doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'))
ok(atTop(), 'returning to the app → top')
scrollDown(); await sleep(80)
ok(atTop(), 'repeated shortly after return (late iOS layout)')
scrollDown(); win.dispatchEvent(new Event('pageshow'))
ok(atTop(), 'pageshow (restored page) → top')
await sleep(80)
cleanup(); scrollDown(); doc.dispatchEvent(new Event('visibilitychange'))
ok(!atTop(), 'cleanup removes listeners')

console.log(`\nscroll reset tests: ${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
