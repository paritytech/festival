/**
 * Per-network chain configuration. The active network is picked at deploy time
 * via VITE_NETWORK (browser) or NETWORK (Node scripts); resolveNetwork() throws
 * on unknown keys so a misconfigured deploy fails at boot.
 */

export type NetworkKey = "paseo-next-v2" | "previewnet";

export const SUPPORTED_NETWORKS: NetworkKey[] = [
  "paseo-next-v2",
  "previewnet",
];
export const DEFAULT_NETWORK: NetworkKey = "paseo-next-v2";

export interface ChainEndpoint {
  /** WebSocket RPC URL for direct (standalone) connection. */
  wsUrl: string;
  /**
   * Genesis hash. Used as the cache key for PAPI clients in client.ts and as
   * the chain identifier passed to the host-sdk's createPapiProvider() in
   * host mode.
   *
   * Empty string means the genesis must be supplied at runtime via
   * VITE_CHAIN_GENESIS_HASH / VITE_BULLETIN_GENESIS_HASH (typically populated
   * by the sync-network script for unstable networks like previewnet that get
   * rebuilt frequently).
   */
  genesisHash: `0x${string}` | "";
  /**
   * PAPI descriptor entry name, keyed into `.papi/polkadot-api.json` and the
   * generated `host/descriptors/<networkKey>.ts` re-exports. Must be a valid JS
   * identifier. Optional: `gen-papi-config.ts` skips chains without one, so a
   * network can connect (genesis/endpoints) before its typed descriptor exists.
   * To add it, set this key and run `papi:update`.
   */
  descriptorKey?: string;
}

export interface NativeToken {
  symbol: string;
  decimals: number;
}

export interface NetworkConfig {
  key: NetworkKey;
  /** Human-readable label for diagnostics + UI surfaces. */
  displayName: string;
  isTestnet: boolean;
  /** Asset Hub-like main parachain. Pallet-revive contracts live here. */
  mainChain: ChainEndpoint;
  /**
   * Bulletin chain for off-chain metadata storage via TransactionStorage.
   * null if a network has none. Bulletin-dependent code must guard.
   */
  bulletinChain: ChainEndpoint | null;
  /** HTTP IPFS gateway used to resolve content addressed by Bulletin CIDs. */
  ipfsGateway: string;
  /** Native token of the main chain. Drives balance display + fee math. */
  nativeToken: NativeToken;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  "paseo-next-v2": {
    key: "paseo-next-v2",
    displayName: "Paseo Next V2",
    isTestnet: true,
    // Testnet endpoints + genesis hashes. This chain has been re-genesised at
    // least once (last refreshed 2026-06-01 via
    // `NETWORK=paseo-next-v2 npx tsx scripts/chain/sync-network.ts`); if the
    // host rejects this chain as unsupported, re-run the sync script and update
    // the hash below.
    mainChain: {
      wsUrl: "wss://paseo-asset-hub-next-rpc.polkadot.io",
      genesisHash:
        "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f",
      descriptorKey: "paseoNextAh",
    },
    bulletinChain: {
      wsUrl: "wss://paseo-bulletin-next-rpc.polkadot.io",
      genesisHash:
        "0x8cfe6717dc4becfda2e13c488a1e2061ff2dfee96e7d031157f72d36716c0a22",
      descriptorKey: "paseoNextBulletin",
    },
    ipfsGateway: "https://paseo-bulletin-next-ipfs.polkadot.io",
    nativeToken: { symbol: "PAS", decimals: 10 },
  },
  previewnet: {
    key: "previewnet",
    displayName: "Previewnet (substrate.dev)",
    isTestnet: true,
    // Genesis hashes intentionally empty. Previewnet is rebuilt frequently,
    // so any compile-time hash would go stale. Run the sync-network script (or
    // the CI step) to populate them via env vars.
    // descriptorKey intentionally omitted on both chains until previewnet's
    // metadata `.scale` is fetched + committed (needs a live previewnet endpoint).
    // To wire typed descriptors: set descriptorKey to "previewnetAh" /
    // "previewnetBulletin", run `npm run papi:update`, commit the new `.scale`.
    mainChain: {
      wsUrl: "wss://previewnet.substrate.dev/asset-hub",
      genesisHash:
        "0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb",
      descriptorKey: "previewnetAh",
    },
    bulletinChain: {
      wsUrl: "wss://previewnet.substrate.dev/bulletin",
      genesisHash:
        "0xf37fa1f1450ea120edbf64c3fc447f671a00e1f1095a698f42eeec073c7ee487",
      descriptorKey: "previewnetBulletin",
    },
    ipfsGateway: "https://previewnet.substrate.dev/ipfs/",
    nativeToken: { symbol: "PAS", decimals: 10 },
  },
};

export function parseNetworkKey(
  value: string | undefined | null,
): NetworkKey | null {
  if (!value) return null;
  return (SUPPORTED_NETWORKS as string[]).includes(value)
    ? (value as NetworkKey)
    : null;
}

export interface NetworkOverrides {
  /** Override the main chain's genesis hash (typically from VITE_CHAIN_GENESIS_HASH). */
  mainGenesisHash?: string;
  /** Override the bulletin chain's genesis hash (typically from VITE_BULLETIN_GENESIS_HASH). */
  bulletinGenesisHash?: string;
}

const GENESIS_HASH_RE = /^0x[0-9a-f]{64}$/i;

function assertGenesisHashShape(
  value: string,
  label: string,
): `0x${string}` | "" {
  if (value === "" || GENESIS_HASH_RE.test(value))
    return value as `0x${string}` | "";
  const preview = value.length > 20 ? `${value.slice(0, 20)}…` : value;
  throw new Error(
    `Invalid ${label}: expected 0x + 64 hex chars, got "${preview}"`,
  );
}

/**
 * Apply per-field env overrides on top of a registry entry. Empty/undefined
 * overrides fall back to the registry value, so a network entry can ship with
 * stable hashes (paseo-next-v2) or empty placeholders (previewnet) and selectively
 * accept overrides. Throws on malformed hashes so a typo in env doesn't reach
 * PAPI as an opaque mid-boot error.
 */
function applyOverrides(
  network: NetworkConfig,
  overrides: NetworkOverrides,
): NetworkConfig {
  return {
    ...network,
    mainChain: {
      ...network.mainChain,
      genesisHash: assertGenesisHashShape(
        overrides.mainGenesisHash || network.mainChain.genesisHash,
        `${network.key} main chain genesis hash`,
      ),
    },
    bulletinChain: network.bulletinChain
      ? {
          ...network.bulletinChain,
          genesisHash: assertGenesisHashShape(
            overrides.bulletinGenesisHash || network.bulletinChain.genesisHash,
            `${network.key} bulletin chain genesis hash`,
          ),
        }
      : null,
  };
}

/**
 * Resolve a raw network key string to a NetworkConfig, applying any env-based
 * genesis-hash overrides on top.
 *
 * - Empty/undefined key → DEFAULT_NETWORK
 * - Unknown key → throws
 * - Genesis hashes left empty in the registry must be supplied via overrides;
 *   callers that need a fully-populated config should validate after this call
 *   (see constants.ts).
 */
export function resolveNetwork(
  key: string | undefined | null,
  overrides: NetworkOverrides = {},
): NetworkConfig {
  if (!key) return applyOverrides(NETWORKS[DEFAULT_NETWORK], overrides);
  const parsed = parseNetworkKey(key);
  if (!parsed) {
    throw new Error(
      `Unknown network "${key}". Valid values: ${SUPPORTED_NETWORKS.join(", ")}`,
    );
  }
  return applyOverrides(NETWORKS[parsed], overrides);
}
