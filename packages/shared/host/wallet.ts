import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createAccountsProvider,
  hostApi,
  injectSpektrExtension,
} from '@novasamatech/host-api-wrapper'
import { enumValue } from '@novasamatech/host-api'
import type { PolkadotSigner } from 'polkadot-api/signer'
import { getInjectedExtensions, connectInjectedExtension } from 'polkadot-api/pjs-signer'
import { AccountId } from '@polkadot-api/substrate-bindings'
import { isInHost } from './detect'
import { DOTNS_ID } from './constants'
import { shortenAddress } from '../utils/address'
import { createStandaloneTxSigner } from './standalone-tx-signer'

// AutoSigning may be unavailable host-side. Returns NotAvailable, accepted
// as non-error. Picked up automatically once the host supports it.
const REQUIRED_RESOURCES = [
  { key: 'BulletinAllowance', request: enumValue('BulletinAllowance', undefined) },
  { key: 'SmartContractAllowance:0', request: enumValue('SmartContractAllowance', 0) },
  { key: 'AutoSigning', request: enumValue('AutoSigning', undefined) },
] as const

// AccountId codec: dec converts Uint8Array → SS58 string (prefix 42 = generic substrate)
const accountIdCodec = AccountId(42)
const toSs58 = (publicKey: Uint8Array): string => accountIdCodec[1](publicKey)
const fromSs58 = (address: string): Uint8Array => accountIdCodec[0](address)

const DAPP_NAME = 'festival-app'

const CONNECT_TIMEOUT_MS = 15_000
// Allocation modal is user-interactive. Needs read + click time.
const ALLOC_TIMEOUT_MS = 120_000

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[Wallet] ${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

export interface WalletAccount {
  address: string
  name: string
  publicKey: Uint8Array
  polkadotSigner: PolkadotSigner
}

export const useWalletStore = defineStore('wallet', () => {
  const accounts = ref<WalletAccount[]>([])
  const selectedAccount = ref<WalletAccount | null>(null)
  const isReady = ref(false)
  const isInitializing = ref(true)
  const isClaimingAllowances = ref(false)
  /** Name of the connected standalone extension, used for signRaw */
  const _connectedExtensionName = ref<string | null>(null)

  const isConnected = computed(() => !!selectedAccount.value)

  const address = computed(() => selectedAccount.value?.address || '')

  const accountName = computed(() => selectedAccount.value?.name || '')

  const truncatedAddress = computed(() => {
    if (!address.value) return ''
    return shortenAddress(address.value)
  })

  /**
   * Host-mode initialization via the host SDK.
   * Uses the product account derived from DOTNS_ID. Each user gets a stable
   * sub-account scoped to this product, distinct from their main wallet
   * accounts. Per-account allowances on the bulletin chain key off this
   * address.
   */
  async function initHost() {
    const accountsProvider = createAccountsProvider()

    const success = await injectSpektrExtension()
    if (!success) {
      console.error('[Wallet] injectSpektrExtension returned false')
      return
    }

    const result = await withTimeout(
      accountsProvider.getProductAccount(DOTNS_ID),
      CONNECT_TIMEOUT_MS,
      'getProductAccount',
    )

    result.match(
      (rawAccount) => {
        const polkadotSigner = accountsProvider.getProductAccountSigner(rawAccount)
        const wallet: WalletAccount = {
          address: toSs58(rawAccount.publicKey),
          name: DOTNS_ID,
          publicKey: rawAccount.publicKey,
          polkadotSigner,
        }

        accounts.value = [wallet]
        selectedAccount.value = wallet
        isReady.value = true
        console.log('[Wallet] Host connected, product account:', wallet.address)
      },
      (err) => {
        console.error('[Wallet] getProductAccount error:', err)
      },
    )
  }

  /** Standalone-mode initialization via browser extension (Talisman, PJS, etc.). */
  async function initStandalone() {
    // DEV-only override: if VITE_DEV_SEED is set, derive a signer from the seed
    // directly and bypass browser extensions. Use this when wallet extensions
    // can't sign for the active chain (e.g. PJS rejects unknown signed
    // extensions like AsPgas, or Talisman can't sync custom-network metadata).
    // Never set VITE_DEV_SEED in production.
    const devSeed = (import.meta as any).env?.VITE_DEV_SEED as string | undefined
    if (devSeed) {
      const [{ sr25519CreateDerive }, { entropyToMiniSecret, mnemonicToEntropy }, { getPolkadotSigner }] =
        await Promise.all([
          import('@polkadot-labs/hdkd'),
          import('@polkadot-labs/hdkd-helpers'),
          import('polkadot-api/signer'),
        ])

      const miniSecret = entropyToMiniSecret(mnemonicToEntropy(devSeed))
      const keyPair = sr25519CreateDerive(miniSecret)('')
      const signer = getPolkadotSigner(keyPair.publicKey, 'Sr25519', keyPair.sign)

      const account: WalletAccount = {
        address: toSs58(keyPair.publicKey),
        name: 'Dev Signer',
        publicKey: keyPair.publicKey,
        polkadotSigner: signer,
      }
      accounts.value = [account]
      selectedAccount.value = account
      isReady.value = true
      console.warn('[Wallet] DEV SIGNER active —', account.address, '(VITE_DEV_SEED set; do not use in production)')
      return
    }

    const extensionNames = getInjectedExtensions()
    if (extensionNames.length === 0) {
      console.warn('[Wallet] No browser extensions found')
      return
    }

    // Prefer talisman, then polkadot-js, then first available
    const preferred = ['talisman', 'polkadot-js']
    const extName = preferred.find(n => extensionNames.includes(n)) || extensionNames[0]!

    const ext = await connectInjectedExtension(extName)
    const rawAccounts = ext.getAccounts()

    if (rawAccounts.length === 0) {
      console.warn(`[Wallet] Extension "${extName}" returned no accounts`)
      return
    }

    const mapped: WalletAccount[] = rawAccounts.map((acc) => {
      const publicKey = fromSs58(acc.address)
      // Replace the PJS-adapter signer with our own. The adapter throws on
      // unknown signed-extensions (e.g. previewnet's AsPgas). See
      // `standalone-tx-signer.ts`.
      const polkadotSigner = createStandaloneTxSigner({
        extensionName: extName,
        dappName: DAPP_NAME,
        address: acc.address,
        publicKey,
        keypairType: acc.type,
      })
      return {
        address: acc.address,
        name: acc.name || 'Account',
        publicKey,
        polkadotSigner,
      }
    })

    accounts.value = mapped
    selectedAccount.value = mapped[0] || null
    _connectedExtensionName.value = extName
    isReady.value = true
  }

  // Re-entrant init. Account setup can fail transiently (host account
  // provisioning interrupted by backgrounding, getProductAccount timeout),
  // so callers (visibility handlers, check-in polls) retry by calling init()
  // again. Concurrent calls share the in-flight attempt; a connected wallet
  // makes it a no-op.
  let initPromise: Promise<void> | null = null

  function init(): Promise<void> {
    if (typeof window === 'undefined' || isConnected.value) return Promise.resolve()
    if (initPromise) return initPromise

    isInitializing.value = true
    initPromise = (async () => {
      try {
        if (isInHost()) {
          await initHost()
        } else {
          await initStandalone()
        }
      } catch (error) {
        console.error('[Wallet] Initialization error:', error)
      }
    })().finally(() => {
      isInitializing.value = false
      initPromise = null
    })
    return initPromise
  }

  function selectAccount(account: WalletAccount) {
    selectedAccount.value = account
  }

  /** Get a PolkadotSigner for the current account. */
  function getSigner(): PolkadotSigner {
    if (!selectedAccount.value) {
      throw new Error('No account selected')
    }
    return selectedAccount.value.polkadotSigner
  }

  /**
   * Sign a raw message (hex-encoded) via the signing bridge.
   * Host mode: uses injectedWeb3 via the host-injected extension.
   * Standalone mode: uses the connected browser extension.
   */
  async function signRaw(hexMessage: string): Promise<string> {
    if (!address.value) throw new Error('No account selected')

    const extensionName = isInHost()
      ? 'spektr'
      : _connectedExtensionName.value
    if (!extensionName) throw new Error('No extension connected')

    const entry = (window as any).injectedWeb3?.[extensionName]
    if (!entry) throw new Error(`Extension "${extensionName}" not available`)

    const ext = await entry.enable(DAPP_NAME)
    const result = await ext.signer.signRaw({
      address: address.value,
      data: hexMessage,
      type: 'bytes',
    })

    return typeof result === 'string' ? result : result.signature
  }

  // Always fires the full REQUIRED_RESOURCES set. Repeat calls scale an
  // already-granted resource (extra slot); the host is the source of truth
  // on what's actually granted. Returns the per-resource outcomes so callers
  // can detect partial allocations; `null` means the request errored.
  async function claimAllowances(): Promise<{
    outcomes: readonly { key: string; tag: string }[] | null
  }> {
    if (!isInHost()) {
      console.warn('[Wallet] claimAllowances called outside host mode — no-op')
      return { outcomes: null }
    }
    if (isClaimingAllowances.value) return { outcomes: null }

    isClaimingAllowances.value = true
    try {
      const allocResult = await withTimeout(
        hostApi.requestResourceAllocation(
          enumValue('v1', REQUIRED_RESOURCES.map((r) => r.request)),
        ),
        ALLOC_TIMEOUT_MS,
        'requestResourceAllocation',
      )
      let outcomes: readonly { key: string; tag: string }[] | null = null
      allocResult.match(
        (response) => {
          if (response.tag !== 'v1') {
            console.warn('[Wallet] Unexpected allocation response version:', response.tag)
            return
          }
          outcomes = response.value.map((outcome, i) => ({
            key: REQUIRED_RESOURCES[i]!.key,
            tag: outcome.tag,
          }))
          outcomes.forEach(({ key, tag }) => {
            console.log(`[Wallet] ${key}: ${tag}`)
          })
        },
        (err) => {
          const anyErr = err as { name?: string; message?: string; tag?: string; value?: unknown }
          console.error('[Wallet] requestResourceAllocation error', {
            name: anyErr?.name,
            message: anyErr?.message,
            tag: anyErr?.tag,
            value: anyErr?.value,
            raw: err,
          })
        },
      )
      return { outcomes }
    } finally {
      isClaimingAllowances.value = false
    }
  }

  // Initialize wallet. Always attempt; init() manages isInitializing.
  if (typeof window !== 'undefined') {
    void init()
  }

  return {
    accounts,
    selectedAccount,
    address,
    accountName,
    truncatedAddress,
    isConnected,
    isReady,
    isInitializing,
    isClaimingAllowances,
    init,
    selectAccount,
    getSigner,
    signRaw,
    claimAllowances,
  }
})
