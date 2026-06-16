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

/**
 * Targeted refresh of the current user's POAPs after their own CheckedIn event.
 *
 * The CheckedIn event carries only the attendee address, not the minted POAP
 * token id, so we read it: getTokensBySource → getPOAPData for ids we don't
 * already hold, filtered to the user, merged in. This populates the badge live
 * instead of waiting for the next full bootLoad reconcile — the festival badge
 * appears the moment the door checks the user in. mergePoaps keeps the real
 * token id, which POAP-gated actions (createSession, flag) depend on.
 */

function userStillCurrent(userAddress: `0x${string}`): boolean {
  return (
    (festivalState.user.address?.toLowerCase() ?? null) === userAddress.toLowerCase()
  )
}

async function refresh(
  poapContract: `0x${string}`,
  sourceContract: `0x${string}`,
  bucket: 'festivalPoaps' | 'sessionPoaps',
  userAddress: `0x${string}`,
): Promise<void> {
  try {
    const [tokenIds] = (await batchRead([
      { address: poapContract, abi: AttendancePOAPABI, functionName: 'getTokensBySource', args: [sourceContract] },
    ])) as [readonly bigint[]]

    if (!userStillCurrent(userAddress)) return

    // Every id already in state is a getPOAPData call saved against the host
    // read budget.
    const known = new Set(festivalState.user[bucket].map((p) => p.tokenId))
    const fresh = tokenIds.filter((id) => !known.has(id))
    if (fresh.length === 0) return

    const data = (await batchRead(
      fresh.map((id) => ({ address: poapContract, abi: AttendancePOAPABI, functionName: 'getPOAPData', args: [id] })),
    )) as readonly POAPData[]

    if (!userStillCurrent(userAddress)) return

    const userLower = userAddress.toLowerCase()
    const mine = fresh
      .map((tokenId, i) => ({ poapContract, tokenId, data: data[i]! }))
      .filter((e) => e.data.attendee.toLowerCase() === userLower)
    if (mine.length === 0) return

    festivalState.user[bucket] = mergePoaps(festivalState.user[bucket], mine)
  } catch (e) {
    // Transient host/RPC blip — the visibility reconcile (bootLoad) recovers.
    console.warn(`[usePoapRefresh] ${bucket} refresh failed:`, e)
  }
}

export function refreshUserFestivalPoaps(userAddress: `0x${string}`): Promise<void> {
  return refresh(FESTIVAL_POAP_ADDRESS, FESTIVAL_ADDRESS, 'festivalPoaps', userAddress)
}

export function refreshUserSessionPoaps(
  userAddress: `0x${string}`,
  sessionAddress: `0x${string}`,
): Promise<void> {
  return refresh(SUB_EVENT_POAP_ADDRESS, sessionAddress, 'sessionPoaps', userAddress)
}
