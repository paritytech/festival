/**
 * Shared pallet-revive deploy helpers — the signer derivation, EVM-address
 * derivation, and dry-run buffers used by every deploy/grant script. Kept here
 * so the deploy scripts can't silently diverge.
 *
 * NOTE: nothing here resolves the active network at import time. The network is
 * selected by a `--env` CLI override applied at the top of each script, so the
 * network-dependent dry-run deposit is computed by the caller (via
 * `dryRunDeposit`) only after that override has run.
 */
import { getPolkadotSigner, type PolkadotSigner } from 'polkadot-api/signer'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers'
import { AccountId } from '@polkadot-api/substrate-bindings'
import { keccak256 } from 'viem'

/** pallet-revive: 4× buffer applied to dry-run gas before it becomes a real limit. */
export const GAS_MULTIPLIER = 4n

/** keccak256(AccountId32) → H160 takes the low 20 bytes; `0x` + 24 hex chars skipped. */
const KECCAK_H160_HEX_OFFSET = 26

/** Conservative storage deposit for a dry-run: 50 native units, in chain decimals. */
export function dryRunDeposit(decimals: number): bigint {
  return 50n * 10n ** BigInt(decimals)
}

/** Build an sr25519 signer from the DEPLOYER_SEED mnemonic in the environment. */
export function createSigner(): { signer: PolkadotSigner; publicKey: Uint8Array; ss58: string } {
  const seed = process.env.DEPLOYER_SEED
  if (!seed) {
    throw new Error(
      'DEPLOYER_SEED not set. Provide a 12/24-word mnemonic in .env or as an env var.',
    )
  }

  const miniSecret = entropyToMiniSecret(mnemonicToEntropy(seed))
  const derive = sr25519CreateDerive(miniSecret)
  const keyPair = derive('')

  return {
    signer: getPolkadotSigner(keyPair.publicKey, 'Sr25519', keyPair.sign),
    publicKey: keyPair.publicKey,
    ss58: AccountId(42).dec(keyPair.publicKey),
  }
}

/**
 * Derive the H160 (EVM) address for a Substrate account.
 * pallet-revive: H160 = keccak256(AccountId32)[12..32]
 */
export function deriveH160(publicKey: Uint8Array): `0x${string}` {
  const hash = keccak256(publicKey)
  return ('0x' + hash.slice(KECCAK_H160_HEX_OFFSET)) as `0x${string}`
}
