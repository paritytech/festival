/**
 * Host-routed chain + Bulletin read layer. The worker never touches the network
 * itself — two transports, both serviced by the host, no gateway, no fetch():
 *
 *   1. Contract reads via `createPapiProvider(genesisHash)` + PAPI's untyped
 *      `getUnsafeApi()`, so no descriptors / ABIs / viem are bundled.
 *   2. Bulletin blobs via `@parity/product-sdk-cloud-storage`'s `queryJson`,
 *      which resolves through the host preimage lookup. It has NO HTTP fallback,
 *      which is the point: the fetch moves into the trusted, cached host.
 *
 * Does NOT reuse `@festival/shared`'s read helpers — they gate on `isInHost()`
 * (window-based, false in this sandbox) and pull in viem + descriptors.
 */

import { Binary, createClient, type PolkadotClient } from 'polkadot-api'
import { createPapiProvider } from '@novasamatech/host-api-wrapper'
import { hashToCid, queryJson } from '@parity/product-sdk-cloud-storage'
import { CHAIN_GENESIS_HASH, FESTIVAL_ADDRESS, READ_ONLY_ORIGIN, ZERO_BYTES32 } from './config'

/** Festival getter selectors = keccak256("<sig>")[:4]. Both return a single bytes32. */
const SELECTOR = {
  channelMetadataCid: '0xd5ec6bab',
  metadataCid: '0xff368581',
} as const

/** Minimal view of `ReviveApi.call` dry-run output (the unsafe API is untyped). */
interface ReviveCallDryRun {
  result:
    | { success: true; value: { flags: number; data: Uint8Array } }
    | { success: false }
}

let client: PolkadotClient | null = null

/** Shared host-routed PAPI client (lazy). Reused by readCall and the watcher. */
export function getClient(): PolkadotClient {
  if (!client) client = createClient(createPapiProvider(CHAIN_GENESIS_HASH))
  return client
}

/**
 * Dry-run a no-arg view getter on any contract, returning the full ABI
 * returndata. Args in runtime-API order: origin, dest (H160), value,
 * gas_limit (None), storage_deposit_limit (None), input. The `.toLowerCase()`
 * on the H160 is mandatory — EIP-55 mixed case fails the dry-run.
 */
export async function readCall(
  address: `0x${string}`,
  selector: string,
  label: string,
): Promise<`0x${string}`> {
  const dryRun = (await getClient().getUnsafeApi().apis.ReviveApi.call(
    READ_ONLY_ORIGIN,
    address.toLowerCase(),
    0n,
    undefined,
    undefined,
    Binary.fromHex(selector),
    { at: 'best' },
  )) as ReviveCallDryRun

  if (!dryRun.result.success) throw new Error(`${label} dry-run failed`)
  if (dryRun.result.value.flags & 1) throw new Error(`${label} reverted`)
  return Binary.toHex(dryRun.result.value.data) as `0x${string}`
}

/** Single-bytes32 Festival getter — the returned word IS the value. */
function readBytes32(selector: string, label: string): Promise<`0x${string}`> {
  return readCall(FESTIVAL_ADDRESS, selector, label)
}

/** Read `Festival.channelMetadataCid()` → bytes32 pointer (zero when unset). */
export function readChannelMetadataCid(): Promise<`0x${string}`> {
  return readBytes32(SELECTOR.channelMetadataCid, 'channelMetadataCid')
}

/** Read `Festival.metadataCid()` → bytes32 pointer to the festival metadata doc. */
export function readMetadataCid(): Promise<`0x${string}`> {
  return readBytes32(SELECTOR.metadataCid, 'metadataCid')
}

export function isZeroCid(cid: `0x${string}`): boolean {
  return cid.toLowerCase() === ZERO_BYTES32
}

/**
 * On-chain bytes32 digest → CIDv1 string. `hashToCid` defaults to blake2b-256 +
 * raw codec, the format Bulletin's TransactionStorage produces. Body CIDs in the
 * channel doc are already CID strings; this is only for on-chain bytes32 pointers.
 */
export function bytes32ToCid(bytes32: `0x${string}`): string {
  return hashToCid(bytes32)
}

/**
 * Resolved-blob cache. Content is addressed by CID (immutable), so a hit is
 * always valid — a changed doc means a new pointer → new CID → cache miss. This
 * lets the snapshot rebuild on an event without re-fetching unchanged blobs.
 * Bounded by the festival's finite doc count, so no eviction.
 */
const blobCache = new Map<string, unknown>()

/** Retrieve + JSON-parse a Bulletin blob through the host. Cached by CID. */
export async function retrieveJson<T>(cid: string): Promise<T> {
  if (blobCache.has(cid)) return blobCache.get(cid) as T
  const value = await queryJson<T>(cid)
  blobCache.set(cid, value)
  return value
}
