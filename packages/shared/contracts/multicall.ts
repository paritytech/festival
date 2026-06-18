import {
  encodeFunctionData,
  decodeFunctionResult,
  bytesToHex,
  type Abi,
} from 'viem'
import { Binary } from 'polkadot-api'
import { useMainClient } from '../host/client'
import { READ_ONLY_ORIGIN } from '../host/constants'
import { MULTICALL_ADDRESS } from './addresses'
import { Multicall3ABI } from './abis'
import { readContract } from './read'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Max u64 gas limits. Required for pallet-revive nested CALL frames in dry-runs. */
const WEIGHT_LIMIT = { ref_time: 18446744073709551615n, proof_size: 18446744073709551615n }
const STORAGE_LIMIT = 18446744073709551615n

/**
 * Cap on inner calls per aggregate3 dry-run. A single dry-run that bundles too
 * many inner CALL frames exceeds the Revive pallet's per-call resource ceiling
 * and fails with Err(Module{Revive}) ("dry-run returned failure"). Festivals
 * with hundreds of POAPs hit this on cold load; chunking keeps each dry-run
 * under the limit. 100 leaves headroom for heavier-return calls.
 */
const MAX_CALLS_PER_BATCH = 100

export interface ReadCall {
  address: `0x${string}`
  abi: Abi
  functionName: string
  args?: unknown[]
}

/**
 * Batch multiple contract reads into a single ReviveApi.call() dry-run
 * via Multicall3.aggregate3().
 *
 * Each call is encoded individually, wrapped into one aggregate3 call to the
 * Multicall3 contract, executed as a single dry-run, then each inner result
 * is decoded using its original ABI.
 *
 * Falls back to sequential readContract() if MULTICALL_ADDRESS is not set.
 */
export async function batchRead(
  calls: ReadCall[],
  options?: { at?: 'best' | 'finalized' },
): Promise<unknown[]> {
  if (calls.length === 0) return []

  // Single call. No batching overhead needed
  if (calls.length === 1) {
    const c = calls[0]
    return [await readContract({ address: c.address, abi: c.abi, functionName: c.functionName, args: c.args, at: options?.at })]
  }

  // Fallback: no Multicall3 deployed → sequential reads
  if (MULTICALL_ADDRESS === ZERO_ADDRESS) {
    const results: unknown[] = []
    for (const c of calls) {
      results.push(await readContract({ address: c.address, abi: c.abi, functionName: c.functionName, args: c.args, at: options?.at }))
    }
    return results
  }

  // Large batch: split into chunks so no single dry-run exceeds the Revive
  // per-call resource ceiling. Chunks run in parallel; results are concatenated
  // in order so callers see one flat array indexed like `calls`.
  if (calls.length > MAX_CALLS_PER_BATCH) {
    const chunks: ReadCall[][] = []
    for (let i = 0; i < calls.length; i += MAX_CALLS_PER_BATCH) {
      chunks.push(calls.slice(i, i + MAX_CALLS_PER_BATCH))
    }
    const chunkResults = await Promise.all(chunks.map((chunk) => batchRead(chunk, options)))
    return chunkResults.flat()
  }

  // Encode each sub-call's calldata
  const encodedCalls = calls.map((c) => ({
    target: c.address,
    allowFailure: false,
    callData: encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args ?? [] }),
  }))

  // Encode the outer aggregate3 call
  const outerCalldata = encodeFunctionData({
    abi: Multicall3ABI,
    functionName: 'aggregate3',
    args: [encodedCalls],
  })

  // Single dry-run to Multicall3
  const { api } = useMainClient()

  const at = options?.at ?? 'best'

  // Read at best block by default; reconcile callers pass 'finalized'.
  const dryRun = await api.apis.ReviveApi.call(
    READ_ONLY_ORIGIN,
    MULTICALL_ADDRESS.toLowerCase(),
    0n,
    WEIGHT_LIMIT,
    STORAGE_LIMIT,
    Binary.fromHex(outerCalldata),
    { at },
  )

  if (!dryRun.result.success) {
    throw new Error('batchRead: Multicall3 dry-run returned failure')
  }

  if (dryRun.result.value.flags & 1) {
    throw new Error('batchRead: Multicall3 aggregate3 reverted')
  }

  // Decode outer response → Result[] array
  const outerResult = decodeFunctionResult({
    abi: Multicall3ABI,
    functionName: 'aggregate3',
    data: bytesToHex(dryRun.result.value.data),
  }) as Array<{ success: boolean; returnData: `0x${string}` }>

  // Decode each inner result using its original ABI
  return outerResult.map((result, i) => {
    const call = calls[i]
    if (!result.success) {
      throw new Error(`batchRead: call ${i} failed (${call.functionName} on ${call.address})`)
    }
    return decodeFunctionResult({
      abi: call.abi,
      functionName: call.functionName,
      data: result.returnData,
    })
  })
}
