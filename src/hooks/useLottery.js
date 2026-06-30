/**
 * H173K Wallet — Lottery hook (Win h173k)
 *
 * Obsługuje commit-reveal z lib.rs:
 *   1. commitGuess  — losuje sekret + typ, wpłaca opłatę do vaultu
 *   2. revealResult — po ~2 slotach odsłania wynik; przy trafieniu wypłaca nagrodę
 *
 * Wszystkie transakcje przechodzą przez withAutoSOL, więc SOL jest
 * automatycznie uzupełniany tak jak w pozostałych częściach aplikacji.
 */

import { useCallback, useMemo } from 'react'
import {
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import { sha256 } from '@noble/hashes/sha256'

import { LOTTERY_IDL } from '../lottery/lotteryIdl'
import {
  TOKEN_MINT,
  TOKEN_DECIMALS,
  getLotteryProgramId,
  isLotteryConfigured,
  LOTTERY_MAX_PRIZE_H173K,
} from '../constants'
import { useSwap } from './useSwap'
import { payReferralBonusSafe } from './useEscrow'

const RAW = Math.pow(10, TOKEN_DECIMALS)
const MAX_PRIZE_RAW = Math.round(LOTTERY_MAX_PRIZE_H173K * RAW)

// Rozmiar danych konta biletu (PlayerTicket::LEN z lib.rs) — do wyceny rentu.
const TICKET_ACCOUNT_LEN = 128
// Przybliżona opłata sieciowa za 2 transakcje (commit + reveal), w lamportach.
const SPIN_TX_FEES_LAMPORTS = 10000

// Opcje wysyłki transakcji. skipPreflight pomija symulację, która przy
// load-balancingu węzłów RPC (Helius) bywa wykonywana na węźle nieznającym
// jeszcze świeżego blockhasha → fałszywy "Blockhash not found". Sama transakcja
// jest poprawna; lider i tak zweryfikuje blockhash. maxRetries pozwala RPC
// ponownie rozesłać transakcję.
const SEND_OPTS = { skipPreflight: true, commitment: 'confirmed', maxRetries: 5 }

// u64 → 8-bajtowy bufor little-endian (do seedów PDA i commitmentu).
function u64le(n) {
  const bn = BN.isBN(n) ? n : new BN(n)
  return bn.toArrayLike(Buffer, 'le', 8)
}

// commitment = SHA256(secret_salt(32) ‖ player_guess.to_le_bytes()(8))
function computeCommitment(secretSalt, guess) {
  const guessLe = u64le(guess)
  const buf = new Uint8Array(secretSalt.length + guessLe.length)
  buf.set(secretSalt, 0)
  buf.set(guessLe, secretSalt.length)
  return sha256(buf) // Uint8Array(32)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// Czy błąd transakcji wynika z braku SOL (wtedy warto dokupić SOL i ponowić)?
function isInsufficientSolError(e) {
  const blob = (String(e?.message || e || '') + ' ' + (e?.logs || []).join(' ')).toLowerCase()
  // SPL-Token shortfall (custom program error 0x1) is NOT a SOL problem — a bare
  // "insufficient" match would otherwise wrongly trigger an h173k→SOL swap.
  if (
    blob.includes('custom program error: 0x1') ||
    (blob.includes('error: insufficient funds') && blob.includes('tokenkeg'))
  ) return false
  return (
    blob.includes('insufficient lamports') ||
    blob.includes('insufficient funds for rent') ||
    blob.includes('no record of a prior credit') ||
    blob.includes('debit an account')
  )
}

// Czytelny komunikat błędu transakcji (zamiast np. web3.js „Unknown action 'undefined'").
function friendlyTxError(e, phase) {
  let msg = String(e?.message || e || 'unknown error')
  if (msg.startsWith('TX_FAILED:') || msg.includes('Unknown action') || msg.includes('undefined')) {
    msg = 'network rejected the transaction, please try again'
  } else if (msg.includes('Blockhash not found')) {
    msg = 'network was busy (blockhash), please try again'
  } else if (msg.includes('not confirmed') || msg.includes('expired')) {
    msg = 'network was busy, please try again'
  }
  if (msg.length > 180) msg = msg.slice(0, 180) + '…'
  return `${phase}: ${msg}`
}

// Czy to błąd przekroczenia czasu potwierdzenia (tx mogła wejść lub nie).
function isConfirmTimeoutError(e) {
  const m = String(e?.message || e || '')
  return (
    m.includes('was not confirmed') ||
    m.includes('block height exceeded') ||
    m.includes('Timed out') ||
    m.includes('TransactionExpired') ||
    m.includes('expired')
  )
}

// Czy bilet już istnieje na łańcuchu (commit wszedł)? Krótki polling.
async function ticketLanded(program, ticket, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      await program.account.playerTicket.fetch(ticket)
      return true
    } catch {
      /* jeszcze nie ma */
    }
    if (i < tries - 1) await sleep(1200)
  }
  return false
}

// Czy bilet jest już odsłonięty (reveal wszedł)? Krótki polling.
async function revealLanded(program, ticket, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const tk = await program.account.playerTicket.fetch(ticket)
      if (tk.isRevealed) return true
    } catch {
      /* brak konta */
    }
    if (i < tries - 1) await sleep(1200)
  }
  return false
}

// Błędy, których NIE ponawiamy ani nie zmiękczamy — przekazujemy wprost.
function isFatalError(e) {
  const m = String(e?.message || e || '')
  return (
    m.includes('Wallet is locked') ||
    m.includes('NO_H173K') ||
    m.includes('NO_SOL') ||
    m.includes('LOTTERY_NOT_CONFIGURED')
  )
}

/**
 * Wysyła instrukcję Anchora i potwierdza strategią blockhash + lastValidBlockHeight.
 * W przeciwieństwie do .rpc() (sztywny limit 30 s) czeka aż blockhash wygaśnie,
 * więc rzadziej daje fałszywy timeout, a gdy już zwróci błąd wygaśnięcia — tx jest
 * na pewno martwa, więc bezpiecznie ją ponowić (bez ryzyka podwójnej opłaty).
 * WAŻNE: sprawdzamy też status.err — przy skipPreflight nieudana tx on-chain ląduje
 * jako „confirmed z błędem"; bez tej kontroli wyglądałaby na sukces, a dopiero
 * późniejszy fetch konta dawałby mylące „Account does not exist".
 * @returns {Promise<string>} podpis transakcji
 */
async function sendAndConfirmTx(connection, wallet, methodsBuilder) {
  const tx = await methodsBuilder.transaction()
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.lastValidBlockHeight = lastValidBlockHeight
  tx.feePayer = wallet.publicKey
  wallet.signTransaction(tx)
  const sig = await connection.sendRawTransaction(tx.serialize(), SEND_OPTS)
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed'
  )
  if (conf?.value?.err) {
    // tx weszła, ale instrukcja zwróciła błąd → transakcja jest atomowa,
    // więc żadne środki nie zostały pobrane. Rzucamy, by warstwa wyżej ponowiła.
    throw new Error('TX_FAILED:' + JSON.stringify(conf.value.err))
  }
  return sig
}

export function useLottery(connection, wallet) {
  const { withAutoSOL } = useSwap(connection, wallet)

  const configured = isLotteryConfigured()
  const programId = useMemo(() => getLotteryProgramId(), [])

  const getProgram = useCallback(() => {
    if (!configured || !wallet?.publicKey) return null
    const provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    })
    return new Program(LOTTERY_IDL, programId, provider)
  }, [connection, wallet, configured, programId])

  // ── PDA ──────────────────────────────────────────────────────────────────
  const configPDA = useCallback(
    () => PublicKey.findProgramAddressSync([Buffer.from('config')], programId),
    [programId]
  )
  const vaultPDA = useCallback(
    () => PublicKey.findProgramAddressSync([Buffer.from('vault')], programId),
    [programId]
  )
  const ticketPDA = useCallback(
    (player, slotHint) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from('ticket'), player.toBytes(), u64le(slotHint)],
        programId
      ),
    [programId]
  )

  // ── Vault / nagroda ────────────────────────────────────────────────────────
  /**
   * Surowe saldo vaultu (raw units). 0 jeśli niewdrożone / brak konta.
   */
  const getVaultBalanceRaw = useCallback(async () => {
    if (!configured) return 0
    try {
      const [vault] = vaultPDA()
      const bal = await connection.getTokenAccountBalance(vault)
      return Number(bal.value.amount) || 0
    } catch {
      return 0
    }
  }, [configured, connection, vaultPDA])

  /**
   * Szacowana nagroda przy trafieniu = min(vault/2, MAX_PRIZE), zgodnie z lib.rs.
   * Zwraca wartość w h173k (nie raw).
   */
  const estimatePrizeH173k = useCallback(async () => {
    const vaultRaw = await getVaultBalanceRaw()
    const prizeRaw = Math.min(Math.floor(vaultRaw / 2), MAX_PRIZE_RAW)
    return prizeRaw / RAW
  }, [getVaultBalanceRaw])

  // ── Ostatni zwycięzca (lekki, throttlowany skan) ────────────────────────────
  /**
   * Szuka ostatniej WYPŁATY z vaultu (transfer h173k OUT = wygrana).
   * Pojedyncze zapytania (małe odpowiedzi → brak 413) z odstępem ~130 ms
   * (łagodnie dla limitu RPC → brak 429). Skan uruchamiany jest raz przy wejściu
   * i po spinie, więc nie obciąża API. Zwraca { winner, amount, time, signature } lub null.
   */
  const getLastWinner = useCallback(async () => {
    if (!configured) return null
    const MAX_FETCH = 12
    const THROTTLE_MS = 130
    try {
      const [vault] = vaultPDA()
      const vaultStr = vault.toString()

      const sigs = await connection.getSignaturesForAddress(vault, { limit: MAX_FETCH })
      if (!sigs.length) return null

      for (let i = 0; i < sigs.length; i++) {
        const s = sigs[i]
        let tx = null
        try {
          tx = await connection.getParsedTransaction(s.signature, {
            maxSupportedTransactionVersion: 0,
          })
        } catch {
          await sleep(THROTTLE_MS)
          continue
        }
        const out = parseVaultPayout(tx, vaultStr)
        if (out) {
          return {
            winner: out.winner,
            amount: out.amount,
            time: s.blockTime ? s.blockTime * 1000 : null,
            signature: s.signature,
          }
        }
        if (i < sigs.length - 1) await sleep(THROTTLE_MS)
      }
    } catch {
      /* sieć/RPC — po prostu brak danych */
    }
    return null
  }, [configured, connection, vaultPDA])

  /**
   * Szacowany koszt spinu w SOL: rent za konto biletu (PDA tworzone przy commit
   * i nie zamykane przez kontrakt → SOL faktycznie wydany) + opłaty sieciowe za
   * dwie transakcje. Zwraca wartość w SOL.
   */
  const estimateSpinSolCost = useCallback(async () => {
    try {
      const rent = await connection.getMinimumBalanceForRentExemption(TICKET_ACCOUNT_LEN)
      return (rent + SPIN_TX_FEES_LAMPORTS) / LAMPORTS_PER_SOL
    } catch {
      return 0.0019 // ostrożny fallback (rent ~128 B + opłaty)
    }
  }, [connection])

  // ── Rozgrywka: commit → wait → reveal ──────────────────────────────────────
  /**
   * Pełna rozgrywka jednego spinu.
   * @param {object} modeObj  — wpis z LOTTERY_MODES { mode, oneIn, feeH173k }
   * @param {object} cb       — { onStage(stage), onSwap(info) }
   * @returns {Promise<{won, prize, guess, winningNumber}>}
   */
  const play = useCallback(
    async (modeObj, cb = {}) => {
      if (!configured) throw new Error('LOTTERY_NOT_CONFIGURED')
      const program = getProgram()
      if (!program || !wallet?.publicKey) throw new Error('Wallet not connected')

      const { onStage, onSwap } = cb
      const player = wallet.publicKey

      // 1. Przygotowanie sekretu, typu i commitmentu
      const secretSalt = new Uint8Array(32)
      crypto.getRandomValues(secretSalt)
      const guess = 1 + Math.floor(Math.random() * modeObj.oneIn)
      const commitment = computeCommitment(secretSalt, guess)

      const [config] = configPDA()
      const [vault] = vaultPDA()
      const ata = await getAssociatedTokenAddress(TOKEN_MINT, player)

      // slot_hint + ticket PDA ustalane są ŚWIEŻO wewnątrz operacji (poniżej),
      // bo withAutoSOL może najpierw wykonać kilkusekundowy swap SOL i ponawiać
      // próby — stały hint pobrany tutaj zdążyłby się przeterminować
      // (kontrakt wymaga clock.slot - slot_hint <= 20, ~8 s).
      let slotHint = null
      let ticket = null

      // Koszt SOL całego spinu (rent biletu + opłaty). Uzupełniamy SOL PROAKTYWNIE
      // z tym marginesem — withAutoSOL z operacją-no-op robi tylko top-up, NIE wchodzi
      // w pętlę swap+retry. Dzięki temu nieudana transakcja nie wywoła kilku swapów.
      const spinSolCost = await estimateSpinSolCost()
      const ensureSol = () => withAutoSOL(async () => true, onSwap, spinSolCost)

      // 2. COMMIT — opłata trafia do vaultu
      onStage?.('commit')
      const doCommit = async () => {
        // świeży slot tuż przed wysłaniem; 'processed' = najnowszy, minus mały
        // margines, by hint nigdy nie wyprzedził clock.slot walidatora.
        const cur = await connection.getSlot('processed')
        slotHint = Math.max(0, cur - 2)
        ;[ticket] = ticketPDA(player, slotHint)
        return sendAndConfirmTx(
          connection,
          wallet,
          program.methods
            .commitGuess(
              modeObj.mode,
              new BN(guess),
              Buffer.from(commitment),
              new BN(slotHint)
            )
            .accounts({
              config,
              vault,
              ticket,
              playerTokenAccount: ata,
              h173kMint: TOKEN_MINT,
              player,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
              rent: SYSVAR_RENT_PUBKEY,
            })
        )
      }
      await ensureSol()
      // Commit można bezpiecznie ponawiać ze świeżym slotem: jeśli się nie powiedzie,
      // jest atomowy → opłata h173k NIE schodzi. Po wyczerpaniu prób, gdy biletu nadal
      // nie ma, zwracamy „miękki" sygnał — UI pokaże standardowe „nie tym razem".
      let committed = false
      for (let attempt = 1; attempt <= 3 && !committed; attempt++) {
        try {
          await doCommit()
          committed = true
        } catch (e) {
          if (isFatalError(e)) throw e
          // czy bilet jednak wszedł? (timeout = mogła wejść późno → dłuższy polling)
          const tries = isConfirmTimeoutError(e) ? 4 : 1
          if (await ticketLanded(program, ticket, tries)) {
            committed = true
            break
          }
          if (isInsufficientSolError(e)) await ensureSol()
          if (attempt < 3) await sleep(400)
        }
      }
      if (!committed) {
        // opłata nie pobrana — potraktuj jak zwykły brak wygranej
        throw new Error('SPIN_NOT_PLACED')
      }

      // 3. Odczyt rzeczywistego slotu commitu i odczekanie min. 2 slotów
      onStage?.('waiting')
      const committedTk = await program.account.playerTicket.fetch(ticket)
      const commitSlot = committedTk.commitSlot.toNumber()
      await waitForSlot(connection, commitSlot + 2)

      // 4. REVEAL — idempotentnie (jeśli już odsłonięty, tylko czytamy wynik)
      onStage?.('reveal')
      const doReveal = async () => {
        // strażnik idempotencji — bezpieczny przy ewentualnym ponowieniu
        try {
          const tk = await program.account.playerTicket.fetch(ticket)
          if (tk.isRevealed) return null
        } catch {
          /* brak konta? spróbuj odsłonić */
        }
        return sendAndConfirmTx(
          connection,
          wallet,
          program.methods
            .revealResult(Buffer.from(secretSalt), new BN(slotHint))
            .accounts({
              config,
              vault,
              ticket,
              winnerTokenAccount: ata,
              h173kMint: TOKEN_MINT,
              slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
              player,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
        )
      }
      await ensureSol()
      // Reveal jest idempotentny (doReveal sprawdza isRevealed), więc można go
      // bezpiecznie ponawiać. Opłata została już pobrana przy commicie, dlatego
      // przy ostatecznym niepowodzeniu zwracamy realny błąd (nie „miękki").
      let revealSig = null
      let revealed = false
      // Po commit_slot + MAX_SLOTS(150) kontrakt odrzuca reveal (RevealTooLate),
      // więc po przekroczeniu tego slotu dalsze próby/odpytywanie RPC są bezcelowe.
      const revealDeadlineSlot = commitSlot + 150
      for (let attempt = 1; attempt <= 3 && !revealed; attempt++) {
        if ((await connection.getSlot('processed')) > revealDeadlineSlot) break
        try {
          revealSig = await doReveal()
          revealed = true
        } catch (e) {
          if (isFatalError(e)) throw e
          const tries = isConfirmTimeoutError(e) ? 4 : 1
          if (await revealLanded(program, ticket, tries)) {
            revealed = true
            break
          }
          if (isInsufficientSolError(e)) await ensureSol()
          if (attempt < 3) await sleep(400)
        }
      }
      if (!revealed) {
        // jeśli okno reveal jeszcze trwa, ostatni raz sprawdź, czy nie wszedł późno
        // (wtedy odczytamy wynik niżej, łącznie z ewentualną wygraną); po terminie
        // nie odpytujemy już RPC — reveal i tak nie przejdzie.
        const withinWindow =
          (await connection.getSlot('processed')) <= revealDeadlineSlot
        if (withinWindow && (await revealLanded(program, ticket, 4))) {
          revealed = true
        } else {
          // Nie udało się odsłonić w oknie. Opłata — jak przy każdym spinie — już zeszła,
          // a wygrane są skrajnie rzadkie, więc pokazujemy standardowe „nie tym razem".
          console.warn('[lottery] reveal not confirmed for ticket', ticket?.toBase58?.())
          throw new Error('SPIN_UNRESOLVED')
        }
      }

      // 5. Wynik
      const finalTk = await program.account.playerTicket.fetch(ticket)
      const won = !!finalTk.won
      const winningNumber = finalTk.winningNumber.toNumber()

      let prize = 0
      if (won) {
        // revealSig może być null, jeśli odzyskaliśmy się po timeout — wtedy fallback szacuje.
        if (revealSig) prize = await readPrizeFromTx(connection, revealSig, ata)
        if (!prize) prize = await estimatePrizeH173k() // fallback
      }

      // Pay the referral bonus separately and best-effort — never affects the spin.
      // Price is resolved internally (last-known / pool) when not provided.
      payReferralBonusSafe(connection, wallet, ata, null).catch(() => {})

      return { won, prize, guess, winningNumber }
    },
    [
      configured,
      getProgram,
      wallet,
      connection,
      configPDA,
      vaultPDA,
      ticketPDA,
      withAutoSOL,
      estimatePrizeH173k,
      estimateSpinSolCost,
    ]
  )

  return useMemo(
    () => ({
      configured,
      play,
      getLastWinner,
      estimatePrizeH173k,
      estimateSpinSolCost,
      getVaultBalanceRaw,
    }),
    [configured, play, getLastWinner, estimatePrizeH173k, estimateSpinSolCost, getVaultBalanceRaw]
  )
}

// ── Pomocnicze (poza komponentem) ────────────────────────────────────────────

async function waitForSlot(connection, targetSlot, maxWaitMs = 30000) {
  const start = Date.now()
  // pierwsze sprawdzenie ('confirmed' — spójne z odczytem commit_slot z biletu)
  let slot = await connection.getSlot('confirmed')
  while (slot < targetSlot) {
    if (Date.now() - start > maxWaitMs) break
    await sleep(450) // ~1 slot
    try {
      slot = await connection.getSlot('confirmed')
    } catch {
      /* przejściowy błąd RPC — spróbuj dalej */
    }
  }
}

/**
 * Z transakcji reveal odczytuje dokładną kwotę nagrody = przyrost salda
 * h173k na koncie ATA gracza. Zwraca wartość w h173k lub 0.
 */
async function readPrizeFromTx(connection, signature, ata) {
  if (!signature) return 0
  try {
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    })
    if (!tx || !tx.meta) return 0
    const ataStr = ata.toString()
    const keys = (tx.transaction?.message?.accountKeys || []).map((k) =>
      (k.pubkey || k).toString()
    )
    const idx = keys.indexOf(ataStr)
    if (idx < 0) return 0
    const pre = (tx.meta.preTokenBalances || []).find((b) => b.accountIndex === idx)
    const post = (tx.meta.postTokenBalances || []).find((b) => b.accountIndex === idx)
    const preAmt = pre?.uiTokenAmount?.uiAmount || 0
    const postAmt = post?.uiTokenAmount?.uiAmount || 0
    const delta = postAmt - preAmt
    return delta > 0 ? delta : 0
  } catch {
    return 0
  }
}

/**
 * Wykrywa wypłatę z vaultu: vault (token account) traci h173k, ktoś inny zyskuje.
 * Zwraca { winner, amount } lub null (np. transakcja commit = wpłata do vaultu).
 */
function parseVaultPayout(tx, vaultStr) {
  if (!tx || !tx.meta) return null
  const keys = (tx.transaction?.message?.accountKeys || []).map((k) =>
    (k.pubkey || k).toString()
  )
  const vaultIdx = keys.indexOf(vaultStr)
  if (vaultIdx < 0) return null

  const pre = tx.meta.preTokenBalances || []
  const post = tx.meta.postTokenBalances || []

  const byIdx = (arr, i) => arr.find((b) => b.accountIndex === i)

  const vaultPre = byIdx(pre, vaultIdx)?.uiTokenAmount?.uiAmount || 0
  const vaultPost = byIdx(post, vaultIdx)?.uiTokenAmount?.uiAmount || 0
  const vaultDelta = vaultPost - vaultPre

  // Wypłata = vault zmalał. (Commit = vault wzrósł → pomijamy.)
  if (vaultDelta >= 0) return null

  // Znajdź beneficjenta: konto, którego saldo h173k wzrosło.
  let winner = null
  let amount = Math.abs(vaultDelta)
  for (const p of post) {
    if (p.accountIndex === vaultIdx) continue
    const prev = byIdx(pre, p.accountIndex)?.uiTokenAmount?.uiAmount || 0
    const now = p.uiTokenAmount?.uiAmount || 0
    if (now - prev > 0) {
      winner = p.owner || null
      amount = now - prev
      break
    }
  }
  if (!winner) return null
  return { winner, amount }
}

export default useLottery
