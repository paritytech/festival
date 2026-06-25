/**
 * Deploy Multicall3 contract via pallet-revive using a Substrate (sr25519) signer.
 *
 * Multicall3 is a stateless, permissionless utility contract. No constructor args,
 * no owner, no admin. Once deployed it works forever.
 *
 * Usage (DEPLOYER_SEED may also come from .env):
 *   DEPLOYER_SEED="your twelve word mnemonic ..." npx tsx scripts/deploy-multicall.ts
 *
 * Network selection (either form works; --env takes precedence):
 *   NETWORK=paseo|paseo-next-v2|previewnet
 *   --env paseo|paseo-next-v2|previewnet
 *   See packages/shared/host/networks.ts.
 *
 * Prerequisites:
 *   - `cd contracts && forge build` (Multicall3 bytecode in contracts/out/)
 *   - Deployer account funded with the active network's native token
 */

import dotenv from 'dotenv'
dotenv.config()
dotenv.config({ path: 'contracts/.env' })
import { createClient, Binary } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { type PolkadotSigner } from 'polkadot-api/signer'
import { ss58ToH160 } from '@parity/product-sdk-address'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getNetworkConfig } from '../lib/network'
import { parseEnvFlag, upsertEnvFile } from '../lib/env-files'
import { GAS_MULTIPLIER, dryRunDeposit, createSigner, deriveH160 } from '../lib/revive'

// CLI `--env <key>` overrides the NETWORK env var. Must run before
// getNetworkConfig() resolves and caches the active network.
const cliEnv = parseEnvFlag(process.argv)
if (cliEnv) process.env.NETWORK = cliEnv

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONTRACTS_OUT = resolve(__dirname, '../../contracts/out')
const network = getNetworkConfig()
const WS_URL = network.mainChain.wsUrl
// Computed after the --env override above resolves the active network.
const DRY_RUN_DEPOSIT = dryRunDeposit(network.nativeToken.decimals)

/**
 * Deploy Multicall3 and return its address. The caller owns the client, account
 * mapping, and env-file writes.
 */
export async function deployMulticall(opts: {
  api: any
  signer: PolkadotSigner
  ss58: string
}): Promise<`0x${string}`> {
  const { api, signer, ss58 } = opts

  // Multicall3 has no constructor args.
  const artifactPath = resolve(CONTRACTS_OUT, 'Multicall3.sol/Multicall3.json')
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  const bytecode = artifact.bytecode.object as `0x${string}`

  console.log('Deploying Multicall3...')

  const dryRun = await api.apis.ReviveApi.instantiate(
    ss58,
    0n,
    undefined,
    DRY_RUN_DEPOSIT,
    { type: 'Upload', value: Binary.fromHex(bytecode) },
    Binary.fromHex('0x'),
    undefined,
  )

  if (!dryRun.result.success) {
    const errInfo = JSON.stringify(dryRun.result.value, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    throw new Error(`Multicall3 dry-run failed: ${errInfo}`)
  }

  if (dryRun.result.value.result?.flags & 1) {
    throw new Error('Multicall3 constructor reverted in dry-run')
  }

  const gasLimit = {
    ref_time: dryRun.weight_required.ref_time * GAS_MULTIPLIER,
    proof_size: dryRun.weight_required.proof_size * GAS_MULTIPLIER,
  }
  const storageDeposit = dryRun.storage_deposit
  const storageDepositLimit =
    storageDeposit.type === 'Charge' && storageDeposit.value > 0n
      ? storageDeposit.value * GAS_MULTIPLIER
      : DRY_RUN_DEPOSIT

  console.log(`  Gas: ref_time=${gasLimit.ref_time}, proof_size=${gasLimit.proof_size}`)
  console.log(`  Storage deposit: ${storageDepositLimit}`)

  const tx = api.tx.Revive.instantiate_with_code({
    value: 0n,
    weight_limit: gasLimit,
    storage_deposit_limit: storageDepositLimit,
    code: Binary.fromHex(bytecode),
    data: Binary.fromHex('0x'),
    salt: undefined,
  })

  const result = await tx.signAndSubmit(signer)

  if (!result.ok) {
    const errInfo = JSON.stringify(result.dispatchError, (_k: string, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    throw new Error(`Multicall3 deployment failed: ${errInfo}`)
  }

  let contractAddress: `0x${string}` | undefined
  for (const event of result.events) {
    if (event.type === 'Revive' && (event.value as any)?.type === 'Instantiated') {
      const raw = (event.value as any).value?.contract
      if (raw) {
        contractAddress = typeof raw === 'string'
          ? raw as `0x${string}`
          : typeof raw.asHex === 'function'
            ? raw.asHex() as `0x${string}`
            : ('0x' + Buffer.from(raw).toString('hex')) as `0x${string}`
        break
      }
    }
  }

  if (!contractAddress) {
    const predicted = dryRun.result.value.account_id
    contractAddress = typeof predicted === 'string'
      ? predicted as `0x${string}`
      : typeof predicted?.asHex === 'function'
        ? predicted.asHex() as `0x${string}`
        : undefined

    if (!contractAddress) {
      throw new Error('Could not determine Multicall3 address from events or dry-run')
    }
  }

  console.log(`\n=== Multicall3 Deployed ===`)
  console.log(`Address: ${contractAddress}`)

  return contractAddress
}

async function main() {
  console.log('Multicall3 Deployment — Substrate Signer (pallet-revive)\n')

  const { signer, publicKey, ss58 } = createSigner()
  const h160 = deriveH160(publicKey)
  console.log(`Deployer SS58:  ${ss58}`)
  console.log(`Deployer H160:  ${h160}\n`)

  console.log(`Network:        ${network.displayName} (${network.nativeToken.symbol})`)
  console.log(`Connecting to ${WS_URL}...`)
  const client = createClient(getWsProvider(WS_URL))
  const api = client.getUnsafeApi()

  // Mapped = pallet-revive OriginalAccount entry for the derived H160
  // (ss58ToH160 matches AccountId32Mapper). Was inkSdk.addressIsMapped.
  const isMapped = (await api.query.Revive.OriginalAccount.getValue(ss58ToH160(ss58))) != null
  if (!isMapped) {
    console.log('Mapping Substrate account to H160...')
    await api.tx.Revive.map_account().signAndSubmit(signer)
    console.log('  Account mapped.\n')
  } else {
    console.log('Account already mapped.\n')
  }

  const contractAddress = await deployMulticall({ api, signer, ss58 })

  // Auto-write into both SPA env files for this network.
  const updates = {
    VITE_NETWORK: network.key,
    VITE_MULTICALL_ADDRESS: contractAddress,
  }
  console.log(`\nWriting addresses to:`)
  for (const spa of ['admin', 'attendee'] as const) {
    const target = upsertEnvFile(spa, network.key, updates)
    console.log(`  ${target}`)
  }
  console.log(`\nVITE_MULTICALL_ADDRESS=${contractAddress}`)

  client.destroy()
}

// Run as a CLI only when invoked directly; importing must not deploy.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('\nDeployment failed:', err.message || err)
    process.exit(1)
  })
}
