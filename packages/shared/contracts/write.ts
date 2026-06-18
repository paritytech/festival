import { ref } from 'vue'
import {
  encodeFunctionData,
  bytesToHex,
  type Abi,
} from 'viem'
import { Binary, type PolkadotSigner, type TxEvent } from 'polkadot-api'
import { useMainClient } from '../host/client'
import { ss58ToH160 } from '../utils/address'
import { decodeContractError } from './errors'
import { withTimeout, TimeoutError } from './retry'

/**
 * Headroom on dry-run estimates before they become real tx limits. Weight
 * varies more than storage (which is byte-deterministic), so it gets the
 * larger multiplier.
 */
const WEIGHT_MULTIPLIER_NUM = 3n
const WEIGHT_MULTIPLIER_DEN = 2n
const STORAGE_MULTIPLIER_NUM = 5n
const STORAGE_MULTIPLIER_DEN = 4n
/** Conservative storage deposit limit for dry-run estimation (50 DOT). */
const DRY_RUN_STORAGE_DEPOSIT = 500_000_000_000n
/**
 * Last-resort limits for when the dry-run can't run (e.g. an unmapped account,
 * which pallet-revive rejects with `AccountUnmapped`). proof_size must be large
 * enough to deploy a FestivalSession plus its nested init calls.
 */
const FALLBACK_WEIGHT_LIMIT = { ref_time: 500_000_000_000n, proof_size: 3_000_000n }
const FALLBACK_STORAGE_DEPOSIT = 50_000_000_000n
/**
 * Per-attempt cap on the pre-tx reads (account mapping + dry-run). On a flapping
 * host-routed connection these calls can be orphaned and never settle; without
 * a cap the submit hangs on "Checking in…" forever (the same failure mode as
 * the validation read). The signing/broadcast/watch phase is deliberately NOT
 * timed — it waits on the user and the chain.
 */
const PRE_TX_READ_TIMEOUT_MS = 8000

export type TxStatus = 'idle' | 'preparing' | 'signing' | 'broadcasting' | 'in-block' | 'finalized' | 'error'

/**
 * Watch a PAPI transaction through its lifecycle.
 * Resolves on txBestBlocksState (fast) by default.
 */
export function watchTransaction(
  transaction: { signSubmitAndWatch: (signer: PolkadotSigner, options?: any) => any },
  signer: PolkadotSigner,
  onStatus?: (status: TxStatus) => void,
): Promise<`0x${string}`> {
  onStatus?.('signing')
  return new Promise((resolve, reject) => {
    let resolved = false
    const observable = transaction.signSubmitAndWatch(signer, {
      mortality: { mortal: true, period: 256 },
    })
    const subscription = observable.subscribe({
      next: (event: TxEvent) => {
        if (event.type === 'signed') onStatus?.('signing')
        if (event.type === 'broadcasted') onStatus?.('broadcasting')

        if (
          event.type === 'txBestBlocksState' &&
          event.found &&
          !resolved
        ) {
          if (!event.ok) {
            onStatus?.('error')
            subscription.unsubscribe()
            reject(new Error(`Transaction failed: ${JSON.stringify(event.dispatchError)}`))
            return
          }
          onStatus?.('in-block')
          resolved = true
          resolve(event.txHash as `0x${string}`)
        }

        if (event.type === 'finalized') {
          if (!resolved) {
            if (!event.ok) {
              onStatus?.('error')
              subscription.unsubscribe()
              reject(new Error(`Transaction failed: ${JSON.stringify(event.dispatchError)}`))
              return
            }
            resolve(event.txHash as `0x${string}`)
          }
          onStatus?.('finalized')
          subscription.unsubscribe()
        }
      },
      error: (err: unknown) => {
        onStatus?.('error')
        subscription.unsubscribe()
        reject(err)
      },
    })
  })
}

/**
 * Write to a contract via pallet_revive.call() with dry-run gas estimation.
 * Host-only. No EVM wallet fallback.
 */
export async function writeContract({
  address,
  abi,
  functionName,
  args = [],
  value,
  signer,
  walletAddress,
  onStatus,
}: {
  address: `0x${string}`
  abi: Abi
  functionName: string
  args?: unknown[]
  value?: bigint
  signer: PolkadotSigner
  walletAddress: string
  onStatus?: (status: TxStatus) => void
}): Promise<`0x${string}`> {
  onStatus?.('preparing')

  // Permission is checked by the host itself during `remote_chain_transaction_broadcast`.
  // Pre-requesting it here raced the host's own check and surfaced as
  // "Permission denied" on first grant.

  const calldata = encodeFunctionData({ abi, functionName, args })
  const { api } = useMainClient()

  // An account is mapped once pallet-revive's map_account has stored its
  // SS58→H160 entry. sdk-ink's addressIsMapped did exactly this lookup:
  // Revive.OriginalAccount keyed by the account's derived H160. ss58ToH160
  // (from @parity/product-sdk-address) matches pallet-revive's AccountId32Mapper
  // derivation (keccak256(account_id)[12..], or the 0xEE-suffixed EVM address).
  const mapping = await withTimeout(
    api.query.Revive.OriginalAccount.getValue(ss58ToH160(walletAddress)),
    PRE_TX_READ_TIMEOUT_MS,
  )
  const isMapped = mapping != null

  // Dry-run for gas estimation + early revert detection. Only works for mapped
  // accounts (pallet-revive rejects unmapped SS58 with `AccountUnmapped`);
  // unmapped accounts fall through to FALLBACK_* below.
  let weightLimit, storageDepositLimit
  let dryRunRevertError: string | null = null
  if (isMapped) {
    try {
      const dryRun = await withTimeout(api.apis.ReviveApi.call(
        walletAddress,
        address.toLowerCase(),
        value ?? 0n,
        undefined,
        DRY_RUN_STORAGE_DEPOSIT,
        Binary.fromHex(calldata),
      ), PRE_TX_READ_TIMEOUT_MS)
      if (dryRun.result.success && !(dryRun.result.value.flags & 1)) {
        weightLimit = {
          ref_time: (dryRun.weight_required.ref_time * WEIGHT_MULTIPLIER_NUM) / WEIGHT_MULTIPLIER_DEN,
          proof_size: (dryRun.weight_required.proof_size * WEIGHT_MULTIPLIER_NUM) / WEIGHT_MULTIPLIER_DEN,
        }
        storageDepositLimit =
          dryRun.storage_deposit.value > 0n
            ? (dryRun.storage_deposit.value * STORAGE_MULTIPLIER_NUM) / STORAGE_MULTIPLIER_DEN
            : DRY_RUN_STORAGE_DEPOSIT
      } else if (dryRun.result.success) {
        // Contract reverted. Decode the revert data
        const revertHex = bytesToHex(dryRun.result.value.data)
        if ((import.meta as any).env?.DEV) {
          console.warn(`[writeContract] ${functionName} contract-revert revertHex=${revertHex}`)
        }
        dryRunRevertError = decodeContractError(revertHex)
      } else {
        // Pallet-level failure (out of gas, deposit too low, etc.). Dev-only
        // log; users get the generic message below.
        if ((import.meta as any).env?.DEV) {
          try {
            const detail = JSON.stringify(dryRun.result.value, (_k, v) =>
              typeof v === 'bigint' ? v.toString() : v)
            console.warn(`[writeContract] ${functionName} pallet-failure ${detail}`)
          } catch {
            console.warn(`[writeContract] ${functionName} pallet-failure (could not stringify)`)
          }
        }
        dryRunRevertError = 'Transaction would fail: contract call rejected by chain runtime.'
      }
    } catch (err) {
      // A stalled dry-run should retry, not silently sign+broadcast with
      // fallback gas on a flapping connection. Genuine dry-run failures
      // (e.g. unmapped accounts) still fall through to conservative estimates.
      if (err instanceof TimeoutError) throw err
      console.warn('[writeContract] Dry-run failed, using conservative estimates:', err)
    }
  }

  if (dryRunRevertError) {
    throw new Error(dryRunRevertError)
  }

  if (!weightLimit) {
    weightLimit = FALLBACK_WEIGHT_LIMIT
    storageDepositLimit = FALLBACK_STORAGE_DEPOSIT
  }

  const contractCall = api.tx.Revive.call({
    dest: address.toLowerCase(),
    value: value ?? 0n,
    weight_limit: weightLimit,
    storage_deposit_limit: storageDepositLimit!,
    data: Binary.fromHex(calldata),
  })

  // If unmapped, batch map_account + contract call
  let tx
  if (!isMapped) {
    const mapCall = api.tx.Revive.map_account()
    tx = api.tx.Utility.batch_all({
      calls: [mapCall.decodedCall, contractCall.decodedCall],
    })
  } else {
    tx = contractCall
  }

  return watchTransaction(tx, signer, onStatus)
}
