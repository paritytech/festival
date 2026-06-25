/**
 * Deploy Festival contracts via pallet-revive using a Substrate (sr25519) signer.
 *
 * Deploys:
 *   1. AttendancePOAP  (festival-level)
 *   2. AttendancePOAP  (session-level)
 *   3. Festival
 *
 * Then wires:
 *   4. festivalPoap.authorizeMinter(festival)
 *   5. sessionPoap.transferFactory(festival)
 *
 * Usage (DEPLOYER_SEED may also come from .env):
 *   DEPLOYER_SEED="your twelve word mnemonic ..." npx tsx scripts/deploy-festival.ts
 *
 * Network selection (either form works; --env takes precedence):
 *   NETWORK=paseo|paseo-next-v2|previewnet
 *   --env paseo|paseo-next-v2|previewnet
 *   See packages/shared/host/networks.ts.
 *
 * Prerequisites:
 *   - `forge build` (contracts compiled. EVM bytecode in contracts/out/)
 *   - Deployer account funded with the active network's native token
 */

import dotenv from 'dotenv'
dotenv.config({ quiet: true })
dotenv.config({ path: 'contracts/.env', quiet: true })
import { createClient, Binary } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { type PolkadotSigner } from 'polkadot-api/signer'
import { ss58ToH160 } from '@parity/product-sdk-address'
import { encodeAbiParameters, encodeFunctionData } from 'viem'
import type { Abi, AbiParameter } from 'viem'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getNetworkConfig } from '../lib/network'
import { parseEnvFlag, upsertEnvFile } from '../lib/env-files'
import { GAS_MULTIPLIER, dryRunDeposit, createSigner, deriveH160 } from '../lib/revive'

// Re-exported so deploy/grant/import scripts can keep importing these from here.
export { GAS_MULTIPLIER, createSigner, deriveH160 }

// CLI `--env <key>` overrides the NETWORK env var. Must run before
// getNetworkConfig() resolves and caches the active network.
const cliEnv = parseEnvFlag(process.argv)
if (cliEnv) process.env.NETWORK = cliEnv

// ── Constants ──

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CONTRACTS_OUT = resolve(__dirname, '../../contracts/out')
const network = getNetworkConfig()
const WS_URL = network.mainChain.wsUrl
// Computed after the --env override above resolves the active network.
export const DRY_RUN_DEPOSIT = dryRunDeposit(network.nativeToken.decimals)

// ── Artifact loading ──

export interface Artifact {
  abi: Abi
  bytecodeHex: `0x${string}`
}

export function loadArtifact(contractName: string): Artifact {
  const path = resolve(CONTRACTS_OUT, `${contractName}.sol/${contractName}.json`)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return {
    abi: raw.abi,
    bytecodeHex: raw.bytecode.object as `0x${string}`,
  }
}

function encodeConstructorArgs(abi: Abi, args: unknown[]): `0x${string}` {
  const constructor = (abi as any[]).find((x: any) => x.type === 'constructor')
  if (!constructor || !constructor.inputs?.length) return '0x'
  return encodeAbiParameters(constructor.inputs as AbiParameter[], args)
}

// ── Deploy helper ──

export async function deployContract(
  contractName: string,
  constructorArgs: unknown[],
  api: any,
  signer: PolkadotSigner,
  origin: string,
): Promise<`0x${string}`> {
  const { abi, bytecodeHex } = loadArtifact(contractName)
  const constructorData = encodeConstructorArgs(abi, constructorArgs)

  // EVM bytecode: constructor args are appended to bytecode (data must be empty)
  const codeWithArgs = constructorData === '0x'
    ? bytecodeHex
    : (bytecodeHex + constructorData.slice(2)) as `0x${string}`

  console.error(`  Deploying ${contractName}...`)

  // Dry-run: estimate gas + predict address
  const dryRun = await api.apis.ReviveApi.instantiate(
    origin,
    0n,
    undefined,
    DRY_RUN_DEPOSIT,
    { type: 'Upload', value: Binary.fromHex(codeWithArgs) },
    Binary.fromHex('0x'),
    undefined,
  )

  if (!dryRun.result.success) {
    const errInfo = JSON.stringify(dryRun.result.value, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    throw new Error(`${contractName} dry-run failed: ${errInfo}`)
  }

  // Check constructor revert (bit 0 of flags)
  if (dryRun.result.value.result?.flags & 1) {
    throw new Error(`${contractName} constructor reverted in dry-run`)
  }

  const gasRequired = dryRun.weight_required
  const storageDeposit = dryRun.storage_deposit

  const gasLimit = {
    ref_time: gasRequired.ref_time * GAS_MULTIPLIER,
    proof_size: gasRequired.proof_size * GAS_MULTIPLIER,
  }
  const storageDepositLimit =
    storageDeposit.type === 'Charge' && storageDeposit.value > 0n
      ? storageDeposit.value * GAS_MULTIPLIER
      : DRY_RUN_DEPOSIT

  console.error(
    `    Gas: ref_time=${gasLimit.ref_time}, proof_size=${gasLimit.proof_size}`,
  )
  console.error(`    Storage deposit: ${storageDepositLimit}`)

  // pallet-revive metadata exposes the gas field as weight_limit (same as Revive.call).
  const tx = api.tx.Revive.instantiate_with_code({
    value: 0n,
    weight_limit: gasLimit,
    storage_deposit_limit: storageDepositLimit,
    code: Binary.fromHex(codeWithArgs),
    data: Binary.fromHex('0x'),
    salt: undefined,
  })

  const result = await tx.signAndSubmit(signer)

  if (!result.ok) {
    const errInfo = JSON.stringify(result.dispatchError, (_k: string, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    throw new Error(`${contractName} deployment failed: ${errInfo}`)
  }

  // Extract address from Instantiated event
  let contractAddress: `0x${string}` | undefined
  for (const event of result.events) {
    if (event.type === 'Revive' && (event.value as any)?.type === 'Instantiated') {
      const raw = (event.value as any).value?.contract
      if (raw) {
        // raw may be Binary, hex string, or Uint8Array
        contractAddress = typeof raw === 'string'
          ? raw as `0x${string}`
          : typeof raw.asHex === 'function'
            ? raw.asHex() as `0x${string}`
            : ('0x' + Buffer.from(raw).toString('hex')) as `0x${string}`
        break
      }
    }
  }

  // Fallback: use dry-run predicted address
  if (!contractAddress) {
    const predicted = dryRun.result.value.account_id
    contractAddress = typeof predicted === 'string'
      ? predicted as `0x${string}`
      : typeof predicted?.asHex === 'function'
        ? predicted.asHex() as `0x${string}`
        : undefined

    if (!contractAddress) {
      throw new Error(`${contractName}: could not determine deployed address from events or dry-run`)
    }
    console.error(`    Deployed (from dry-run): ${contractAddress}`)
  } else {
    console.error(`    Deployed at: ${contractAddress}`)
  }

  return contractAddress
}

// ── Contract call helper ──

export async function callContract(
  contractAddress: `0x${string}`,
  contractName: string,
  functionName: string,
  args: unknown[],
  api: any,
  signer: PolkadotSigner,
  origin: string,
): Promise<{ txHash: `0x${string}`; events: unknown[] }> {
  const { abi } = loadArtifact(contractName)
  const calldata = encodeFunctionData({ abi, functionName, args })

  console.error(`  Calling ${contractName}.${functionName}()...`)

  // Dry-run for gas estimation
  let weightLimit, storageDepositLimit
  try {
    const dryRun = await api.apis.ReviveApi.call(
      origin,
      contractAddress.toLowerCase(),
      0n,
      undefined,
      DRY_RUN_DEPOSIT,
      Binary.fromHex(calldata),
    )

    if (dryRun.result.success && !(dryRun.result.value.flags & 1)) {
      weightLimit = {
        ref_time: dryRun.weight_required.ref_time * GAS_MULTIPLIER,
        proof_size: dryRun.weight_required.proof_size * GAS_MULTIPLIER,
      }
      storageDepositLimit =
        dryRun.storage_deposit.type === 'Charge' && dryRun.storage_deposit.value > 0n
          ? dryRun.storage_deposit.value * GAS_MULTIPLIER
          : DRY_RUN_DEPOSIT
    }
  } catch (err) {
    console.warn(`    Dry-run failed, using defaults:`, err)
  }

  if (!weightLimit) {
    weightLimit = { ref_time: 500_000_000_000n, proof_size: 500_000n }
    storageDepositLimit = DRY_RUN_DEPOSIT
  }

  const tx = api.tx.Revive.call({
    dest: contractAddress.toLowerCase(),
    value: 0n,
    weight_limit: weightLimit,
    storage_deposit_limit: storageDepositLimit!,
    data: Binary.fromHex(calldata),
  })

  const result = await tx.signAndSubmit(signer)

  if (!result.ok) {
    const errInfo = JSON.stringify(result.dispatchError, (_k: string, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    throw new Error(`${contractName}.${functionName}() failed: ${errInfo}`)
  }

  console.error(`    OK (tx: ${result.txHash})`)
  return { txHash: result.txHash as `0x${string}`, events: result.events ?? [] }
}

// ── deployFestivalContracts ──

/**
 * Deploy the POAP/Festival contract trio, wire them up, and pre-register the
 * FestivalSession bytecode. Returns the resulting addresses. Exposed as a
 * library function so the e2e seed orchestrator can reuse the exact flow.
 */
export async function deployFestivalContracts(opts: {
  api: any
  signer: PolkadotSigner
  ss58: string
  h160: `0x${string}`
}): Promise<{
  festivalAddr: `0x${string}`
  festivalPoapAddr: `0x${string}`
  sessionPoapAddr: `0x${string}`
  sessionTemplateAddr: `0x${string}`
}> {
  const { api, signer, ss58, h160 } = opts

  console.error('=== Deploying Contracts ===\n')

  const festivalPoapAddr = await deployContract(
    'AttendancePOAP',
    [h160],
    api, signer, ss58,
  )

  const sessionPoapAddr = await deployContract(
    'AttendancePOAP',
    [h160],
    api, signer, ss58,
  )

  const festivalAddr = await deployContract(
    'Festival',
    [h160, festivalPoapAddr, sessionPoapAddr, true],
    api, signer, ss58,
  )

  console.error('\n=== Wiring Contracts ===\n')

  await callContract(
    festivalPoapAddr,
    'AttendancePOAP',
    'authorizeMinter',
    [festivalAddr],
    api, signer, ss58,
  )

  await callContract(
    sessionPoapAddr,
    'AttendancePOAP',
    'transferFactory',
    [festivalAddr],
    api, signer, ss58,
  )

  // Pre-register FestivalSession bytecode (see comment in main()).
  console.error('\n=== Pre-registering FestivalSession bytecode ===\n')
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const sessionTemplateAddr = await deployContract(
    'FestivalSession',
    [
      h160,
      sessionPoapAddr,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      nowSec,
      nowSec + 5n * 24n * 3600n,
      festivalAddr,
      festivalPoapAddr,
    ],
    api, signer, ss58,
  )
  console.error(`    Orphan instance (code-registration only): ${sessionTemplateAddr}`)

  return { festivalAddr, festivalPoapAddr, sessionPoapAddr, sessionTemplateAddr }
}

// ── Main ──

async function main() {
  console.error('Festival Deployment — Substrate Signer (pallet-revive)\n')

  const { signer, publicKey, ss58 } = createSigner()
  const h160 = deriveH160(publicKey)
  console.error(`Deployer SS58:  ${ss58}`)
  console.error(`Deployer H160:  ${h160}\n`)

  console.error(`Network:        ${network.displayName} (${network.nativeToken.symbol})`)
  console.error(`Connecting to ${WS_URL}...`)
  const client = createClient(getWsProvider(WS_URL))
  const api = client.getUnsafeApi()

  // Map account if needed (required for pallet-revive interaction).
  // Mapped = pallet-revive OriginalAccount entry for the derived H160
  // (ss58ToH160 matches AccountId32Mapper). Was inkSdk.addressIsMapped.
  const isMapped = (await api.query.Revive.OriginalAccount.getValue(ss58ToH160(ss58))) != null
  if (!isMapped) {
    console.error('Mapping Substrate account to H160...')
    await api.tx.Revive.map_account().signAndSubmit(signer)
    console.error('  Account mapped.\n')
  } else {
    console.error('Account already mapped.\n')
  }

  // Deploy + wire + pre-register session bytecode. Pre-registration is needed
  // because pallet-revive on previewnet does not auto-upload child contract code
  // on the CREATE opcode the way standard EVM does. The first
  // `Festival.createSession()` would otherwise revert with empty data; deploying
  // one orphan FestivalSession uploads the code hash so every subsequent
  // `createSession` works.
  const { festivalAddr, festivalPoapAddr, sessionPoapAddr } =
    await deployFestivalContracts({ api, signer, ss58, h160 })

  console.error('\n=== Deployment Complete ===\n')
  console.error(`Festival POAP:    ${festivalPoapAddr}`)
  console.error(`Session POAP:     ${sessionPoapAddr}`)
  console.error(`Festival:         ${festivalAddr}`)

  // Auto-write into both SPA env files for this network.
  const updates = {
    VITE_NETWORK: network.key,
    VITE_FESTIVAL_ADDRESS: festivalAddr,
    VITE_FESTIVAL_POAP_ADDRESS: festivalPoapAddr,
    VITE_SUB_EVENT_POAP_ADDRESS: sessionPoapAddr,
  }
  console.error('\nWriting addresses to:')
  for (const spa of ['admin', 'attendee'] as const) {
    const target = upsertEnvFile(spa, network.key, updates)
    console.error(`  ${target}`)
  }

  console.error('\nKeys written:')
  console.error(`VITE_FESTIVAL_ADDRESS=${festivalAddr}`)
  console.error(`VITE_FESTIVAL_POAP_ADDRESS=${festivalPoapAddr}`)
  console.error(`VITE_SUB_EVENT_POAP_ADDRESS=${sessionPoapAddr}`)

  client.destroy()
}

// Only run as a CLI when invoked directly. Importing this module from the
// e2e seed orchestrator must not trigger the deployment side-effect.
if (process.argv[1] && process.argv[1] === __filename) {
  main().catch((err) => {
    console.error('\nDeployment failed:', err.message || err)
    process.exit(1)
  })
}
