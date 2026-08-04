/**
 * h173k Wallet - Messenger transaction builder.
 *
 * Every messenger action is one transaction: a memo (the encrypted envelope)
 * plus one or more tiny h173k transfers. Which transfers depends on the action:
 *
 *   direct message   MSG_COST -> the conversation address
 *                    fee      -> the recipient's wallet (anti-spam fee, optional)
 *   invitation       MSG_COST -> the recipient's wallet (that is the only
 *                    address we can reach before a conversation exists)
 *   group message    group cost -> the group address
 *
 * Token accounts that do not exist yet are created in the same transaction and
 * the sender pays their rent; the amount is passed to withAutoSOL so the wallet
 * can top itself up with SOL beforehand.
 */

import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from '@solana/spl-token'
import { TOKEN_MINT, TOKEN_DECIMALS } from '../constants'
import { sessionWallet } from '../crypto/wallet'
import { ATA_RENT_SOL } from './channels'
import { MAX_MEMO_BYTES } from './envelope'

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

/**
 * Serialized size of a memo transaction with `transferCount` transfers.
 *
 * Built and serialized for real rather than estimated from a formula: the
 * encoding depends on how many distinct accounts appear and how the compiler
 * orders them, and an estimate that came out low would produce a transaction
 * the network rejects. Costs nothing — no network involved.
 */
export function estimateTransactionSize(memo, transferCount) {
  const payer = new PublicKey('11111111111111111111111111111112')
  const source = PublicKey.unique()   // our own token account: the same every time
  const tx = new Transaction()
  for (let i = 0; i < transferCount; i++) {
    // One shared source and a distinct destination each — exactly the shape of
    // a real message transaction. Giving every transfer its own source too
    // would double the account table and understate how many pings fit.
    tx.add(createTransferInstruction(source, PublicKey.unique(), payer, 1))
  }
  tx.add(new TransactionInstruction({
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, 'utf8'),
  }))
  tx.recentBlockhash = '11111111111111111111111111111111'
  tx.feePayer = payer
  try {
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length
  } catch {
    // Already over the limit; report something above it so no pings are added.
    return 2000
  }
}

export { MAX_MEMO_BYTES }

export function toLamports(amount) {
  return Math.round(Number(amount) * Math.pow(10, TOKEN_DECIMALS))
}

/**
 * Send one memo transaction.
 *
 * A transfer marked `optional: true` is dropped when the destination has no
 * token account yet, instead of creating one. Notification pings are optional
 * in that sense: opening an account costs ~0.002 SOL in rent, which is far more
 * than a courtesy ping is worth, and would let a large group make one message
 * cost a fortune.
 *
 * @param {object} args
 *   connection, publicKey, memo (string), withAutoSOL,
 *   transfers: [{ to: <address>, amount: <h173k, ui units>, optional?: bool }]
 * @returns {Promise<string>} signature
 */
export async function sendMemoTransaction({ connection, publicKey, memo, transfers = [], withAutoSOL }) {
  if (!sessionWallet.isUnlocked()) throw new Error('Wallet is locked')

  const memoBytes = new TextEncoder().encode(memo)
  if (memoBytes.length > MAX_MEMO_BYTES) throw new Error('MEMO_TOO_LONG')

  // Resolve every destination token account up front and find out which of them
  // still have to be created, so the SOL top-up can account for the rent.
  const pending = []
  for (const t of transfers) {
    if (!t || !t.to) continue
    let owner
    try { owner = new PublicKey(t.to) } catch { throw new Error('Invalid address') }
    const ata = await getAssociatedTokenAddress(TOKEN_MINT, owner)
    pending.push({ owner, ata, optional: !!t.optional, lamports: toLamports(t.amount || 0) })
  }

  // One RPC round trip for every destination rather than one each: a group
  // message pings many members at once, and a request per member would be slow
  // and hostile to free-tier providers.
  const existence = await accountsExist(connection, pending.map((p) => p.ata))

  const resolved = []
  let extraRent = 0
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i]
    const exists = existence[i]
    if (!exists && p.optional) continue // never pay rent for a courtesy transfer
    if (!exists) extraRent += ATA_RENT_SOL
    resolved.push({ ...p, exists })
  }

  return withAutoSOL(
    async () => {
      const senderTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)
      const transaction = new Transaction()

      for (const r of resolved) {
        // Re-check: another transaction may have created it in the meantime.
        let exists = r.exists
        if (!exists) {
          try { await getAccount(connection, r.ata); exists = true } catch { exists = false }
        }
        if (!exists) {
          transaction.add(
            createAssociatedTokenAccountInstruction(publicKey, r.ata, r.owner, TOKEN_MINT)
          )
        }
        if (r.lamports > 0) {
          transaction.add(
            createTransferInstruction(senderTokenAccount, r.ata, publicKey, r.lamports)
          )
        }
      }

      transaction.add(
        new TransactionInstruction({
          keys: [{ pubkey: publicKey, isSigner: true, isWritable: false }],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(memo, 'utf8'),
        })
      )

      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey

      const signed = sessionWallet.signTransaction(transaction)
      const sig = await connection.sendRawTransaction(signed.serialize())
      await connection.confirmTransaction(sig, 'confirmed')
      return sig
    },
    () => {},
    extraRent
  )
}

/**
 * Create the token account of an address without sending anything to it.
 * Used when a conversation or a group address is set up.
 */
/**
 * Which of these token accounts exist, in a single request.
 * On failure every account is reported as missing, which is the safe answer:
 * optional transfers are skipped rather than silently creating accounts.
 */
async function accountsExist(connection, atas) {
  if (atas.length === 0) return []
  try {
    const infos = await connection.getMultipleAccountsInfo(atas)
    return infos.map((info) => !!info)
  } catch {
    return atas.map(() => false)
  }
}

export async function createTokenAccountFor({ connection, publicKey, address, withAutoSOL }) {
  const owner = new PublicKey(address)
  const ata = await getAssociatedTokenAddress(TOKEN_MINT, owner)
  try {
    await getAccount(connection, ata)
    return null // already there
  } catch {}

  return withAutoSOL(
    async () => {
      const transaction = new Transaction()
      transaction.add(createAssociatedTokenAccountInstruction(publicKey, ata, owner, TOKEN_MINT))
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey
      const signed = sessionWallet.signTransaction(transaction)
      const sig = await connection.sendRawTransaction(signed.serialize())
      await connection.confirmTransaction(sig, 'confirmed')
      return sig
    },
    () => {},
    ATA_RENT_SOL
  )
}
