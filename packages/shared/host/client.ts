import { createClient, type PolkadotClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { getHostProvider } from '@parity/product-sdk-host'
import { mainDescriptor, bulletinDescriptor } from '#active-descriptors'
import {
  SUBSTRATE_WS_URL,
  CHAIN_GENESIS_HASH,
  BULLETIN_RPC,
  BULLETIN_GENESIS_HASH,
} from './constants'
import { isInHost } from './detect'

// Cache PAPI clients per genesis hash to prevent in-flight chainHead events
// from a destroyed client corrupting a new client's block tree.
const clientCache = new Map<string, PolkadotClient>()
let bulletinClientInstance: PolkadotClient | null = null

/**
 * Get or create a PAPI client for a given chain genesis hash.
 * Host mode: routed via the host provider (through host sandbox).
 * Standalone mode: direct WebSocket connection.
 *
 * Async because the facade's `getHostProvider` resolves the host connection
 * lazily (and is nullable outside a host container).
 */
async function getOrCreateClient(genesis: `0x${string}`): Promise<PolkadotClient> {
  let client = clientCache.get(genesis)
  if (!client) {
    const provider = isInHost()
      ? await getHostProvider(genesis)
      : getWsProvider(SUBSTRATE_WS_URL)
    if (!provider) {
      throw new Error('[client] host provider unavailable')
    }

    client = createClient(provider)
    clientCache.set(genesis, client)
  }
  return client
}

/**
 * Main chain PAPI client (Polkadot Hub TestNet).
 * Cached per genesis hash for reuse.
 */
export async function useMainClient() {
  const client = await getOrCreateClient(CHAIN_GENESIS_HASH)
  return {
    client,
    api: client.getTypedApi(mainDescriptor),
  }
}

/**
 * Bulletin Chain PAPI client.
 * Host mode: routed via the host provider on the bulletin genesis hash.
 * Standalone mode: direct WebSocket to BULLETIN_RPC.
 */
export async function useBulletinClient() {
  if (!bulletinClientInstance) {
    const provider = isInHost()
      ? await getHostProvider(BULLETIN_GENESIS_HASH)
      : getWsProvider(BULLETIN_RPC)
    if (!provider) {
      throw new Error('[client] bulletin host provider unavailable')
    }
    bulletinClientInstance = createClient(provider)
  }
  return {
    client: bulletinClientInstance,
    api: bulletinClientInstance.getTypedApi(bulletinDescriptor),
  }
}
