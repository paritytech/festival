import { readContract } from './read'
import { batchRead } from './multicall'
import { FestivalABI, FestivalSessionABI, AttendancePOAPABI } from './abis'
import { FESTIVAL_ADDRESS } from './addresses'
import type { FestivalDetails, SessionDetails, POAPData } from './types'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

/** Check if festival contracts are deployed (env vars set to non-zero). */
export function hasDeployedContracts(): boolean {
  return FESTIVAL_ADDRESS !== ZERO_ADDRESS
}

/** Read Festival.getEventDetails() → FestivalDetails */
export async function readFestivalDetails(
  address: `0x${string}`,
  at?: 'best' | 'finalized',
): Promise<FestivalDetails> {
  const result = await readContract<readonly [
    `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
    bigint, bigint,
    boolean, number,
    boolean, bigint,
  ]>({
    address,
    abi: FestivalABI,
    functionName: 'getEventDetails',
    at,
  })

  return {
    metadataCid: result[0],
    creator: result[1],
    festivalPoapContract: result[2],
    sessionPoapContract: result[3],
    startTime: result[4],
    endTime: result[5],
    sessionsEnabled: result[6],
    capacity: result[7],
    cancelled: result[8],
    registeredCount: result[9],
  }
}

/**
 * Batch-read overview data: details + checked-in count + session count.
 * Single Multicall3 dry-run instead of 3 sequential reads.
 */
export async function readFestivalOverview(
  address: `0x${string}`,
  at?: 'best' | 'finalized',
): Promise<{
  details: FestivalDetails
  checkedInCount: number
  sessionCount: number
}> {
  const [detailsRaw, attendeesRaw, sessionCountRaw] = (await batchRead(
    [
      { address, abi: FestivalABI, functionName: 'getEventDetails' },
      { address, abi: FestivalABI, functionName: 'getAttendees' },
      { address, abi: FestivalABI, functionName: 'getSessionCount' },
    ],
    { at },
  )) as [
    readonly [
      `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
      bigint, bigint,
      boolean, number,
      boolean, bigint,
    ],
    readonly [`0x${string}`[], boolean[]],
    bigint,
  ]

  const details: FestivalDetails = {
    metadataCid: detailsRaw[0],
    creator: detailsRaw[1],
    festivalPoapContract: detailsRaw[2],
    sessionPoapContract: detailsRaw[3],
    startTime: detailsRaw[4],
    endTime: detailsRaw[5],
    sessionsEnabled: detailsRaw[6],
    capacity: detailsRaw[7],
    cancelled: detailsRaw[8],
    registeredCount: detailsRaw[9],
  }

  return {
    details,
    checkedInCount: attendeesRaw[1].filter(Boolean).length,
    sessionCount: Number(sessionCountRaw),
  }
}

/** Read FestivalSession.getEventDetails() → SessionDetails */
export async function readSessionDetails(
  address: `0x${string}`,
  at?: 'best' | 'finalized',
): Promise<SessionDetails> {
  const result = await readContract<readonly [
    `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
    bigint, bigint,
    boolean, bigint,
  ]>({
    address,
    abi: FestivalSessionABI,
    functionName: 'getEventDetails',
    at,
  })

  const [flagCount, flagThreshold] = await Promise.all([
    readContract<bigint>({ address, abi: FestivalSessionABI, functionName: 'flagCount', at }),
    readContract<bigint>({ address, abi: FestivalSessionABI, functionName: 'FLAG_THRESHOLD', at }),
  ])

  return {
    metadataCid: result[0],
    creator: result[1],
    poapContract: result[2],
    parentFestival: result[3],
    startTime: result[4],
    endTime: result[5],
    cancelled: result[6],
    registeredCount: result[7],
    flagCount,
    flagThreshold,
  }
}

/** Read Festival.getAttendees() → { addresses, checkedIn } */
export async function readFestivalAttendees(
  address: `0x${string}`,
): Promise<{ addresses: `0x${string}`[]; checkedIn: boolean[] }> {
  const result = await readContract<readonly [`0x${string}`[], boolean[]]>({
    address,
    abi: FestivalABI,
    functionName: 'getAttendees',
  })

  return { addresses: [...result[0]], checkedIn: [...result[1]] }
}

/** Read Festival.getSessions() → address[] */
export async function readSessionAddresses(
  address: `0x${string}`,
  at?: 'best' | 'finalized',
): Promise<`0x${string}`[]> {
  const result = await readContract<`0x${string}`[]>({
    address,
    abi: FestivalABI,
    functionName: 'getSessions',
    at,
  })
  return result
}

/** Read isRegistered(attendee) on Festival or SubEvent. */
export async function readIsRegistered(
  contractAddress: `0x${string}`,
  attendee: `0x${string}`,
): Promise<boolean> {
  return readContract<boolean>({
    address: contractAddress,
    abi: FestivalABI,
    functionName: 'isRegistered',
    args: [attendee],
  })
}

/** Read isCheckedIn(attendee) on Festival or SubEvent. */
export async function readIsCheckedIn(
  contractAddress: `0x${string}`,
  attendee: `0x${string}`,
): Promise<boolean> {
  return readContract<boolean>({
    address: contractAddress,
    abi: FestivalABI,
    functionName: 'isCheckedIn',
    args: [attendee],
  })
}

/** Read ticketOf(attendee) → POAP token ID (0 = no ticket). */
export async function readTicketOf(
  contractAddress: `0x${string}`,
  attendee: `0x${string}`,
): Promise<bigint> {
  return readContract<bigint>({
    address: contractAddress,
    abi: FestivalABI,
    functionName: 'ticketOf',
    args: [attendee],
  })
}

/** Read hasRole(role, account) on Festival. */
export async function readHasRole(
  contractAddress: `0x${string}`,
  role: `0x${string}`,
  account: `0x${string}`,
): Promise<boolean> {
  return readContract<boolean>({
    address: contractAddress,
    abi: FestivalABI,
    functionName: 'hasRole',
    args: [role, account],
  })
}

/** Read AttendancePOAP.getTokensBySource(sourceContract) → tokenId[] */
export async function readTokensBySource(
  poapAddress: `0x${string}`,
  sourceContract: `0x${string}`,
  at?: 'best' | 'finalized',
): Promise<bigint[]> {
  return readContract<bigint[]>({
    address: poapAddress,
    abi: AttendancePOAPABI,
    functionName: 'getTokensBySource',
    args: [sourceContract],
    at,
  })
}

/** Read AttendancePOAP.getPOAPData(tokenId) → POAPData */
export async function readPOAPData(
  poapAddress: `0x${string}`,
  tokenId: bigint,
  at?: 'best' | 'finalized',
): Promise<POAPData> {
  // getPOAPData returns a struct (single tuple output), viem decodes as named object
  const result = await readContract<{
    sourceContract: `0x${string}`
    attendee: `0x${string}`
    issuedAt: bigint
  }>({
    address: poapAddress,
    abi: AttendancePOAPABI,
    functionName: 'getPOAPData',
    args: [tokenId],
    at,
  })

  return {
    sourceContract: result.sourceContract,
    attendee: result.attendee,
    issuedAt: result.issuedAt,
  }
}

/**
 * Batch-read all checked-in attendees for a festival, with check-in timestamps.
 * Uses two reads: getTokensBySource (1 call) + getPOAPData per token (batched).
 * Returns entries sorted by check-in time descending (most recent first).
 */
export async function readCheckedInAttendees(
  festivalPoapAddress: `0x${string}`,
  festivalAddress: `0x${string}`,
  at?: 'best' | 'finalized',
): Promise<{ address: `0x${string}`; checkedInAt: number }[]> {
  const tokenIds = await readTokensBySource(festivalPoapAddress, festivalAddress, at)
  if (tokenIds.length === 0) return []

  const calls = tokenIds.map((tokenId) => ({
    address: festivalPoapAddress,
    abi: AttendancePOAPABI,
    functionName: 'getPOAPData',
    args: [tokenId],
  }))
  const results = (await batchRead(calls, { at })) as Array<{
    sourceContract: `0x${string}`
    attendee: `0x${string}`
    issuedAt: bigint
  }>

  return results
    .map((r) => ({ address: r.attendee, checkedInAt: Number(r.issuedAt) }))
    .sort((a, b) => b.checkedInAt - a.checkedInAt)
}

/** Read getRoleMemberCount(role) → number of holders for that role. */
export async function readRoleMemberCount(
  contractAddress: `0x${string}`,
  role: `0x${string}`,
): Promise<bigint> {
  return readContract<bigint>({
    address: contractAddress,
    abi: FestivalABI,
    functionName: 'getRoleMemberCount',
    args: [role],
  })
}

/** Read getRoleMember(role, index) → address of the member at that index. */
export async function readRoleMember(
  contractAddress: `0x${string}`,
  role: `0x${string}`,
  index: bigint,
): Promise<`0x${string}`> {
  return readContract<`0x${string}`>({
    address: contractAddress,
    abi: FestivalABI,
    functionName: 'getRoleMember',
    args: [role, index],
  })
}

/** Read all members of a role by enumerating getRoleMember(). */
export async function readRoleMembers(
  contractAddress: `0x${string}`,
  role: `0x${string}`,
): Promise<`0x${string}`[]> {
  const count = await readRoleMemberCount(contractAddress, role)
  const members: `0x${string}`[] = []
  for (let i = 0n; i < count; i++) {
    members.push(await readRoleMember(contractAddress, role, i))
  }
  return members
}

/** Read FestivalSession.getAttendees() → list of attendees with check-in status. */
export async function readSessionAttendees(
  sessionAddress: `0x${string}`,
): Promise<{ address: `0x${string}`; isCheckedIn: boolean }[]> {
  const result = await readContract<readonly [`0x${string}`[], boolean[]]>({
    address: sessionAddress,
    abi: FestivalSessionABI,
    functionName: 'getAttendees',
  })
  return result[0].map((addr, i) => ({
    address: addr,
    isCheckedIn: result[1][i],
  }))
}

/** Check if a metadata CID is non-zero (contract has been set up). */
export function isNonZeroCid(cid: `0x${string}`): boolean {
  return cid !== ZERO_BYTES32
}

/** Read Festival.channelMetadataCid() → bytes32 CID pointer. */
export async function readChannelMetadataCid(
  festivalAddress: `0x${string}`,
): Promise<`0x${string}`> {
  return readContract<`0x${string}`>({
    address: festivalAddress,
    abi: FestivalABI,
    functionName: 'channelMetadataCid',
  })
}
