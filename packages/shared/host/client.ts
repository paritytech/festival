import { createClient, type PolkadotClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { createPapiProvider } from '@novasamatech/host-api-wrapper'
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

// Callbacks to run after the main client is torn down and evicted, so live
// consumers (e.g. the festival event watcher) can re-open their follow on the
// freshly built client. See resetMainClient / onMainClientReset.
const mainResetListeners = new Set<() => void>()

/**
 * Get or create a PAPI client for a given chain genesis hash.
 * Host mode: routed via createPapiProvider (through host sandbox).
 * Standalone mode: direct WebSocket connection.
 */
function getOrCreateClient(genesis: `0x${string}`): PolkadotClient {
  let client = clientCache.get(genesis)
  if (!client) {
    const provider = isInHost()
      ? createPapiProvider(genesis)
      : getWsProvider(SUBSTRATE_WS_URL)

    client = createClient(provider)
    clientCache.set(genesis, client)
  }
  return client
}

/**
 * Main chain PAPI client (Polkadot Hub TestNet).
 * Cached per genesis hash for reuse.
 */
export function useMainClient() {
  const client = getOrCreateClient(CHAIN_GENESIS_HASH)
  return {
    client,
    api: client.getTypedApi(mainDescriptor),
  }
}

/**
 * Register a callback to run after {@link resetMainClient} rebuilds the main
 * client — e.g. a watcher re-opening its chainHead follow on the new client.
 * Returns an unregister function.
 */
export function onMainClientReset(cb: () => void): () => void {
  mainResetListeners.add(cb)
  return () => mainResetListeners.delete(cb)
}

/**
 * Destroy and evict the cached main client so the next {@link useMainClient}
 * call builds a fresh one with a new chainHead follow — programmatically doing
 * what a page refresh does. Recovery of last resort for a wedged host-routed
 * connection: PAPI's follow recovery is event-driven and the host provider can
 * silently stop delivering events without erroring, leaving in-flight calls
 * orphaned with no follow that will ever re-establish on its own.
 *
 * Safe because every consumer re-calls useMainClient() per operation (so reads
 * transparently pick up the new client); the only long-lived main-client
 * subscription (the festival event watcher) re-follows via a registered reset
 * listener invoked here, after eviction.
 */
export function resetMainClient(): void {
  const client = clientCache.get(CHAIN_GENESIS_HASH)
  if (client) {
    try {
      client.destroy()
    } catch (e) {
      console.warn('[client] main client destroy threw:', e)
    }
    clientCache.delete(CHAIN_GENESIS_HASH)
  }
  // Eviction first, listeners second: a listener that calls useMainClient()
  // (e.g. the watcher's restart) must build the replacement, not reuse the
  // destroyed one.
  for (const cb of mainResetListeners) {
    try {
      cb()
    } catch (e) {
      console.warn('[client] main client reset listener threw:', e)
    }
  }
}

/**
 * Bulletin Chain PAPI client.
 * Host mode: routed via createPapiProvider on the bulletin genesis hash.
 * Standalone mode: direct WebSocket to BULLETIN_RPC.
 */
export function useBulletinClient() {
  if (!bulletinClientInstance) {
    const provider = isInHost()
      ? createPapiProvider(BULLETIN_GENESIS_HASH)
      : getWsProvider(BULLETIN_RPC)
    bulletinClientInstance = createClient(provider)
  }
  return {
    client: bulletinClientInstance,
    api: bulletinClientInstance.getTypedApi(bulletinDescriptor),
  }
}
