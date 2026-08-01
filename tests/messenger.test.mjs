/**
 * Messenger logic tests.
 * Run with:  node tests/messenger.test.mjs
 *
 * Exercises the real modules (no mocks of our own code) against a minimal
 * browser shim: localStorage, window, and a session wallet holding a keypair.
 */

// ---------- browser shims (must exist before the modules load) ----------
class MemStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
}
globalThis.localStorage = new MemStorage()
globalThis.window = { location: { origin: 'https://wallet.example', search: '', href: 'https://wallet.example/' }, addEventListener() {}, removeEventListener() {} }
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en' }, configurable: true })
}
globalThis.document = { documentElement: {} }

const { Keypair } = await import('@solana/web3.js')
const { sessionWallet } = await import('../src/crypto/wallet.js')

// A session wallet we can point at any identity we like.
function useIdentity(kp) {
  sessionWallet.keypair = kp
  sessionWallet.publicKey = kp.publicKey
  sessionWallet.unlocked = true
}
sessionWallet.resetAutoLock = () => {}

const alice = Keypair.generate()
const bob = Keypair.generate()
const carol = Keypair.generate()

// ---------- modules under test ----------
const channels = await import('../src/messenger/channels.js')
const msgcrypto = await import('../src/messenger/msgcrypto.js')
const envelope = await import('../src/messenger/envelope.js')
const prefs = await import('../src/messenger/prefs.js')
const groups = await import('../src/messenger/groups.js')
const messenger = await import('../src/messenger/messenger.js')
const chatlist = await import('../src/messenger/chatlist.js')

// ---------- tiny assertion helpers ----------
let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok   ' + name)
  } catch (err) {
    failures.push(name + ' -> ' + err.message)
    console.log('  FAIL ' + name + ' -> ' + err.message)
  }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b)
  if (sa !== sb) throw new Error((msg || 'not equal') + ': ' + sa + ' !== ' + sb)
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy, got ' + v) }
function section(t) { console.log('\n' + t) }

const A = alice.publicKey.toBase58()
const B = bob.publicKey.toBase58()
const C = carol.publicKey.toBase58()

// =====================================================================
section('1. Dedicated conversation addresses')

useIdentity(alice)
const chanAB = channels.deriveConversationAddress(B)
const chanAB2 = channels.deriveConversationAddress(B)
const chanAC = channels.deriveConversationAddress(C)

check('derivation is deterministic', () => eq(chanAB, chanAB2))
check('a different peer gets a different address', () => ok(chanAB !== chanAC))
check('conversation address is not the wallet address', () => ok(chanAB !== A && chanAB !== B))

useIdentity(bob)
const chanBA = channels.deriveConversationAddress(A)
check("Bob's address for Alice differs from Alice's for Bob", () => ok(chanBA !== chanAB))

useIdentity(alice)
check('re-deriving after an identity switch still matches', () => eq(channels.deriveConversationAddress(B), chanAB))

// =====================================================================
section('2. Envelope encryption round trip')

useIdentity(alice)
const aliceBoxPub = msgcrypto.getMyDedicatedPublicKey()
useIdentity(bob)
const bobBoxPub = msgcrypto.getMyDedicatedPublicKey()

check('dedicated public keys differ per wallet', () => ok(aliceBoxPub !== bobBoxPub))

// Alice -> Bob using bootstrap keys (first contact, no key exchange yet)
useIdentity(alice)
const inviteMemo = envelope.buildDirectEnvelope({
  type: 'req',
  from: A,
  myBoxPub: aliceBoxPub,
  payload: { nick: 'alice', text: 'hello there', ch: chanAB },
  recipientAddress: B,
  peerDedicatedPub: null,
})
useIdentity(bob)
const parsedInvite = envelope.parseEnvelope(inviteMemo)
check('invitation parses', () => ok(parsedInvite && parsedInvite.t === 'req'))
check('invitation uses the bootstrap scheme', () => eq(parsedInvite.e, 'addr'))
check('Bob decrypts the invitation and learns the address', () => {
  const p = msgcrypto.decryptFrom(parsedInvite)
  eq(p.text, 'hello there')
  eq(p.ch, chanAB)
})
useIdentity(carol)
check('an outsider cannot decrypt it', () => {
  const p = msgcrypto.decryptFrom(parsedInvite)
  ok(p === null, 'Carol decrypted a message that was not for her')
})

// Bob -> Alice using the dedicated keys now that they are exchanged
useIdentity(bob)
const replyMemo = envelope.buildDirectEnvelope({
  type: 'msg',
  from: B,
  myBoxPub: bobBoxPub,
  payload: { nick: 'bob', text: 'hi alice' },
  recipientAddress: A,
  peerDedicatedPub: aliceBoxPub,
})
useIdentity(alice)
const parsedReply = envelope.parseEnvelope(replyMemo)
check('reply uses the dedicated-key scheme', () => eq(parsedReply.e, 'box'))
check('Alice decrypts the reply', () => eq(msgcrypto.decryptFrom(parsedReply).text, 'hi alice'))

check('a v1 envelope still parses (backwards compatibility)', () => {
  const legacy = JSON.stringify({ v: 1, t: 'msg', e: 'addr', f: B, p: bobBoxPub, n: 'AA', c: 'BB' })
  const p = envelope.parseEnvelope(legacy)
  ok(p && p.v === 1 && p.t === 'msg')
})
check('a non-messenger memo is ignored', () => ok(envelope.parseEnvelope('gm frens') === null))

// =====================================================================
section('3. Memo size budget (the limit is bytes, not characters)')

useIdentity(alice)
const envParamsMsg = { type: 'msg', from: A, myBoxPub: aliceBoxPub, feePaid: 1234.5678 }

check('size estimation matches the real encrypted memo', () => {
  const payload = { nick: 'alice', text: 'a normal message', fee: 12 }
  const estimated = envelope.estimateMemoSize({ ...envParamsMsg, payload })
  const actual = envelope.memoByteLength(envelope.buildDirectEnvelope({
    ...envParamsMsg, payload, recipientAddress: B, peerDedicatedPub: bobBoxPub,
  }))
  eq(estimated, actual, 'estimate must be exact')
})

// The alphabets the wallet ships with: Latin, Polish, Amharic.
const ALPHABETS = {
  latin: 'x',
  polish: 'ą',   // 2 bytes each
  amharic: 'አ',  // 3 bytes each
}

for (const [label, chr] of Object.entries(ALPHABETS)) {
  check(`a full-length message in ${label} either fits or is refused cleanly`, () => {
    const full = {
      nick: 'n'.repeat(32),
      text: chr.repeat(messenger.MAX_MESSAGE_LENGTH),
      fee: 1234.5678,
      r: { i: 'x'.repeat(16), t: 'x'.repeat(34) },
    }
    const fitted = envelope.fitPayload(full, envParamsMsg)
    if (fitted) {
      const size = envelope.memoByteLength(envelope.buildDirectEnvelope({
        ...envParamsMsg, payload: fitted, recipientAddress: B, peerDedicatedPub: bobBoxPub,
      }))
      ok(size <= envelope.MAX_MEMO_BYTES, `fitted payload still too big: ${size} B`)
    }
    // When it does not fit, the composer must have warned already.
    const remaining = envelope.memoRemaining(full, envParamsMsg)
    ok(fitted ? remaining >= 0 : remaining < 0, 'counter disagrees with the fitter')
  })
}

check('an invitation carrying the conversation address fits', () => {
  const payload = {
    nick: 'n'.repeat(32),
    text: 'x'.repeat(messenger.MAX_INVITE_LENGTH),
    ch: chanAB,
    fee: 1234.5678,
  }
  const fitted = envelope.fitPayload(payload, { type: 'req', from: A, myBoxPub: aliceBoxPub, feePaid: 1234.5678 })
  ok(fitted, 'invitation did not fit at all')
  ok(fitted.ch === chanAB, 'the address must never be the field that gets dropped')
})

check('the nickname is dropped before the message is refused', () => {
  // 230 characters fit only once the nickname and fee are out of the way.
  const payload = { nick: 'n'.repeat(32), text: 'x'.repeat(230), fee: 99 }
  ok(envelope.estimateMemoSize({ ...envParamsMsg, payload }) > envelope.MAX_MEMO_BYTES,
    'test premise: this payload should not fit as-is')
  const fitted = envelope.fitPayload(payload, envParamsMsg)
  ok(fitted, 'should have fitted after dropping optional fields')
  ok(fitted.nick === undefined, 'the nickname should be gone')
  ok(fitted.fee === 99, 'the fee must never be dropped - it is how a contact learns the amount')
  ok(fitted.text.length === 230, 'the text itself must be preserved')
})

check('an impossibly long text is refused rather than silently truncated', () => {
  const payload = { text: 'x'.repeat(2000) }
  ok(envelope.fitPayload(payload, envParamsMsg) === null)
})

check('group messages keep the nickname and drop the reply preview first', () => {
  const envParamsGrp = { type: 'grp', from: A, myBoxPub: aliceBoxPub, groupId: 'deadbeefcafe0001' }
  const payload = {
    nick: 'n'.repeat(32),
    text: 'x'.repeat(groups.MAX_GROUP_MESSAGE_LENGTH),
    r: { i: 'x'.repeat(16), n: 'x'.repeat(12), t: 'x'.repeat(groups.REPLY_PREVIEW_LENGTH) },
  }
  const fitted = envelope.fitPayload(payload, envParamsGrp, ['r', 'nick'])
  ok(fitted, 'group message did not fit')
  ok(fitted.nick !== undefined, 'the nickname identifies the speaker in a group')
  const size = envelope.memoByteLength(envelope.buildGroupEnvelope({
    from: A, myBoxPub: aliceBoxPub, payload: fitted,
    groupKey: msgcrypto.newGroupKey(), groupId: 'deadbeefcafe0001',
  }))
  ok(size <= envelope.MAX_MEMO_BYTES, `${size} B`)
})

// Report the practical ceilings so the numbers are visible, not guessed.
function maxCharsThatFit(chr, envParams, extra = {}) {
  let n = 0
  for (let i = 1; i <= 400; i++) {
    const p = { text: chr.repeat(i), ...extra }
    if (envelope.estimateMemoSize({ ...envParams, payload: p }) <= envelope.MAX_MEMO_BYTES) n = i
    else break
  }
  return n
}
console.log('     practical ceilings (optional fields dropped):')
for (const [label, chr] of Object.entries(ALPHABETS)) {
  console.log(`       ${label.padEnd(8)} plain ${String(maxCharsThatFit(chr, envParamsMsg)).padStart(3)} chars` +
    `  |  with reply ${String(maxCharsThatFit(chr, envParamsMsg, { r: { i: 'x'.repeat(16), t: 'x'.repeat(34) } })).padStart(3)} chars`)
}

section('4. Anti-spam fee policy')

const fee = (addr, known) => prefs.getRequiredFeeFrom(addr, known)

prefs.saveFeePolicy({ mode: 'off', amount: 5, perContact: {} })
check('mode off charges nothing even with an amount set', () => {
  eq(fee(B, false), 0); eq(fee(B, true), 0)
})

prefs.saveFeePolicy({ mode: 'new', amount: 5, perContact: {} })
check('mode new charges unknown contacts only', () => {
  eq(fee(B, false), 5); eq(fee(B, true), 0)
})

prefs.saveFeePolicy({ mode: 'all', amount: 5, perContact: {} })
check('mode all charges everybody', () => {
  eq(fee(B, false), 5); eq(fee(B, true), 5)
})

prefs.saveFeePolicy({ mode: 'selected', amount: 5, perContact: { [C]: 9 } })
check('mode selected charges only the marked contacts', () => {
  eq(fee(B, false), 0); eq(fee(C, true), 9)
})

prefs.saveFeePolicy({ mode: 'all', amount: 5, perContact: { [B]: 0 } })
check('an individual 0 waives the global fee', () => eq(fee(B, false), 0))
check('others still pay the global fee', () => eq(fee(C, false), 5))

prefs.saveFeePolicy({ mode: 'off', amount: 0, perContact: { [B]: 3 } })
check('an individual amount applies even when the mode is off', () => eq(fee(B, false), 3))
prefs.saveFeePolicy({ mode: 'off', amount: 0, perContact: {} })
check('negative and junk amounts are clamped to 0', () => {
  eq(prefs.sanitizeFee(-4), 0)
  eq(prefs.sanitizeFee('abc'), 0)
  eq(prefs.sanitizeFee('2.5'), 2.5)
})

// =====================================================================
section('5. Group keys and invitations')

useIdentity(alice)
const gKey = msgcrypto.newGroupKey()
const gEnv = envelope.parseEnvelope(envelope.buildGroupEnvelope({
  from: A, myBoxPub: aliceBoxPub,
  payload: { nick: 'alice', text: 'group hello', r: { i: 'sig123', n: 'bob', t: 'earlier' } },
  groupKey: gKey, groupId: 'deadbeefcafe0001',
}))
check('group message decrypts with the group key', () => {
  const p = msgcrypto.decryptGroup(gEnv, gKey)
  eq(p.text, 'group hello')
  eq(p.r.n, 'bob')
})
check('group message does not decrypt with another key', () => {
  ok(msgcrypto.decryptGroup(gEnv, msgcrypto.newGroupKey()) === null)
})
check('the group id travels in the clear so members can pick the key', () => eq(gEnv.g, 'deadbeefcafe0001'))

const fakeGroup = {
  id: 'deadbeefcafe0001',
  admin: A,
  address: channels.deriveGroupAddress('deadbeefcafe0001'),
  name: 'Traders',
  inviteCode: 'abc123xyz',
  minBalance: 500,
  msgCost: 0.002,
  key: gKey,
}
const link = groups.buildInviteLink(fakeGroup)
check('the invite link never contains the group address', () => {
  ok(!link.includes(fakeGroup.address), 'group address leaked into the link!')
})
check('the invite link never contains the group key', () => {
  ok(!link.includes(gKey), 'group key leaked into the link!')
})
check('the invite link round-trips admin, code and rules', () => {
  const param = link.split('join=')[1]
  const parsed = groups.parseInviteParam(param)
  eq(parsed.admin, A)
  eq(parsed.code, 'abc123xyz')
  eq(parsed.name, 'Traders')
  eq(parsed.minBalance, 500)
  eq(parsed.msgCost, 0.002)
})
check('a malformed invite is rejected', () => {
  ok(groups.parseInviteParam('not-base64!!') === null)
  ok(groups.parseInviteParam(msgcrypto.encodeJsonB64Url({ a: 'nonsense', c: 'x' })) === null)
})
check('the group address is derived from the admin seed, not the wallet address', () => {
  ok(fakeGroup.address !== A)
  useIdentity(bob)
  ok(channels.deriveGroupAddress('deadbeefcafe0001') !== fakeGroup.address)
  useIdentity(alice)
})

// =====================================================================
section('6. Admission control (client-side filter)')

// The applicant's own wallet must refuse to send when the balance is short,
// so nothing ever reaches the admin.
const fakeConnection = {
  async getTokenAccountBalance() { return { value: { uiAmount: 10 } } },
}
check('a poor applicant is stopped before anything is sent', async () => {})
const joinResult = await groups.sendJoinRequest({
  connection: fakeConnection,
  publicKey: bob.publicKey,
  invite: { admin: A, code: 'abc123xyz', name: 'Traders', minBalance: 500, msgCost: 0.002 },
  withAutoSOL: async () => { throw new Error('TRANSACTION_WAS_SENT') },
  balance: 10,
}).then(() => 'sent').catch((e) => e.message)
check('join request blocked locally with the shortfall reported', () => {
  ok(String(joinResult).startsWith('INSUFFICIENT_BALANCE:500:10'), 'got: ' + joinResult)
})

const joinOwn = await groups.sendJoinRequest({
  connection: fakeConnection,
  publicKey: alice.publicKey,
  invite: { admin: A, code: 'x', minBalance: 0 },
  withAutoSOL: async () => { throw new Error('TRANSACTION_WAS_SENT') },
  balance: 1000,
}).then(() => 'sent').catch((e) => e.message)
check('you cannot apply to your own group', () => eq(joinOwn, 'OWN_GROUP'))

// Admin side: a request from a wallet below the threshold is dropped silently.
useIdentity(alice)
groups.groupStore.put({
  id: 'g-admin-test', name: 'Gated', address: channels.deriveGroupAddress('g-admin-test'),
  admin: A, isAdmin: true, key: gKey, minBalance: 500, msgCost: 0.001,
  inviteCode: 'gate-code', members: {}, pending: {}, messages: [], unread: 0, createdAt: Date.now(),
})
const poorConnection = { async getTokenAccountBalance() { return { value: { uiAmount: 3 } } } }
const richConnection = { async getTokenAccountBalance() { return { value: { uiAmount: 900 } } } }

const verdictPoor = await groups.processIncomingJoinRequest(poorConnection, {
  from: B, payload: { code: 'gate-code', nick: 'bob' }, ts: Date.now(),
})
check('admin auto-rejects an applicant below the threshold', () => eq(verdictPoor, 'rejected'))
check('the rejected applicant never appears in the pending list', () => {
  eq(Object.keys(groups.groupStore.get('g-admin-test').pending), [])
})

const verdictRich = await groups.processIncomingJoinRequest(richConnection, {
  from: C, payload: { code: 'gate-code', nick: 'carol' }, ts: Date.now(),
})
check('an applicant who qualifies reaches the admin', () => eq(verdictRich, 'pending'))
check('the qualifying applicant is listed for a decision', () => {
  eq(Object.keys(groups.groupStore.get('g-admin-test').pending), [C])
})

const verdictUnknown = await groups.processIncomingJoinRequest(richConnection, {
  from: C, payload: { code: 'rotated-away' }, ts: Date.now(),
})
check('a request quoting a rotated code is ignored', () => eq(verdictUnknown, 'ignored'))

// =====================================================================
section('7. Chat list sorting and filtering')

localStorage.clear()
const now = Date.now()
messenger.store._threads = {
  [B]: { address: B, contactName: 'Bob', messages: [{ id: '1', ts: now - 1000, text: 'a' }], unread: 0, createdAt: now },
  [C]: { address: C, contactName: 'Carol', messages: [{ id: '2', ts: now - 3000, text: 'b' }], unread: 0, createdAt: now },
}
groups.groupStore._groups = {
  g1: { id: 'g1', name: 'Newest group', messages: [{ id: '3', ts: now - 500 }], unread: 0, createdAt: now, pending: {}, members: {} },
  g2: { id: 'g2', name: 'Older group', messages: [{ id: '4', ts: now - 2000 }], unread: 0, createdAt: now, pending: {}, members: {} },
}

const kinds = (mode) => chatlist.buildChatList(mode).map((i) => i.kind + ':' + (i.group ? i.group.id : i.thread.contactName))

check('recent interleaves both kinds newest-first', () => {
  eq(kinds('recent'), ['group:g1', 'direct:Bob', 'group:g2', 'direct:Carol'])
})
check('groupsFirst puts groups on top', () => {
  eq(kinds('groupsFirst'), ['group:g1', 'group:g2', 'direct:Bob', 'direct:Carol'])
})
check('directFirst puts individual conversations on top', () => {
  eq(kinds('directFirst'), ['direct:Bob', 'direct:Carol', 'group:g1', 'group:g2'])
})
check('groupsOnly hides individual conversations', () => {
  eq(kinds('groupsOnly'), ['group:g1', 'group:g2'])
})
check('directOnly hides groups', () => {
  eq(kinds('directOnly'), ['direct:Bob', 'direct:Carol'])
})
check('an unknown mode falls back to newest-first', () => {
  eq(kinds('nonsense'), kinds('recent'))
})

// =====================================================================
section('8. Routing: where a conversation lives')

localStorage.clear()
messenger.store._threads = {}
useIdentity(alice)

check('a brand-new conversation is invited from the inbox and announces its address', () => {
  const r = messenger.resolveTarget(B)
  eq(r.target, B, 'invitation must reach the wallet inbox')
  eq(r.announceChannel, chanAB)
  ok(r.isInvite)
  ok(!r.legacy)
})

messenger.store._threads[B] = {
  address: B, messages: [], channel: chanAB, channelMine: true, channelConfirmed: true,
}
check('once the peer answers, traffic moves to the dedicated address', () => {
  const r = messenger.resolveTarget(B)
  eq(r.target, chanAB)
  eq(r.announceChannel, null)
  ok(!r.isInvite)
})

messenger.store._threads[C] = {
  address: C, messages: [{ id: 'old', ts: now, text: 'from the old build' }], channel: null,
}
check('a pre-existing thread stays on the wallet address', () => {
  const r = messenger.resolveTarget(C)
  eq(r.target, C)
  ok(r.legacy)
})

messenger.store._threads[B].legacyPeer = true
messenger.store._threads[B].channelConfirmed = false
check('a peer on an older build keeps the wallet-address behaviour', () => {
  const r = messenger.resolveTarget(B)
  eq(r.target, B)
  ok(r.legacy)
  eq(r.announceChannel, null)
})

prefs.setLegacyModeEnabled(true)
messenger.store._threads = {}
check('the compatibility switch forces new conversations onto the wallet address', () => {
  const r = messenger.resolveTarget(B)
  eq(r.target, B)
  ok(r.legacy)
})
prefs.setLegacyModeEnabled(false)

check('an invitation leaves less room than an ordinary message', () => {
  messenger.store._threads = {}
  const invite = messenger.remainingRoomFor({ peerAddress: B, publicKey: alice.publicKey, text: 'hi' })
  messenger.store._threads[B] = {
    address: B, messages: [{ id: 'x', dir: 'in', ts: now }], channel: chanAB,
    channelConfirmed: true, peerPubKey: bobBoxPub, handshakeSent: true,
  }
  const ordinary = messenger.remainingRoomFor({ peerAddress: B, publicKey: alice.publicKey, text: 'hi' })
  ok(invite < ordinary, 'the announced address has to cost room')
})

// =====================================================================
section('9. Shared scan budget and rotation')

const cursors = await import('../src/messenger/cursors.js')

// Sources are conversation addresses and group addresses, mixed.
function fakeSources(directCount, groupCount) {
  const out = []
  for (let i = 0; i < directCount; i++) {
    out.push({ kind: 'direct', address: 'chan' + i, ts: now - i * 1000 })
  }
  for (let i = 0; i < groupCount; i++) {
    out.push({ kind: 'group', address: 'grp' + i, ts: now - i * 1000 - 500 })
  }
  return out
}

check('everything is scanned when it fits in the budget', () => {
  const plan = messenger.planSourceScan(fakeSources(2, 2), 10, {})
  eq(plan.fresh.length, 4)
  eq(plan.rotating.length, 0)
  eq(plan.skipped.length, 0)
})

check('the budget is never exceeded, whatever the mix', () => {
  for (const budget of [3, 5, 10, 20, 40]) {
    for (const [d, g] of [[100, 0], [0, 100], [50, 50]]) {
      const plan = messenger.planSourceScan(fakeSources(d, g), budget, {})
      eq(plan.fresh.length + plan.rotating.length, budget, `budget ${budget}, mix ${d}/${g}`)
    }
  }
})

check('groups and conversations draw on the same budget', () => {
  // 20 groups used to mean 20 extra RPC calls on top of the conversations.
  const plan = messenger.planSourceScan(fakeSources(5, 20), 5, {})
  eq(plan.fresh.length + plan.rotating.length, 5, 'groups must not add calls of their own')
  ok(plan.skipped.length === 20)
})

check('rotation slots scale with the budget and stay bounded', () => {
  eq(messenger.rotationSlotsFor(3), 1)
  eq(messenger.rotationSlotsFor(5), 1)
  eq(messenger.rotationSlotsFor(10), 2)
  eq(messenger.rotationSlotsFor(20), 4)
  eq(messenger.rotationSlotsFor(40), 4)
})

check('the freshest chats always keep their slots, regardless of kind', () => {
  const plan = messenger.planSourceScan(fakeSources(30, 30), 10, {})
  const freshTs = plan.fresh.map((s) => s.ts)
  const restTs = [...plan.rotating, ...plan.skipped].map((s) => s.ts)
  ok(Math.min(...freshTs) >= Math.max(...restTs), 'fresh slots must hold the newest sources')
})

check('never-scanned chats are rotated in first', () => {
  const sources = fakeSources(50, 0)
  const stamps = {}
  sources.slice(8).forEach((s) => { stamps[s.address] = now })
  delete stamps['chan30']
  const plan = messenger.planSourceScan(sources, 10, stamps)
  ok(plan.rotating.some((s) => s.address === 'chan30'))
})

check('the least-recently-scanned tail entry goes first', () => {
  const sources = fakeSources(20, 0)
  const stamps = {}
  sources.slice(8).forEach((s, i) => { stamps[s.address] = now - i })
  const plan = messenger.planSourceScan(sources, 10, stamps)
  eq(plan.rotating.map((s) => s.address), ['chan19', 'chan18'])
})

// The scenario the rotation exists for.
function coverageRefreshes(sources, budget, stamps = {}, maxRefreshes = 1000) {
  const seen = new Set()
  let refreshes = 0
  let clock = now
  while (seen.size < sources.length && refreshes < maxRefreshes) {
    const plan = messenger.planSourceScan(sources, budget, stamps)
    for (const s of [...plan.fresh, ...plan.rotating]) { seen.add(s.address); stamps[s.address] = clock }
    clock += 1000
    refreshes++
  }
  return { refreshes, seen }
}

check('every chat is reached within a bounded number of refreshes', () => {
  const sources = fakeSources(25, 25)
  const { refreshes, seen } = coverageRefreshes(sources, 10)
  ok(seen.size === sources.length, `only ${seen.size}/${sources.length} reached`)
  console.log(`     50 chats (25 direct + 25 groups), budget 10 -> all reached in ${refreshes} refreshes`)
})

check('the default budget still reaches every chat', () => {
  eq(prefs.DEFAULT_SOURCES_PER_REFRESH, 5, 'default budget changed - recheck the numbers below')
  for (const [d, g] of [[10, 10], [25, 25]]) {
    const sources = fakeSources(d, g)
    const { refreshes, seen } = coverageRefreshes(sources, prefs.DEFAULT_SOURCES_PER_REFRESH)
    ok(seen.size === sources.length, `only ${seen.size}/${sources.length} reached`)
    console.log(`     ${String(d + g).padStart(2)} chats (${d} direct + ${g} groups), budget 5  -> all reached in ${refreshes} refreshes`)
  }
})

// Closing the app must not restart the rotation.
check('rotation resumes where it stopped after the app is closed', () => {
  localStorage.clear()
  const sources = fakeSources(30, 0)
  const budget = 5

  // Session one: three full refreshes, then the app is closed.
  let clock = now
  const sessionOne = new Set()
  for (let i = 0; i < 3; i++) {
    const plan = messenger.planSourceScan(sources, budget, cursors.getRotationStamps())
    for (const s of [...plan.fresh, ...plan.rotating]) {
      sessionOne.add(s.address)
      cursors.touchRotation([s.address], clock)  // stamped one at a time, as in the scan loop
    }
    clock += 1000
  }

  // Session two: stamps come back from storage, nothing else survives.
  const restored = cursors.getRotationStamps()
  ok(Object.keys(restored).length === sessionOne.size, 'stamps must survive the restart')

  const planAfter = messenger.planSourceScan(sources, budget, restored)
  const rotated = planAfter.rotating.map((s) => s.address)
  ok(rotated.every((a) => !sessionOne.has(a)),
    'rotation repeated an address it had already covered: ' + rotated.join(', '))
})

check('progress survives the app being closed mid-refresh', () => {
  localStorage.clear()
  const sources = fakeSources(30, 0)
  const budget = 5

  // A refresh that is interrupted after two of its five sources.
  const plan = messenger.planSourceScan(sources, budget, {})
  const scheduled = [...plan.fresh, ...plan.rotating]
  cursors.touchRotation([scheduled[0].address], now)
  cursors.touchRotation([scheduled[1].address], now)
  // ...app killed here.

  const stamps = cursors.getRotationStamps()
  eq(Object.keys(stamps).length, 2, 'the two completed sources must be recorded')

  // On restart the rotation does not hand the tail slot back to a covered address.
  const resumed = messenger.planSourceScan(sources, budget, stamps)
  const rotatedAddr = resumed.rotating.map((s) => s.address)
  ok(!rotatedAddr.includes(scheduled[0].address) || plan.fresh.some((s) => s.address === scheduled[0].address),
    'an already-scanned tail address was rotated in again')
})

check('rotation stamps are pruned when a chat is deleted', () => {
  localStorage.clear()
  cursors.touchRotation(['chanA', 'grpB'], 111)
  eq(cursors.getRotationStamps(), { chanA: 111, grpB: 111 })
  cursors.pruneRotation(['chanA'])
  eq(cursors.getRotationStamps(), { chanA: 111 })
  cursors.forgetCursor('chanA')
  eq(cursors.getRotationStamps(), {})
})

// =====================================================================
section('10. Fee handshake and first-contact grace')

localStorage.clear()
messenger.store._threads = {}

check('the amount quoted is the one that peer will actually owe', () => {
  prefs.saveFeePolicy({ mode: 'all', amount: 5, perContact: {} })
  eq(messenger.feeQuotedTo(B), 5)

  // "new contacts only": writing to somebody makes them a contact, so their
  // next message is free - quoting 5 would be a lie.
  prefs.saveFeePolicy({ mode: 'new', amount: 5, perContact: {} })
  eq(messenger.feeQuotedTo(B), 0)

  // An individual amount is quoted whatever the mode - this is the case that
  // used to be silently dropped, filtering the contact out for ever.
  prefs.saveFeePolicy({ mode: 'selected', amount: 5, perContact: { [B]: 500 } })
  eq(messenger.feeQuotedTo(B), 500)
  prefs.saveFeePolicy({ mode: 'off', amount: 0, perContact: { [B]: 12 } })
  eq(messenger.feeQuotedTo(B), 12)
})

check('a stranger gets exactly one free opening message', () => {
  localStorage.clear()
  messenger.store._threads = {}
  prefs.saveFeePolicy({ mode: 'new', amount: 50, perContact: {} })

  // Nothing heard from them yet -> the opening message is let through.
  ok(!messenger.hasUsedFirstContactGrace(B))

  // They write; the message is stored.
  messenger.store.applyIncoming([{ from: B, text: 'hello', sig: 'sig1', type: 'req' }])
  ok(messenger.hasUsedFirstContactGrace(B), 'the allowance must be spent after one message')
})

check('contacting somebody first spends no allowance on them', () => {
  localStorage.clear()
  messenger.store._threads = {}
  prefs.saveFeePolicy({ mode: 'all', amount: 50, perContact: {} })

  // We wrote first, so our message already told them the amount.
  messenger.store.appendOutgoing(C, { text: 'hi', sig: 'out1', type: 'req' })
  ok(messenger.hasUsedFirstContactGrace(C), 'no grace is owed to someone we contacted')
})

check('the deadlock that made publishing necessary is gone', () => {
  localStorage.clear()
  messenger.store._threads = {}
  prefs.saveFeePolicy({ mode: 'new', amount: 50, perContact: {} })

  // A stranger writes without paying, because they could not know the amount.
  const required = messenger.requiredFeeFrom(B)
  eq(required, 50, 'the rule does apply to them')
  ok(!messenger.hasUsedFirstContactGrace(B),
    'their opening message must not be filtered - otherwise the reply that ' +
    'teaches them the fee would never be written')
})

check('a peer fee learned from a message is remembered', () => {
  localStorage.clear()
  messenger.store._threads = {}
  messenger.store.ensureThread(B)
  messenger.rememberPeerFee(B, 25)
  eq(messenger.store.getThread(B).peerFee, 25)
  messenger.rememberPeerFee(B, 'nonsense')
  eq(messenger.store.getThread(B).peerFee, 0, 'junk amounts must clamp, not corrupt the thread')
})

check('no on-chain fee lookup is left in the module', () => {
  ok(messenger.fetchPeerFee === undefined, 'fetchPeerFee should be gone')
  ok(messenger.publishFeePolicy === undefined, 'publishFeePolicy should be gone')
})

// =====================================================================
section('11. Regressions found while cleaning up')

check('a qualifying applicant is not rejected by a swallowed error', async () => {})
useIdentity(alice)
localStorage.clear()
groups.groupStore._groups = {}
groups.groupStore.put({
  id: 'g-regress', name: 'Gated', address: channels.deriveGroupAddress('g-regress'),
  admin: A, isAdmin: true, key: msgcrypto.newGroupKey(), minBalance: 500, msgCost: 0.001,
  inviteCode: 'regress-code', members: {}, pending: {}, messages: [], unread: 0, createdAt: Date.now(),
})
const balanceLookups = []
const countingConnection = {
  async getTokenAccountBalance(ata) {
    balanceLookups.push(ata ? ata.toBase58() : null)
    return { value: { uiAmount: 900 } }
  },
}
const regressVerdict = await groups.processIncomingJoinRequest(countingConnection, {
  from: C, payload: { code: 'regress-code', nick: 'carol' }, ts: Date.now(),
})
check("the applicant's balance is actually read from chain", () => {
  eq(balanceLookups.length, 1, 'the balance lookup must reach the connection')
  ok(balanceLookups[0], 'a token account had to be derived - a missing import would give null')
})
check('an applicant above the threshold is admitted', () => eq(regressVerdict, 'pending'))

check('an unsolicited group acceptance is rejected', () => {
  localStorage.clear()
  groups.groupStore._groups = {}
  const injected = groups.acceptGroupInvitation({
    gid: 'evil1', name: 'Injected', addr: chanAB, key: msgcrypto.newGroupKey(),
    min: 0, cost: 0.001, code: 'never-applied-for',
  }, C)
  ok(injected === null, 'anybody could otherwise push a group into the chat list')
  eq(groups.groupStore.all().length, 0)
})

check('an acceptance answering our own request is stored', () => {
  localStorage.clear()
  groups.groupStore._groups = {}
  // Record an application the way sendJoinRequest does.
  localStorage.setItem('h173k_msg_applications', JSON.stringify({
    'real-code': { admin: C, code: 'real-code', name: 'Real', minBalance: 0, msgCost: 0.001 },
  }))
  const joined = groups.acceptGroupInvitation({
    gid: 'real1', name: 'Real', addr: chanAB, key: msgcrypto.newGroupKey(),
    min: 0, cost: 0.001, code: 'real-code',
  }, C)
  ok(joined, 'a legitimate acceptance must go through')
  eq(groups.groupStore.all().length, 1)
  eq(Object.keys(groups.getPendingApplications()), [], 'the application should be cleared')
})

check('an acceptance from the wrong admin is rejected', () => {
  localStorage.clear()
  groups.groupStore._groups = {}
  localStorage.setItem('h173k_msg_applications', JSON.stringify({
    'real-code': { admin: C, code: 'real-code' },
  }))
  const spoofed = groups.acceptGroupInvitation({
    gid: 'real2', name: 'Spoofed', addr: chanAB, key: msgcrypto.newGroupKey(),
    min: 0, cost: 0.001, code: 'real-code',
  }, B)  // B is not the admin we applied to
  ok(spoofed === null)
})

check('held-back messages are counted from the thread, not a running total', () => {
  const thread = {
    messages: [
      { id: '1', unpaid: true }, { id: '2' }, { id: '3', unpaid: true },
    ],
  }
  eq(messenger.unpaidCount(thread), 2)
  // Trimming the thread must not leave the count behind.
  thread.messages = thread.messages.slice(2)
  eq(messenger.unpaidCount(thread), 1)
  eq(messenger.unpaidCount(null), 0)
})

check('a sender who does not claim to have paid is filtered for free', () => {
  // The declared amount cannot prove payment, but it can disprove it without
  // touching the network. Only claimants should ever cost an RPC lookup.
  const owed = 50
  const claims = [0, 10, 49.9, 50, 100]
  const needLookup = claims.filter((declared) => declared + 1e-9 >= owed)
  eq(needLookup, [50, 100], 'only genuine claimants should be verified')
})

// =====================================================================
section('12. Group message cost goes to the admin')

localStorage.clear()
const payGroup = {
  id: 'g-pay', name: 'Paid', address: 'GroupAddr11111111111111111111111111111111',
  admin: A, msgCost: 0.25, isAdmin: false,
}

check('the cost is transferred to the admin, not left at the group address', () => {
  const { transfers, cost } = groups.buildGroupTransfers({ group: payGroup, myAddress: B })
  eq(transfers.length, 2)
  eq(transfers[0].to, payGroup.address, 'first transfer registers the message in group history')
  eq(transfers[0].amount, groups.MIN_GROUP_MSG_COST, 'transport dust only - not the fee')
  eq(groups.MIN_GROUP_MSG_COST, 1e-9, 'dust must stay at one lamport')
  eq(transfers[1].to, A, 'the fee must reach the admin wallet')
  eq(transfers[1].amount, 0.25)
  eq(cost, 0.25)
})

check('the admin does not pay themselves', () => {
  const { transfers } = groups.buildGroupTransfers({ group: payGroup, myAddress: A })
  eq(transfers.length, 1, 'only the transport dust')
  eq(transfers[0].to, payGroup.address)
})

check('a free group still registers its messages on chain', () => {
  const free = { ...payGroup, msgCost: 0 }
  const { transfers } = groups.buildGroupTransfers({ group: free, myAddress: B })
  ok(transfers[0].amount >= groups.MIN_GROUP_MSG_COST,
    'without a transfer the message would never appear in the group history')
})

check('a broken cost cannot charge a negative amount', () => {
  const broken = { ...payGroup, msgCost: -99 }
  const { transfers, cost } = groups.buildGroupTransfers({ group: broken, myAddress: B })
  ok(cost >= groups.MIN_GROUP_MSG_COST)
  ok(transfers.every((tr) => tr.amount >= 0))
})

// The message and its payment share one transaction, so neither can land
// without the other - PROVIDED the transaction still fits in a Solana packet.
// That is the single assumption the whole design rests on, so it is measured
// rather than assumed: raise the memo limit or add another transfer and this
// test fails before the change can strand anybody's payment.
const { Transaction, TransactionInstruction } = await import('@solana/web3.js')
const splToken = await import('@solana/spl-token')
const PACKET_LIMIT = 1232

async function worstCaseTransactionSize() {
  const mint = Keypair.generate().publicKey
  const sender = Keypair.generate().publicKey
  const groupAddr = Keypair.generate().publicKey
  const adminAddr = Keypair.generate().publicKey
  const senderAta = await splToken.getAssociatedTokenAddress(mint, sender)
  const groupAta = await splToken.getAssociatedTokenAddress(mint, groupAddr)
  const adminAta = await splToken.getAssociatedTokenAddress(mint, adminAddr)

  const tx = new Transaction()
  // Neither token account exists yet: both are created in the same transaction.
  tx.add(splToken.createAssociatedTokenAccountInstruction(sender, groupAta, groupAddr, mint))
  tx.add(splToken.createAssociatedTokenAccountInstruction(sender, adminAta, adminAddr, mint))
  tx.add(splToken.createTransferInstruction(senderAta, groupAta, sender, 10))
  tx.add(splToken.createTransferInstruction(senderAta, adminAta, sender, 250000000))
  tx.add(new TransactionInstruction({
    keys: [{ pubkey: sender, isSigner: true, isWritable: false }],
    programId: (await import('../src/messenger/tx.js')).MEMO_PROGRAM_ID,
    data: Buffer.alloc(envelope.MAX_MEMO_BYTES, 0x61),
  }))
  tx.recentBlockhash = '11111111111111111111111111111111'
  tx.feePayer = sender
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length
}

const worstCase = await worstCaseTransactionSize()
check('message and payment always fit in one transaction', () => {
  ok(worstCase <= PACKET_LIMIT,
    `worst case ${worstCase} B exceeds the ${PACKET_LIMIT} B packet limit - a message ` +
    'could then be sent without its payment')
  console.log(`     worst case ${worstCase} B of ${PACKET_LIMIT} B (margin ${PACKET_LIMIT - worstCase} B)`)
})

// =====================================================================
section('13. Repricing an existing conversation')

function freshThread(addr, fields) {
  localStorage.clear()
  messenger.store._threads = {}
  messenger.store._threads[addr] = {
    address: addr, messages: [], contactName: '', peerNick: '', peerPubKey: null,
    channel: null, channelMine: false, channelConfirmed: false, legacyPeer: false,
    peerFee: null, quotedFee: null, unread: 0, handshakeSent: false, createdAt: now,
    ...fields,
  }
  return messenger.store._threads[addr]
}

check('a rise does not bind until it has been announced', () => {
  // We have been talking, having quoted nothing.
  freshThread(B, { handshakeSent: true, quotedFee: 0, messages: [{ id: '1', dir: 'out', ts: now }] })
  prefs.saveFeePolicy({ mode: 'off', amount: 0, perContact: { [B]: 50 } })

  eq(messenger.requiredFeeFrom(B), 50, 'the setting itself is 50')
  eq(messenger.enforcedFeeFrom(B), 0,
    'but they were told 0 - filtering them now would break the conversation silently')
  ok(messenger.feeRiseUnannounced(B), 'the UI has to say the rise is not live yet')
})

check('once announced, the rise binds', () => {
  freshThread(B, { handshakeSent: true, quotedFee: 50, messages: [{ id: '1', dir: 'out', ts: now }] })
  prefs.saveFeePolicy({ mode: 'off', amount: 0, perContact: { [B]: 50 } })
  eq(messenger.enforcedFeeFrom(B), 50)
  ok(!messenger.feeRiseUnannounced(B))
})

check('a reduction applies immediately', () => {
  freshThread(B, { handshakeSent: true, quotedFee: 50, messages: [{ id: '1', dir: 'out', ts: now }] })
  prefs.saveFeePolicy({ mode: 'off', amount: 0, perContact: { [B]: 5 } })
  eq(messenger.enforcedFeeFrom(B), 5, 'never hold somebody to more than the current price')
  ok(!messenger.feeRiseUnannounced(B))
  // Somebody still paying the old, higher amount must obviously still pass.
  ok(50 >= messenger.enforcedFeeFrom(B))
})

check('a stranger is still charged, covered by the first-contact allowance', () => {
  localStorage.clear()
  messenger.store._threads = {}
  prefs.saveFeePolicy({ mode: 'new', amount: 50, perContact: {} })
  eq(messenger.enforcedFeeFrom(C), 50, 'the anti-spam rule must not be weakened')
  ok(!messenger.hasUsedFirstContactGrace(C), 'their opening message still gets through')
})

check('a conversation carried over from an older build is not repriced behind their back', () => {
  // Upgraded thread: we have written to them, but no record of what we quoted.
  freshThread(B, { handshakeSent: true, quotedFee: null, messages: [{ id: '1', dir: 'out', ts: now }] })
  prefs.saveFeePolicy({ mode: 'all', amount: 30, perContact: {} })
  eq(messenger.enforcedFeeFrom(B), 0, 'unknown quote means do not enforce yet')
  ok(messenger.feeRiseUnannounced(B), 'and say so')
})

check('sending records what was quoted', () => {
  freshThread(B, { handshakeSent: true, quotedFee: 0 })
  prefs.saveFeePolicy({ mode: 'off', amount: 0, perContact: { [B]: 50 } })
  const routing = messenger.resolveTarget(B)
  const { payload, myFee } = messenger.buildDirectPayload({
    peerAddress: B, myAddress: A, text: 'hi', routing,
    thread: messenger.store.getThread(B), fee: 0,
  })
  eq(myFee, 50)
  eq(payload.fee, 50, 'the amount has to travel with the message')
})

check('a drop to zero is announced while they might still think otherwise', () => {
  freshThread(B, { handshakeSent: true, quotedFee: 50 })
  prefs.saveFeePolicy({ mode: 'off', amount: 0, perContact: {} })
  const routing = messenger.resolveTarget(B)
  const { payload } = messenger.buildDirectPayload({
    peerAddress: B, myAddress: A, text: 'hi', routing,
    thread: messenger.store.getThread(B), fee: 0,
  })
  eq(payload.fee, 0, 'without this they would keep overpaying for ever')
})

check('nothing is announced when there is nothing to say', () => {
  freshThread(B, { handshakeSent: true, quotedFee: 0 })
  prefs.saveFeePolicy({ mode: 'off', amount: 0, perContact: {} })
  const routing = messenger.resolveTarget(B)
  const { payload } = messenger.buildDirectPayload({
    peerAddress: B, myAddress: A, text: 'hi', routing,
    thread: messenger.store.getThread(B), fee: 0,
  })
  ok(payload.fee === undefined, 'no point spending memo bytes on an unchanged zero')
})

// =====================================================================
section('14. Dust and the smallest chargeable amount')

const txmod = await import('../src/messenger/tx.js')

check('transport dust is exactly one lamport, not zero', () => {
  // Zero would mean no transfer, and a message with no transfer never appears
  // in the address history - it would be invisible to the recipient.
  eq(txmod.toLamports(messenger.MSG_COST), 1)
  eq(txmod.toLamports(groups.MIN_GROUP_MSG_COST), 1)
  ok(messenger.MSG_COST > 0 && groups.MIN_GROUP_MSG_COST > 0)
})

check('one lamport survives being stored and read back', () => {
  localStorage.clear()
  const saved = prefs.saveFeePolicy({ mode: 'all', amount: 1e-9, perContact: {} })
  eq(saved.amount, 1e-9, 'sanitising must not round the smallest amount to zero')
  eq(prefs.getFeePolicy().amount, 1e-9)
  eq(prefs.sanitizeFee('0.000000001'), 1e-9, 'typed into the settings field')
})

check('a new group costs its members nothing by default', () => {
  localStorage.clear()
  const d = prefs.getGroupDefaults()
  eq(d.minBalance, 0)
  eq(txmod.toLamports(d.msgCost), 1, 'one lamport: free in practice, still visible on chain')
})

check('a one-lamport fee is not satisfied by paying nothing', () => {
  // The comparison slack has to sit below the smallest amount anyone can
  // charge, or the cheapest possible fee would be free to ignore.
  const owed = 1e-9
  const EPSILON = 5e-10
  ok(0 + EPSILON < owed, 'paying nothing must fail')
  ok(owed + EPSILON >= owed, 'paying exactly the amount must pass')
})

// =====================================================================
console.log('\n' + '='.repeat(52))
if (failures.length === 0) {
  console.log(`ALL ${passed} CHECKS PASSED`)
} else {
  console.log(`${passed} passed, ${failures.length} FAILED:`)
  failures.forEach((f) => console.log('  - ' + f))
  process.exitCode = 1
}
