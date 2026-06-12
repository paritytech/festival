/**
 * Smoke-test a deployed Multicall3 against a revive ETH-RPC.
 *
 * Targets the parts of Multicall3 that pallet-revive's EVM translation could
 * plausibly mishandle: the inline-assembly revert paths, value accounting, and
 * the block-introspection getters (split into MUST_PASS / MAY_REVERT).
 *
 * Does NOT exercise: actual value transfer through aggregate3Value (would require a
 * funded sender or value-bearing eth_call, which is environment-dependent on revive),
 * tryAggregate / blockAndAggregate / tryBlockAndAggregate (same `target.call()` pattern
 * as the tested variants. No new revive-translation surface).
 *
 * Uses eth_call only. No on-chain state changes, no gas paid, no signer needed.
 * Dev tooling, not CI-grade: no retry/timeout handling for flaky public RPCs.
 *
 * Env (resolved from process env, then contracts/.env, then .github/env.paseo-next-v2. First wins):
 *   VITE_MULTICALL_ADDRESS  required. H160 of a deployed Multicall3
 *                           (the canonical value is committed in .github/env.paseo-next-v2, so by
 *                            default the script just works without any local config)
 *   ETH_RPC_URL             defaults to https://eth-rpc-testnet.polkadot.io/
 */

import dotenv from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Precedence (first wins): process env, then <cwd>/.env, then contracts/.env,
// then .github/env.paseo-next-v2 (where the committed VITE_MULTICALL_ADDRESS lives).
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config()
dotenv.config({ path: resolve(__dirname, '..', '..', 'contracts/.env') })
dotenv.config({ path: resolve(__dirname, '..', '..', '.github/env.paseo-next-v2') })

import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'

const VITE_MULTICALL_ADDRESS = process.env.VITE_MULTICALL_ADDRESS as Address | undefined
const DEFAULT_ETH_RPC_URL = 'https://eth-rpc-testnet.polkadot.io/'
const EXPECTED_CHAIN_ID_FOR_DEFAULT_RPC = 420420417  // Polkadot Hub TestNet (Paseo Asset Hub)
const ETH_RPC_URL = process.env.ETH_RPC_URL || DEFAULT_ETH_RPC_URL

if (!VITE_MULTICALL_ADDRESS) {
  console.error('VITE_MULTICALL_ADDRESS not set.')
  console.error('Expected to be loaded from .github/env.paseo-next-v2 automatically. Either:')
  console.error('  - check the value is present in .github/env.paseo-next-v2 (or contracts/.env), or')
  console.error('  - run via Make with a command-line override: make test-revive VITE_MULTICALL_ADDRESS=0x..., or')
  console.error('  - deploy a fresh instance with `npx tsx scripts/deploy-multicall.ts`.')
  process.exit(1)
}

const ABI = parseAbi([
  'function aggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
  'function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
  'function getBlockNumber() view returns (uint256)',
  'function getCurrentBlockTimestamp() view returns (uint256)',
  'function getCurrentBlockCoinbase() view returns (address)',
  'function getCurrentBlockDifficulty() view returns (uint256)',
  'function getCurrentBlockGasLimit() view returns (uint256)',
  'function getEthBalance(address addr) view returns (uint256)',
  'function getBasefee() view returns (uint256)',
  'function getLastBlockHash() view returns (bytes32)',
  'function getBlockHash(uint256 blockNumber) view returns (bytes32)',
  'function getChainId() view returns (uint256)',
])

const GET_BLOCK_NUMBER = encodeFunctionData({ abi: ABI, functionName: 'getBlockNumber' })
const BAD_SELECTOR: Hex = '0xdeadbeef'

let pass = 0
let fail = 0

function ok(name: string, detail = '') {
  console.log(`  PASS  ${name}${detail ? '  — ' + detail : ''}`)
  pass++
}

function bad(name: string, why: string) {
  console.log(`  FAIL  ${name}  — ${why}`)
  fail++
}

function info(name: string, detail: string) {
  console.log(`  INFO  ${name}  — ${detail}`)
}

async function expectOk<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await fn()
    return result
  } catch (err: any) {
    bad(name, `unexpected revert: ${err?.shortMessage ?? err?.message ?? String(err)}`)
    return undefined
  }
}

async function expectRevert(name: string, fn: () => Promise<unknown>, match: RegExp): Promise<void> {
  try {
    const result = await fn()
    bad(name, `expected revert, got ${JSON.stringify(result, (_k, v) => typeof v === 'bigint' ? v.toString() : v)}`)
  } catch (err: any) {
    const msg = err?.shortMessage ?? err?.message ?? String(err)
    if (!match.test(msg)) {
      bad(name, `reverted but message did not match ${match}: ${msg}`)
      return
    }
    ok(name)
  }
}

type Client = ReturnType<typeof createPublicClient>

async function readRaw(client: Client, data: Hex): Promise<Hex> {
  const { data: ret } = await client.call({ to: VITE_MULTICALL_ADDRESS!, data })
  return (ret ?? '0x') as Hex
}

async function main() {
  console.log(`Multicall3 smoke test`)
  console.log(`  RPC:      ${ETH_RPC_URL}`)
  console.log(`  Address:  ${VITE_MULTICALL_ADDRESS}`)

  const client = createPublicClient({ transport: http(ETH_RPC_URL) })

  // Surface chain ID up-front; assert it on the default RPC so a misconfigured
  // testnet doesn't produce a green run against the wrong chain. Normalise trailing
  // slash so `https://...polkadot.io` and `https://...polkadot.io/` both match.
  const chainId = await client.getChainId()
  console.log(`  Chain ID: ${chainId}\n`)
  const stripSlash = (u: string) => u.replace(/\/$/, '')
  if (stripSlash(ETH_RPC_URL) === stripSlash(DEFAULT_ETH_RPC_URL) && chainId !== EXPECTED_CHAIN_ID_FOR_DEFAULT_RPC) {
    console.error(
      `Default RPC returned chain ID ${chainId}, expected ${EXPECTED_CHAIN_ID_FOR_DEFAULT_RPC}. ` +
        'Aborting before tests run against the wrong chain.',
    )
    process.exit(1)
  }

  // ── aggregate3 (assembly paths) ──

  console.log('aggregate3')

  {
    const name = 'happy path returns success=true with non-empty returnData'
    const result = await expectOk(name, async () => {
      const data = encodeFunctionData({
        abi: ABI,
        functionName: 'aggregate3',
        args: [[{ target: VITE_MULTICALL_ADDRESS!, allowFailure: false, callData: GET_BLOCK_NUMBER }]],
      })
      const ret = await readRaw(client, data)
      return decodeFunctionResult({ abi: ABI, functionName: 'aggregate3', data: ret })
    })
    if (result) {
      const [first] = result as { success: boolean; returnData: Hex }[]
      if (!first.success) {
        bad(name, 'inner call reported success=false')
      } else {
        const decoded = decodeFunctionResult({ abi: ABI, functionName: 'getBlockNumber', data: first.returnData })
        // Cross-check against eth_blockNumber: catches "returns zero/stale value". Allow ±5
        // blocks of drift since the two RPC calls are not atomic.
        const head = await client.getBlockNumber()
        if (decoded <= 0n) bad(name, `expected positive block number, got ${decoded}`)
        else if (decoded < head - 5n || decoded > head + 5n) {
          bad(name, `aggregate3-decoded block ${decoded} differs from eth_blockNumber ${head} by more than 5`)
        } else ok(name, `blockNumber=${decoded} (eth_blockNumber=${head})`)
      }
    }
  }

  await expectRevert(
    'failing call, allowFailure=false reverts with "Multicall3: call failed"',
    async () => {
      const data = encodeFunctionData({
        abi: ABI,
        functionName: 'aggregate3',
        args: [[{ target: VITE_MULTICALL_ADDRESS!, allowFailure: false, callData: BAD_SELECTOR }]],
      })
      return readRaw(client, data)
    },
    /Multicall3: call failed/,
  )

  {
    const name = 'failing call, allowFailure=true returns success=false'
    const result = await expectOk(name, async () => {
      const data = encodeFunctionData({
        abi: ABI,
        functionName: 'aggregate3',
        args: [[{ target: VITE_MULTICALL_ADDRESS!, allowFailure: true, callData: BAD_SELECTOR }]],
      })
      const ret = await readRaw(client, data)
      return decodeFunctionResult({ abi: ABI, functionName: 'aggregate3', data: ret })
    })
    if (result) {
      const [first] = result as { success: boolean }[]
      if (first.success) bad(name, 'success was true')
      else ok(name)
    }
  }

  // ── aggregate3Value (loop-body assembly + value accounting) ──

  console.log('\naggregate3Value')

  {
    const name = 'happy path with value=0 exercises loop-body assembly'
    const result = await expectOk(name, async () => {
      const data = encodeFunctionData({
        abi: ABI,
        functionName: 'aggregate3Value',
        args: [[{ target: VITE_MULTICALL_ADDRESS!, allowFailure: false, value: 0n, callData: GET_BLOCK_NUMBER }]],
      })
      const ret = await readRaw(client, data)
      return decodeFunctionResult({ abi: ABI, functionName: 'aggregate3Value', data: ret })
    })
    if (result) {
      const [first] = result as { success: boolean; returnData: Hex }[]
      if (!first.success) {
        bad(name, 'inner call reported success=false')
      } else {
        const decoded = decodeFunctionResult({ abi: ABI, functionName: 'getBlockNumber', data: first.returnData })
        if (typeof decoded !== 'bigint' || decoded <= 0n) bad(name, `expected positive block number, got ${decoded}`)
        else ok(name, `blockNumber=${decoded}`)
      }
    }
  }

  await expectRevert(
    'failing call, allowFailure=false reverts with "Multicall3: call failed"',
    async () => {
      const data = encodeFunctionData({
        abi: ABI,
        functionName: 'aggregate3Value',
        args: [[{ target: VITE_MULTICALL_ADDRESS!, allowFailure: false, value: 0n, callData: BAD_SELECTOR }]],
      })
      return readRaw(client, data)
    },
    /Multicall3: call failed/,
  )

  // value-mismatch: declare value=1 in the call entries (valAccumulator increments to 1)
  // but send msg.value=0 in eth_call. The inner call reverts on dispatch. GetBlockNumber
  // is non-payable, so any value transfer to it is rejected before any logic runs. With
  // allowFailure=true, the assembly revert is skipped, and we land on the trailing
  // require(msg.value == valAccumulator). BAD_SELECTOR would behave identically (revert
  // on missing selector); the choice doesn't matter.
  await expectRevert(
    'msg.value != sum(call.value) reverts with "Multicall3: value mismatch"',
    async () => {
      const data = encodeFunctionData({
        abi: ABI,
        functionName: 'aggregate3Value',
        args: [[{ target: VITE_MULTICALL_ADDRESS!, allowFailure: true, value: 1n, callData: GET_BLOCK_NUMBER }]],
      })
      return readRaw(client, data)
    },
    /Multicall3: value mismatch/,
  )

  // ── legacy aggregate (Multicall1 compatibility) ──

  console.log('\naggregate (Multicall1 compatibility)')

  {
    const name = 'aggregate happy path'
    const result = await expectOk(name, async () => {
      const data = encodeFunctionData({
        abi: ABI,
        functionName: 'aggregate',
        args: [[{ target: VITE_MULTICALL_ADDRESS!, callData: GET_BLOCK_NUMBER }]],
      })
      const ret = await readRaw(client, data)
      return decodeFunctionResult({ abi: ABI, functionName: 'aggregate', data: ret })
    })
    if (result) {
      const [blockNumber, returnData] = result as [bigint, Hex[]]
      if (returnData.length !== 1) bad(name, `expected 1 result, got ${returnData.length}`)
      else if (blockNumber <= 0n) bad(name, `expected positive block number, got ${blockNumber}`)
      else ok(name, `blockNumber=${blockNumber}`)
    }
  }

  // ── Block-introspection getters ──

  console.log('\nBlock-introspection getters')

  // Reverting on revive is a real failure: dapps reading these via Multicall3 will break.
  // NUMBER / TIMESTAMP / CHAINID are core EVM opcodes that revive must implement.
  const MUST_PASS = ['getBlockNumber', 'getCurrentBlockTimestamp', 'getChainId'] as const

  for (const name of MUST_PASS) {
    try {
      const data = encodeFunctionData({ abi: ABI, functionName: name })
      const ret = await readRaw(client, data)
      const decoded = decodeFunctionResult({ abi: ABI, functionName: name, data: ret })
      ok(name, `${decoded}`)
    } catch (err: any) {
      bad(name, `must-pass getter reverted: ${err?.shortMessage ?? err?.message}`)
    }
  }

  // May legitimately revert or return zero on revive. Informational, not a failure.
  // BASEFEE: opcode may not be implemented on revive (the contract's JSDoc warns).
  // GASLIMIT: revive uses weight, not gas. Value may be zero, weight-converted, or absent.
  // BLOCKHASH: returns 0 outside the supported window; revive's window may differ from EVM's 256.
  // COINBASE / DIFFICULTY: revive may return zero; not meaningful but not broken.
  const MAY_REVERT = [
    'getBasefee',
    'getCurrentBlockGasLimit',
    'getCurrentBlockCoinbase',
    'getCurrentBlockDifficulty',
    'getLastBlockHash',
  ] as const

  for (const name of MAY_REVERT) {
    try {
      const data = encodeFunctionData({ abi: ABI, functionName: name })
      const ret = await readRaw(client, data)
      const decoded = decodeFunctionResult({ abi: ABI, functionName: name, data: ret })
      info(name, `${decoded}`)
    } catch (err: any) {
      info(name, `reverted: ${err?.shortMessage ?? err?.message}`)
    }
  }

  // Parameterised getters.
  {
    const name = 'getEthBalance(multicall)'
    const result = await expectOk(name, async () => {
      const data = encodeFunctionData({ abi: ABI, functionName: 'getEthBalance', args: [VITE_MULTICALL_ADDRESS!] })
      const ret = await readRaw(client, data)
      return decodeFunctionResult({ abi: ABI, functionName: 'getEthBalance', data: ret })
    })
    if (result !== undefined) ok(name, `${result}`)
  }

  try {
    const head = await client.getBlockNumber()
    const target = head > 1n ? head - 1n : head
    const data = encodeFunctionData({ abi: ABI, functionName: 'getBlockHash', args: [target] })
    const ret = await readRaw(client, data)
    const decoded = decodeFunctionResult({ abi: ABI, functionName: 'getBlockHash', data: ret })
    info(`getBlockHash(${target})`, `${decoded}`)
  } catch (err: any) {
    info('getBlockHash', `reverted: ${err?.shortMessage ?? err?.message}`)
  }

  // ── Summary ──

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Smoke test crashed:', err?.message ?? err)
  process.exit(2)
})
