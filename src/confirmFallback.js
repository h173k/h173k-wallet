/**
 * ---------------------------------------------------------------------------
 * Transaction confirmation fallback (HTTP polling alongside the websocket)
 * ---------------------------------------------------------------------------
 *
 * WHY THIS EXISTS
 * ---------------
 * `connection.confirmTransaction()` in @solana/web3.js confirms over a WebSocket
 * `signatureSubscribe`. Internally it *does* also fire a one-shot
 * `getSignatureStatus`, but only after the subscription reaches the "subscribed"
 * state. When an RPC provider rejects the subscription outright — Alchemy answers
 * `-32601 Method 'signatureSubscribe' not found` — that state is never reached,
 * web3.js silently retries the subscription forever, and the one-shot status check
 * therefore never runs. The confirmation then hangs until the blockhash expires
 * (~60-90 s) or the 30 s timeout fires, even though the transaction landed on
 * chain seconds earlier.
 *
 * QuickNode and Helius accept `signatureSubscribe`, so on those providers the
 * subscription resolves normally and nothing here changes anything.
 *
 * DESIGN — WHY THIS CANNOT BREAK PROVIDERS THAT ALREADY WORK
 * ----------------------------------------------------------
 * The wrapper only ever ADDS a way to *succeed*. It never invents a new way to
 * fail. Concretely:
 *
 *   1. The original web3.js confirmation still runs, untouched, every time. On a
 *      healthy websocket it resolves first and its result is returned verbatim.
 *   2. Every error the caller can observe is still the original web3.js error
 *      object — same class, same message. Nothing downstream that matches on
 *      error text can regress. This matters because `isConfirmTimeoutError()` in
 *      useLottery.js and the transient-retry check in useSwap.js both match on
 *      strings like "block height exceeded" and "was not confirmed".
 *   3. The resolved value keeps the exact `{ context, value: { err, ... } }` shape
 *      web3.js produces, because useLottery.js reads `conf?.value?.err` and
 *      Anchor's provider reads `status.err` (an undefined `value` would throw).
 *   4. Polling never sends, signs, or re-broadcasts anything. It only reads
 *      `getSignatureStatus`, so it cannot duplicate a transaction or an operation.
 *
 * EFFECT ON DUPLICATE OPERATIONS — IT STRICTLY REDUCES THEM
 * ---------------------------------------------------------
 * When the original confirmation rejects (expired/timed out), the wrapper makes
 * one last status check before propagating the error. If the transaction is in
 * fact on chain, the real status is returned instead of the error. That closes a
 * pre-existing false-negative window in which a landed transaction was reported
 * as failed and the caller retried it — e.g. useSwap.js treats "block height
 * exceeded" as transient and re-sends, and useP2P.js would post a second offer.
 * The wrapper can only turn a spurious failure into the truth; it never turns a
 * real failure into a success, because the decision comes from the chain status.
 */

// Commitment ranking used to decide whether an observed status is good enough.
const RANK = { processed: 1, confirmed: 2, finalized: 3 }

// Normalise the aliases web3.js still accepts.
function normaliseCommitment(commitment) {
  switch (commitment) {
    case 'single':
    case 'singleGossip':
      return 'confirmed'
    case 'max':
    case 'root':
      return 'finalized'
    case 'recent':
      return 'processed'
    default:
      return commitment
  }
}

/**
 * Has an observed signature status reached at least the requested commitment?
 *
 * Deliberately conservative: when an RPC omits `confirmationStatus` we only accept
 * the status if `confirmations === null` (which means rooted/finalized) or the
 * caller asked for `processed`. Resolving too early would let callers read account
 * state that has not settled yet — the lottery, for instance, fetches the ticket
 * account immediately after its commit is confirmed.
 */
function meetsCommitment(value, commitment) {
  const want = RANK[normaliseCommitment(commitment)] || RANK.finalized
  const observed = value.confirmationStatus
  if (observed) return (RANK[observed] || 0) >= want
  if (value.confirmations === null || value.confirmations === undefined) return true
  return want === RANK.processed
}

/** Pull the signature out of either overload web3.js accepts. */
function extractSignature(strategyOrSignature) {
  if (typeof strategyOrSignature === 'string') return strategyOrSignature
  if (strategyOrSignature && typeof strategyOrSignature.signature === 'string') {
    return strategyOrSignature.signature
  }
  return null
}

/**
 * One status read. Returns a web3.js-shaped confirmation response once the
 * transaction has either failed on chain or reached the requested commitment,
 * otherwise null. Never throws — a transient RPC hiccup must not end the wait.
 */
async function readStatus(connection, signature, commitment) {
  let res
  try {
    res = await connection.getSignatureStatus(signature, { searchTransactionHistory: false })
  } catch {
    return null
  }
  const value = res && res.value
  if (!value) return null
  // A transaction that failed on chain is final: report it exactly as the
  // websocket path would, so callers keep seeing `value.err`.
  if (value.err) return { context: res.context, value }
  if (meetsCommitment(value, commitment)) return { context: res.context, value }
  return null
}

/**
 * Wrap a Connection so confirmations also poll over HTTP.
 *
 * Mutates and returns the same instance on purpose: Anchor's AnchorProvider and
 * every hook in this app share this one object, so patching the method here
 * covers all confirmation paths — including Anchor's internal
 * `sendAndConfirmRawTransaction`, which we cannot reach any other way.
 */
export function withConfirmFallback(connection, options = {}) {
  // Give the websocket a head start so healthy providers normally settle before a
  // single extra HTTP request is made, then poll at a steady interval.
  const firstPollDelayMs = options.firstPollDelayMs ?? 900
  const pollIntervalMs = options.pollIntervalMs ?? 700

  const original = connection.confirmTransaction.bind(connection)

  connection.confirmTransaction = async function confirmTransactionWithFallback(
    strategyOrSignature,
    commitment
  ) {
    const signature = extractSignature(strategyOrSignature)
    const level = normaliseCommitment(commitment || connection.commitment || 'finalized')

    // Unknown shape (future web3.js strategy): defer entirely to the original.
    if (!signature) return original(strategyOrSignature, commitment)

    let settled = false

    // The original confirmation runs untouched. Its rejection is captured rather
    // than thrown so it cannot surface as an unhandled rejection if polling wins.
    const nativePromise = original(strategyOrSignature, commitment).then(
      (response) => ({ ok: true, response }),
      (error) => ({ ok: false, error })
    )

    const pollPromise = (async () => {
      await new Promise((r) => setTimeout(r, firstPollDelayMs))
      while (!settled) {
        const hit = await readStatus(connection, signature, level)
        if (hit) return { ok: true, response: hit }
        if (settled) break
        await new Promise((r) => setTimeout(r, pollIntervalMs))
      }
      // Never resolves competitively; the original decides when to give up.
      return new Promise(() => {})
    })()

    try {
      const outcome = await Promise.race([nativePromise, pollPromise])
      if (outcome.ok) return outcome.response

      // The original gave up (expired / timed out). Before propagating that, check
      // the chain once more: web3.js can report expiry for a transaction that did
      // land, and propagating it would make the caller retry an operation that
      // already succeeded.
      const late = await readStatus(connection, signature, level)
      if (late) return late

      // Genuinely unconfirmed — rethrow the original error untouched, so error
      // class and message stay byte-identical to today's behaviour.
      throw outcome.error
    } finally {
      settled = true
    }
  }

  return connection
}

/* ---------------------------------------------------------------------------
 * Console noise filter for the known, already-handled websocket failure
 * ---------------------------------------------------------------------------
 *
 * When a provider rejects `signatureSubscribe`, web3.js logs this on every retry
 * — and it retries indefinitely (its own source carries the comment
 * "TODO: Maybe add an 'errored' state or a retry limit?"):
 *
 *   console.error(`Received JSON-RPC error calling \`signatureSubscribe\``,
 *                 { args, error: { code: -32601, message: "..." } })
 *
 * The condition is fully handled by withConfirmFallback() above, so those entries
 * are noise — but they look exactly like a real crash, which makes an actual
 * unexpected error easy to miss. This filter recognises that one specific shape
 * and replaces it with a single, clearly-labelled notice.
 *
 * It is deliberately narrow. Anything that is not this exact known-and-handled
 * pattern is passed through to the original console.error untouched, so no
 * genuine error can ever be hidden.
 */

// Subscription methods whose failure withConfirmFallback compensates for.
const HANDLED_SUBSCRIBE_METHODS = ['signatureSubscribe']

let filterInstalled = false

/** Diagnostics other code (or a developer in the console) can read. */
export const rpcNotices = {
  websocketSubscribeUnsupported: false,  // set once the condition is detected
  method: null,                          // which subscription was rejected
  code: null,                            // JSON-RPC error code, e.g. -32601
  suppressedCount: 0,                    // repeats folded away after the first
}

/** Does this console.error call match the known handled pattern? */
function matchesHandledSubscribeFailure(args) {
  const [first, detail] = args
  if (typeof first !== 'string') return null
  if (!first.includes('error calling')) return null

  const method = HANDLED_SUBSCRIBE_METHODS.find((m) => first.includes(m))
  if (!method) return null

  // Only treat it as "known" when the server actually reported the method as
  // unavailable. A different failure on the same method (auth, rate limit,
  // transport) must stay visible as a normal error.
  const err = detail && detail.error
  const code = err && typeof err.code === 'number' ? err.code : null
  const message = String((err && err.message) || '')
  const unsupported =
    code === -32601 ||
    /not found|not supported|unsupported|unavailable|disabled/i.test(message)

  return unsupported ? { method, code, message } : null
}

/**
 * Install the filter. Idempotent, safe to call once at start-up.
 * Returns a function that restores the original console.error.
 */
export function installRpcNoticeFilter() {
  if (filterInstalled || typeof console === 'undefined') return () => {}
  filterInstalled = true

  const originalError = console.error.bind(console)

  console.error = function filteredConsoleError(...args) {
    let hit = null
    try {
      hit = matchesHandledSubscribeFailure(args)
    } catch {
      hit = null // never let the filter itself break logging
    }

    if (!hit) return originalError(...args)

    rpcNotices.suppressedCount++

    // First occurrence: explain it once, clearly marked as handled so it reads
    // differently from an unexpected error. Later repeats are folded away.
    if (!rpcNotices.websocketSubscribeUnsupported) {
      rpcNotices.websocketSubscribeUnsupported = true
      rpcNotices.method = hit.method
      rpcNotices.code = hit.code

      const note =
        `ℹ️ [h173k · handled] This RPC provider does not support "${hit.method}" ` +
        `over WebSocket${hit.code !== null ? ` (JSON-RPC ${hit.code})` : ''}. ` +
        `Transaction confirmation has automatically fallen back to HTTP polling, ` +
        `so everything continues to work normally. ` +
        `This is a known provider limitation, not an application error — ` +
        `switching to an RPC that supports WebSocket subscriptions removes it. ` +
        `Further repeats of this message are suppressed; see rpcNotices.suppressedCount.`

      // console.info, not console.error: keeps the browser's error channel clean
      // so anything left there is genuinely unexpected.
      if (typeof console.info === 'function') console.info(note)
      else originalError(note)
    }
  }

  return () => {
    console.error = originalError
    filterInstalled = false
  }
}
