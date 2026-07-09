/**
 * Configuration model for the guided deploy.
 *
 * `deploy.config.json` holds non-secret choices (network, domains, custom
 * block). Secrets (DEPLOYER_SEED, DOTNS_MNEMONIC) live only in `.env`.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers'
import { getPolkadotSigner, type PolkadotSigner } from 'polkadot-api/signer'
import { AccountId } from '@polkadot-api/substrate-bindings'
import { resolveNetwork } from '../../packages/shared/host/networks'
import {
  CUSTOM_NETWORK_KEY,
  buildCustomNetworkConfig,
  type CustomNetworkInput,
  type NetworkConfig,
} from './network'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '..', '..')
export const CONFIG_PATH = resolve(REPO_ROOT, 'deploy.config.json')

export const BUILT_IN_NETWORKS = ['paseo-next-v2'] as const

export interface DeployConfig {
  /** 'paseo-next-v2' | 'custom' */
  network: string
  sessionsEnabled: boolean
  /** DotNS domains each SPA publishes to (with the `.dot` suffix). */
  domains: { admin: string; attendee: string }
  /** Present only when network === 'custom'. */
  custom: CustomNetworkInput | null
}

export const DEFAULT_CONFIG: DeployConfig = {
  network: 'paseo-next-v2',
  sessionsEnabled: true,
  domains: { admin: '', attendee: '' },
  custom: null,
}

/** Load deploy.config.json, or null if it doesn't exist yet. */
export function loadConfig(path: string = CONFIG_PATH): DeployConfig | null {
  if (!existsSync(path)) return null
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return {
    network: raw.network ?? DEFAULT_CONFIG.network,
    sessionsEnabled: raw.sessionsEnabled ?? DEFAULT_CONFIG.sessionsEnabled,
    domains: {
      admin: raw.domains?.admin ?? '',
      attendee: raw.domains?.attendee ?? '',
    },
    custom: raw.custom ?? null,
  }
}

/** Persist deploy.config.json (pretty-printed, trailing newline). */
export function saveConfig(config: DeployConfig, path: string = CONFIG_PATH): string {
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
  return path
}

/** Strip the trailing ".dot" from a domain, returning the bare base label. */
export function domainLabel(domain: string): string {
  return domain.trim().replace(/\.dot$/i, '')
}

// ── Accounts ──

export interface Account {
  signer: PolkadotSigner
  publicKey: Uint8Array
  ss58: string
}

/** Derive an sr25519 account (signer + SS58) from a 12/24-word mnemonic. */
export function accountFromSeed(seed: string): Account {
  const miniSecret = entropyToMiniSecret(mnemonicToEntropy(seed.trim()))
  const derive = sr25519CreateDerive(miniSecret)
  const keyPair = derive('')
  return {
    signer: getPolkadotSigner(keyPair.publicKey, 'Sr25519', keyPair.sign),
    publicKey: keyPair.publicKey,
    ss58: AccountId(42).dec(keyPair.publicKey),
  }
}

export interface Secrets {
  deployerSeed: string | undefined
  /** Publisher mnemonic for the DotNS publish; falls back to the deployer seed. */
  publisherSeed: string | undefined
}

/** Read deploy/publish seeds from the environment (.env already loaded). */
export function readSecrets(): Secrets {
  const deployerSeed = process.env.DEPLOYER_SEED?.trim() || undefined
  const publisherSeed =
    process.env.DOTNS_MNEMONIC?.trim() || deployerSeed
  return { deployerSeed, publisherSeed }
}

// ── Network resolution ──

/** Build the effective NetworkConfig for a DeployConfig (built-in or custom). */
export function resolveNetworkConfig(config: DeployConfig): NetworkConfig {
  if (config.network === CUSTOM_NETWORK_KEY) {
    if (!config.custom) {
      throw new Error('network is "custom" but deploy.config.json has no `custom` block')
    }
    return buildCustomNetworkConfig(config.custom)
  }
  // resolveNetwork() throws on unknown keys → misconfig fails loudly here.
  return resolveNetwork(config.network, {
    mainGenesisHash: process.env.VITE_CHAIN_GENESIS_HASH,
    bulletinGenesisHash: process.env.VITE_BULLETIN_GENESIS_HASH,
  })
}

/**
 * Export the network selection to process.env so the deploy modules'
 * getNetworkConfig() resolves the same network. Call before importing them.
 */
export function applyNetworkEnv(config: DeployConfig): void {
  process.env.NETWORK = config.network
  if (config.network === CUSTOM_NETWORK_KEY && config.custom) {
    const cu = config.custom
    process.env.CUSTOM_MAIN_WS = cu.mainWsUrl
    if (cu.mainGenesisHash) process.env.CUSTOM_MAIN_GENESIS = cu.mainGenesisHash
    if (cu.bulletinWsUrl) process.env.CUSTOM_BULLETIN_WS = cu.bulletinWsUrl
    if (cu.bulletinGenesisHash) process.env.CUSTOM_BULLETIN_GENESIS = cu.bulletinGenesisHash
    if (cu.ipfsGateway) process.env.CUSTOM_IPFS_GATEWAY = cu.ipfsGateway
    if (cu.nativeSymbol) process.env.CUSTOM_NATIVE_SYMBOL = cu.nativeSymbol
    if (cu.nativeDecimals !== undefined) {
      process.env.CUSTOM_NATIVE_DECIMALS = String(cu.nativeDecimals)
    }
    if (cu.displayName) process.env.CUSTOM_DISPLAY_NAME = cu.displayName
  }
}
