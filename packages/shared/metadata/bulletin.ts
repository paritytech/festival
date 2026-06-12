import { ref } from 'vue'
import type { TxEvent } from 'polkadot-api'
import { getPreimageManager } from '@parity/product-sdk-host'
import {
  checkAuthorization as sdkCheckAuthorization,
  type BulletinApi,
} from '@parity/product-sdk-bulletin'
import { CID } from 'multiformats/cid'
import { STORE_TIMEOUT_MS } from '../host/constants'
import { computeCid, cidToBytes32, bytes32ToCid, cidToGatewayUrl } from './cid'
import { getCachedMetadata, setCachedMetadata } from '../cache/cid-cache'
import { isInHost } from '../host/detect'

const PREIMAGE_LOOKUP_TIMEOUT_MS = 30_000

/**
 * Convert a CID-or-bytes32 string to the 32-byte preimage hash.
 *
 * If the input already starts with `0x`, it's assumed to be a bytes32 and returned as-is.
 * Otherwise the string is parsed as a CID and its multihash digest is extracted,
 * the same bytes that `cidToBytes32` writes when storing.
 *
 * NOTE: do NOT feed the CID string through `computeCid(new TextEncoder().encode(...))`;
 * that hashes the CID's *string representation* and produces garbage.
 */
function toPreimageHash(cidOrBytes32: string): `0x${string}` {
  if (cidOrBytes32.startsWith('0x')) return cidOrBytes32 as `0x${string}`
  return cidToBytes32(CID.parse(cidOrBytes32))
}

export type BulletinTxStatus =
  | 'idle'
  | 'signing'
  | 'broadcasting'
  | 'in-block'
  | 'finalized'
  | 'error'

/**
 * Look up a preimage through the host. `lookup` is a subscription: it fires with
 * null while the value is still syncing and with the bytes once it lands, so we
 * wait for real bytes and let the timeout be the only "not available" signal.
 * Resolves with the bytes; rejects on interrupt or timeout; throws when the host
 * has no preimage manager.
 */
async function lookupPreimage(
  hash: `0x${string}`,
  timeoutMs = PREIMAGE_LOOKUP_TIMEOUT_MS,
): Promise<Uint8Array> {
  const manager = await getPreimageManager()
  if (!manager) throw new Error('preimage manager unavailable')
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      subscription.unsubscribe()
      fn()
    }
    const timer = setTimeout(
      () => settle(() => reject(new Error('preimage lookup timed out'))),
      timeoutMs,
    )
    const subscription = manager.lookup(hash, (data) => {
      if (data) settle(() => resolve(data))
    })
    subscription.onInterrupt(() => settle(() => reject(new Error('preimage lookup interrupted'))))
  })
}

export function useBulletinStorage() {
  const txStatus = ref<BulletinTxStatus>('idle')

  /** Check if an account is authorized to store data on the bulletin chain. */
  async function checkAuthorization(address: string): Promise<{
    authorized: boolean
    remainingTx: bigint
    remainingBytes: bigint
  }> {
    const { useBulletinClient } = await import('../host/client')
    const { api } = useBulletinClient()

    try {
      const status = await sdkCheckAuthorization(
        api as unknown as BulletinApi,
        address,
      )
      return {
        authorized: status.authorized,
        remainingTx: BigInt(status.remainingTransactions),
        remainingBytes: status.remainingBytes,
      }
    } catch {
      return { authorized: false, remainingTx: 0n, remainingBytes: 0n }
    }
  }

  /** Store plaintext data on the bulletin chain (signed by the active wallet account). */
  async function storePlaintext(
    data: unknown,
  ): Promise<{ cid: string; bytes32: `0x${string}` }> {
    const dataBytes = new TextEncoder().encode(JSON.stringify(data))
    return storeRaw(dataBytes)
  }

  /** Store raw binary data (e.g., images). */
  async function storeImage(
    imageBytes: Uint8Array,
  ): Promise<{ cid: string; bytes32: `0x${string}` }> {
    return storeRaw(imageBytes)
  }

  /**
   * Core storage:
   * - Host mode: hand the bytes to `preimageManager.submit()`. The host is the
   *   `BulletinAllowance` arbiter (RFC-0010) and routes the write to Bulletin
   *   for us. Returns blake2b-256(value), which equals our CID digest.
   * - Standalone mode: sign `TransactionStorage.store` directly with the
   *   connected browser-wallet account, which must hold a Bulletin allowance.
   */
  async function storeRaw(
    dataBytes: Uint8Array,
  ): Promise<{ cid: string; bytes32: `0x${string}` }> {
    const cid = await computeCid(dataBytes)
    const bytes32 = cidToBytes32(cid)
    if (isInHost()) {
      return storeViaPreimageManager(dataBytes, cid.toString(), bytes32)
    }
    return storeViaBulletin(dataBytes, cid.toString(), bytes32)
  }

  async function storeViaPreimageManager(
    dataBytes: Uint8Array,
    cidStr: string,
    bytes32: `0x${string}`,
  ): Promise<{ cid: string; bytes32: `0x${string}` }> {
    txStatus.value = 'broadcasting'
    try {
      const manager = await getPreimageManager()
      if (!manager) {
        throw new Error('Preimage manager unavailable — not running inside a host container')
      }
      // The host enforces its own timeout on the underlying TransactionStorage
      // submission. Wrapping that with our own race here would just create a
      // misleading "outer timed out, inner still running" foot-gun. Surface
      // whatever the host returns directly.
      const hash = await manager.submit(dataBytes)
      // Both sides hash with blake2b-256; a mismatch means a host/SDK upgrade
      // changed the preimage digest and our CID derivation would no longer
      // match what was written. Fail loudly rather than store a bad pointer.
      if (hash.toLowerCase() !== bytes32.toLowerCase()) {
        throw new Error(
          `preimage hash mismatch: host=${hash} cid-digest=${bytes32}`,
        )
      }
      txStatus.value = 'finalized'
      return { cid: cidStr, bytes32 }
    } catch (err) {
      txStatus.value = 'error'
      throw err
    }
  }

  async function storeViaBulletin(
    dataBytes: Uint8Array,
    cidStr: string,
    bytes32: `0x${string}`,
  ): Promise<{ cid: string; bytes32: `0x${string}` }> {
    const { useBulletinClient } = await import('../host/client')
    const { useWalletStore } = await import('../host/wallet')
    const { api } = useBulletinClient()
    const walletStore = useWalletStore()

    txStatus.value = 'signing'

    const tx = api.tx.TransactionStorage.store({
      data: dataBytes,
    })

    const signer = walletStore.getSigner()

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        txStatus.value = 'error'
        reject(new Error('Bulletin storage transaction timed out'))
      }, STORE_TIMEOUT_MS)

      let resolved = false
      const subscription = tx.signSubmitAndWatch(signer, {
        mortality: { mortal: true, period: 256 },
      }).subscribe({
        next: (event: TxEvent) => {
          if (event.type === 'signed') txStatus.value = 'signing'
          if (event.type === 'broadcasted') txStatus.value = 'broadcasting'

          if (
            event.type === 'txBestBlocksState' &&
            event.found &&
            !resolved
          ) {
            if (!event.ok) {
              clearTimeout(timeout)
              txStatus.value = 'error'
              subscription.unsubscribe()
              reject(new Error(`Bulletin store failed: ${JSON.stringify(event.dispatchError)}`))
              return
            }
            txStatus.value = 'in-block'
            resolved = true
            clearTimeout(timeout)
            resolve()
          }

          if (event.type === 'finalized') {
            clearTimeout(timeout)
            if (!resolved) {
              if (!event.ok) {
                txStatus.value = 'error'
                subscription.unsubscribe()
                reject(new Error(`Bulletin store failed: ${JSON.stringify(event.dispatchError)}`))
                return
              }
              resolved = true
              resolve()
            }
            txStatus.value = 'finalized'
            subscription.unsubscribe()
          }
        },
        error: (err) => {
          clearTimeout(timeout)
          txStatus.value = 'error'
          subscription.unsubscribe()
          reject(err)
        },
      })
    })

    return { cid: cidStr, bytes32 }
  }

  /** Retrieve plaintext metadata. In the host: preimage only. Standalone: IPFS fetch. */
  async function retrievePlaintext<T = unknown>(cidOrBytes32: string): Promise<T> {
    const cached = await getCachedMetadata<T>(cidOrBytes32)
    if (cached) return cached

    // In the host the preimage manager is the only way out to the network, so
    // there's no gateway fallback. Standalone has none, so it fetches directly.
    if (isInHost()) {
      return await retrieveViaPreimage<T>(cidOrBytes32)
    }
    return await retrieveViaFetch<T>(cidOrBytes32)
  }

  /** Host mode: lookup preimage by hash. Throws if it can't be fetched. */
  async function retrieveViaPreimage<T>(cidOrBytes32: string): Promise<T> {
    const data = await lookupPreimage(toPreimageHash(cidOrBytes32))
    const result = JSON.parse(new TextDecoder().decode(data)) as T
    await setCachedMetadata(cidOrBytes32, result)
    return result
  }

  /** Fetch from IPFS gateway. Used standalone or as host fallback for pre-migration data. */
  async function retrieveViaFetch<T>(cidOrBytes32: string): Promise<T> {
    const cid = cidOrBytes32.startsWith('0x')
      ? bytes32ToCid(cidOrBytes32 as `0x${string}`)
      : cidOrBytes32
    const url = cidToGatewayUrl(cid)

    // Try fetch directly. Skip the permission gate since outbound request
    // permission isn't reliably supported across hosts, and this is often a
    // fallback path where the fetch itself will succeed or fail cleanly.
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`IPFS fetch failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json() as T
    await setCachedMetadata(cidOrBytes32, result)
    return result
  }

  /**
   * Resolve a CID (or bytes32) to a displayable image URL.
   * Standalone: returns IPFS gateway URL directly.
   * Host: retrieves bytes via preimage and creates a blob URL.
   */
  function resolveImageUrl(cidOrBytes32: string): string {
    // For immediate sync use (e.g., <img :src>), return gateway URL.
    // Host mode may fail on iOS but works on desktop.
    // A future enhancement could use resolveImageBlob() for host mode.
    const cid = cidOrBytes32.startsWith('0x')
      ? bytes32ToCid(cidOrBytes32 as `0x${string}`)
      : cidOrBytes32
    return cidToGatewayUrl(cid)
  }

  /**
   * Resolve an image CID/bytes32 to a blob URL via preimageManager. Host mode
   * only. Returns null in standalone, or when the preimage can't be fetched, so
   * the image just doesn't render.
   */
  async function resolveImageBlob(cidOrBytes32: string): Promise<string | null> {
    if (!isInHost()) return null
    try {
      const data = await lookupPreimage(toPreimageHash(cidOrBytes32))
      const blob = new Blob([new Uint8Array(data)], { type: 'image/jpeg' })
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  }

  /**
   * Resolve a CID/bytes32 to a URL you can put in an `<img src>`.
   *
   * In the host this is a `blob:` URL from the preimage manager, or null when
   * the preimage isn't there (callers just show no image). Standalone returns
   * the gateway URL.
   */
  async function resolveDisplayImageUrl(cidOrBytes32: string): Promise<string | null> {
    return isInHost() ? resolveImageBlob(cidOrBytes32) : resolveImageUrl(cidOrBytes32)
  }

  return {
    txStatus,
    checkAuthorization,
    storePlaintext,
    storeImage,
    storeRaw,
    retrievePlaintext,
    resolveImageUrl,
    resolveImageBlob,
    resolveDisplayImageUrl,
  }
}
