import { batchRead } from '@festival/shared/contracts/multicall'
import { AttendancePOAPABI } from '@festival/shared/contracts/abis'
import {
  FESTIVAL_ADDRESS,
  FESTIVAL_POAP_ADDRESS,
  SUB_EVENT_POAP_ADDRESS,
} from '@festival/shared/contracts/addresses'
import type { POAPData } from '@festival/shared/contracts/types'
import { festivalState } from '@festival/shared/cache/festival-state'
import { mergePoaps } from '@festival/shared/cache/merge'

function userStillCurrent(userAddress: `0x${string}`): boolean {
  return (
    (festivalState.user.address?.toLowerCase() ?? null) ===
    userAddress.toLowerCase()
  )
}

async function refreshUserPoaps(
  poapContract: `0x${string}`,
  sourceContract: `0x${string}`,
  bucket: 'festivalPoaps' | 'sessionPoaps',
  userAddress: `0x${string}`,
): Promise<void> {
  try {
    const [tokenIds] = (await batchRead([
      {
        address: poapContract,
        abi: AttendancePOAPABI,
        functionName: 'getTokensBySource',
        args: [sourceContract],
      },
    ])) as [readonly bigint[]]

    if (!userStillCurrent(userAddress)) return

    // Skip token ids already in state — every one avoided is a getPOAPData
    // call saved against the host's read budget.
    const knownIds = new Set(festivalState.user[bucket].map((p) => p.tokenId))
    const newIds = tokenIds.filter((id) => !knownIds.has(id))
    if (newIds.length === 0) return

    const data = (await batchRead(
      newIds.map((id) => ({
        address: poapContract,
        abi: AttendancePOAPABI,
        functionName: 'getPOAPData',
        args: [id],
      })),
    )) as readonly POAPData[]

    if (!userStillCurrent(userAddress)) return

    const userLower = userAddress.toLowerCase()
    const mine = newIds
      .map((tokenId, idx) => ({ poapContract, tokenId, data: data[idx]! }))
      .filter((entry) => entry.data.attendee.toLowerCase() === userLower)

    if (mine.length === 0) return
    festivalState.user[bucket] = mergePoaps(festivalState.user[bucket], mine)
  } catch (e) {
    // Transient RPC/host blip. Next visibility reconcile or refresh recovers
    // via bootLoadAttendee; nothing to surface to the user here.
    console.warn(`[usePoapRefresh] ${bucket} refresh failed:`, e)
  }
}

export function refreshUserFestivalPoaps(
  userAddress: `0x${string}`,
): Promise<void> {
  return refreshUserPoaps(
    FESTIVAL_POAP_ADDRESS,
    FESTIVAL_ADDRESS,
    'festivalPoaps',
    userAddress,
  )
}

export function refreshUserSessionPoaps(
  userAddress: `0x${string}`,
  sessionAddress: `0x${string}`,
): Promise<void> {
  return refreshUserPoaps(
    SUB_EVENT_POAP_ADDRESS,
    sessionAddress,
    'sessionPoaps',
    userAddress,
  )
}
