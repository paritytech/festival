import {
  encodeFunctionData,
  decodeFunctionResult,
  bytesToHex,
  type Abi,
} from 'viem'
import { Binary } from 'polkadot-api'
import { useMainClient } from '../host/client'
import { READ_ONLY_ORIGIN } from '../host/constants'

/**
 * Read from a contract via ReviveApi.call() dry-run (host-only).
 * No viem publicClient fallback. All reads go through PAPI WebSocket.
 */
export async function readContract<T = unknown>({
  address,
  abi,
  functionName,
  args = [],
  walletAddress,
  at,
}: {
  address: `0x${string}`
  abi: Abi
  functionName: string
  args?: unknown[]
  walletAddress?: string
  at?: 'best' | 'finalized'
}): Promise<T> {
  const calldata = encodeFunctionData({ abi, functionName, args })
  const { api } = await useMainClient()

  const origin = walletAddress || READ_ONLY_ORIGIN

  const resolvedAt = at ?? 'best'

  // Read at best block by default (~6s vs ~40s for finalized). Reconcile
  // paths opt into 'finalized' explicitly for ground-truth checks.
  const dryRun = await api.apis.ReviveApi.call(
    origin,
    address.toLowerCase(),
    0n,
    undefined,
    undefined,
    Binary.fromHex(calldata),
    { at: resolvedAt },
  )

  if (!dryRun.result.success) {
    throw new Error(`Contract read failed: dry-run returned failure for ${functionName}`)
  }

  // Check revert flag (bit 0 of flags)
  if (dryRun.result.value.flags & 1) {
    throw new Error(`Contract read reverted: ${functionName}`)
  }

  return decodeFunctionResult({ abi, functionName, data: bytesToHex(dryRun.result.value.data) }) as T
}
