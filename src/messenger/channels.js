/**
 * H173K Wallet - Dedicated conversation addresses ("channels").
 *
 * WHY
 * Talking on the wallet address means anybody who knows that address can drop
 * memos into the thread, which is exactly what spam bots do. So every new
 * conversation gets its own address, created by whoever starts the conversation
 * and announced to the other side inside the (encrypted) invitation. Bots that
 * only know the wallet address can reach the invitation inbox, never the
 * conversation itself.
 *
 * HOW IT WORKS
 * A channel is a plain Solana address used as a drop box: both participants
 * send their message-carrying transfers TO that address and both read its
 * transaction history. Nobody has to sign as the channel, so the address never
 * needs SOL — only its token account has to exist (the creator pays that rent
 * once).
 *
 * The channel keypair is derived deterministically from the wallet seed plus a
 * label, which means:
 *  - it can be recreated after a reinstall from the seed phrase alone,
 *  - the creator keeps the key and can sweep the accumulated dust later,
 *  - it is unlinkable to the wallet address for anyone without the seed.
 */

import { Keypair, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { sessionWallet } from '../crypto/wallet'
import { deriveSeed } from './msgcrypto'
import { TOKEN_MINT } from '../constants'

const CHANNEL_LABEL = 'h173k_msg_channel_v1'
const GROUP_LABEL = 'h173k_msg_group_v1'

// Rent for creating a token account for a channel that has none yet.
export const ATA_RENT_SOL = 0.00204

/**
 * Derive the keypair of a dedicated conversation address.
 * @param {string} label unique per conversation (peer address, or "g:<groupId>")
 */
export function deriveChannelKeypair(label) {
  if (!sessionWallet.isUnlocked()) throw new Error('Wallet is locked')
  const kp = sessionWallet.getKeypairSilent()
  const seed = deriveSeed(kp.secretKey, CHANNEL_LABEL + '|' + label)
  return Keypair.fromSeed(seed)
}

/** Address of the dedicated conversation created by us for `peerAddress`. */
export function deriveConversationAddress(peerAddress) {
  return deriveChannelKeypair(peerAddress).publicKey.toBase58()
}

/**
 * The keypair behind the address serving a group we created.
 *
 * The admin keeps this key, so the message costs that pile up at the group
 * address stay recoverable: the key is reproducible from the seed phrase alone.
 * (There is no withdrawal screen yet - the funds simply accumulate.)
 */
export function deriveGroupKeypair(groupId) {
  if (!sessionWallet.isUnlocked()) throw new Error('Wallet is locked')
  const kp = sessionWallet.getKeypairSilent()
  const seed = deriveSeed(kp.secretKey, GROUP_LABEL + '|' + groupId)
  return Keypair.fromSeed(seed)
}

/** Address of the dedicated address serving a group we created. */
export function deriveGroupAddress(groupId) {
  return deriveGroupKeypair(groupId).publicKey.toBase58()
}

/** Token account of any address, or null when the address is malformed. */
export async function tokenAccountOf(address) {
  try {
    return await getAssociatedTokenAddress(TOKEN_MINT, new PublicKey(address))
  } catch {
    return null
  }
}

/** h173k balance of any address (0 when it holds no token account). */
export async function balanceOf(connection, address) {
  const ata = await tokenAccountOf(address)
  if (!ata) return 0
  try {
    const res = await connection.getTokenAccountBalance(ata)
    return res?.value?.uiAmount || 0
  } catch {
    return 0
  }
}
