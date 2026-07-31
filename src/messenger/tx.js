/**
 * H173K Wallet - Messenger transaction builder.
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

export { MAX_MEMO_BYTES }

export function toLamports(amount) {
  return Math.round(Number(amount) * Math.pow(10, TOKEN_DECIMALS))
}

/**
 * Send one memo transaction.
 * @param {object} args
 *   connection, publicKey, memo (string), withAutoSOL,
 *   transfers: [{ to: <address>, amount: <h173k, ui units> }]
 * @returns {Promise<string>} signature
 */
export async function sendMemoTransaction({ connection, publicKey, memo, transfers = [], withAutoSOL }) {
  if (!sessionWallet.isUnlocked()) throw new Error('Wallet is locked')

  const memoBytes = new TextEncoder().encode(memo)
  if (memoBytes.length > MAX_MEMO_BYTES) throw new Error('MEMO_TOO_LONG')

  // Resolve every destination token account up front and find out which of them
  // still have to be created, so the SOL top-up can account for the rent.
  const resolved = []
  let extraRent = 0
  for (const t of transfers) {
    if (!t || !t.to) continue
    let owner
    try { owner = new PublicKey(t.to) } catch { throw new Error('Invalid address') }
    const ata = await getAssociatedTokenAddress(TOKEN_MINT, owner)
    let exists = true
    try { await getAccount(connection, ata) } catch { exists = false }
    if (!exists) extraRent += ATA_RENT_SOL
    resolved.push({ owner, ata, exists, lamports: toLamports(t.amount || 0) })
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
