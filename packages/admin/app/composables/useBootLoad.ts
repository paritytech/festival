import { batchRead } from '@festival/shared/contracts/multicall'
import { FestivalABI, FestivalSessionABI, AttendancePOAPABI } from '@festival/shared/contracts/abis'
import { FESTIVAL_POAP_ADDRESS } from '@festival/shared/contracts/addresses'
import { isNonZeroCid } from '@festival/shared/contracts/festival-reads'
import { ROLES } from '@festival/shared/contracts/types'
import type { FestivalDetails, SessionDetails, POAPData } from '@festival/shared/contracts/types'
import type { FestivalMetadata, SubEventMetadata } from '@festival/shared/metadata/schemas'
import { hydrateSubEventMetadata } from '@festival/shared/metadata/schemas'
import { useBulletinStorage } from '@festival/shared/metadata/bulletin'
import { fetchInChunks } from '@festival/shared/utils/chunked'
import {
  festivalState,
  hydrateFromCache,
  persistToCache,
  applyFestivalMetadata,
  type SessionEntry,
} from '@festival/shared/cache/festival-state'
import { mergeAttendees, mergeSessions, mergePoaps, maxBig } from '@festival/shared/cache/merge'
import type { ContractRole } from '@festival/shared/permissions'

interface BootLoadOptions {
  at?: 'best' | 'finalized'
}

/**
 * A load that started for the previous account must not write user fields
 * after a switch, so every user write checks this first. Global festival
 * state stays safe to write from any run.
 */
function userStillCurrent(userAddress: `0x${string}` | null): boolean {
  return (
    (festivalState.user.address?.toLowerCase() ?? null) ===
    (userAddress?.toLowerCase() ?? null)
  )
}

const ROLE_ORDER: { hash: `0x${string}`; label: ContractRole }[] = [
  { hash: ROLES.DEFAULT_ADMIN_ROLE, label: 'ADMIN' },
  { hash: ROLES.MANAGER_ROLE, label: 'MANAGER' },
  { hash: ROLES.VOLUNTEER_ROLE, label: 'VOLUNTEER' },
]

/**
 * Cold-load the entire festival state for the admin SPA in two Multicall3
 * round-trips. Round 1 issues the reads that depend only on env constants and
 * the wallet (details, attendees, sessions, role membership, festival POAP
 * tokens); round 2 fans out over round-1 results (per-session details, role
 * member enumeration, per-token POAP data). The two rounds are sequential
 * because round 2's calls are keyed on round 1's output.
 */
export async function bootLoadAdmin(
  festivalAddress: `0x${string}`,
  userAddress: `0x${string}` | null,
  options: BootLoadOptions = {},
): Promise<void> {
  festivalState.loading = true
  festivalState.error = null

  // Account switch: the previous user's per-user fields must not leak into
  // the new user's view or win the per-user merges below — resetting makes
  // those merges start from empty for a new account.
  const sameUser =
    (festivalState.user.address?.toLowerCase() ?? null) ===
    (userAddress?.toLowerCase() ?? null)
  if (!sameUser) {
    festivalState.user.ticketTokenId = 0n
    festivalState.user.festivalPoaps = []
    festivalState.user.sessionPoaps = []
    festivalState.user.roles = []
  }
  festivalState.user.address = userAddress

  // Cache-first paint. Show last-known data instantly while chain reads run.
  await hydrateFromCache(festivalAddress, userAddress)

  try {
    const r1 = await runRound1(festivalAddress, userAddress, options.at)
    await runRound2(
      festivalAddress,
      r1.sessionAddrs,
      r1.roleCounts,
      r1.festPoapTokenIds,
      options.at,
    )
    festivalState.loaded = true
    void persistToCache(festivalAddress, userAddress)
  } catch (e) {
    festivalState.error = e instanceof Error ? e.message : String(e)
    console.warn('[bootLoadAdmin] failed:', e)
  } finally {
    festivalState.loading = false
  }
}

interface Round1Result {
  sessionAddrs: readonly `0x${string}`[]
  roleCounts: number[] // indexed by ROLE_ORDER
  festPoapTokenIds: readonly bigint[]
}

async function runRound1(
  festivalAddress: `0x${string}`,
  userAddress: `0x${string}` | null,
  at?: 'best' | 'finalized',
): Promise<Round1Result> {
  const userArg = userAddress ?? ('0x0000000000000000000000000000000000000000' as `0x${string}`)

  const calls = [
    { address: festivalAddress, abi: FestivalABI, functionName: 'getEventDetails' },
    { address: festivalAddress, abi: FestivalABI, functionName: 'getAttendees' },
    { address: festivalAddress, abi: FestivalABI, functionName: 'getSessions' },
    ...ROLE_ORDER.map(({ hash }) => ({
      address: festivalAddress,
      abi: FestivalABI,
      functionName: 'hasRole',
      args: [hash, userArg],
    })),
    ...ROLE_ORDER.map(({ hash }) => ({
      address: festivalAddress,
      abi: FestivalABI,
      functionName: 'getRoleMemberCount',
      args: [hash],
    })),
    {
      address: FESTIVAL_POAP_ADDRESS,
      abi: AttendancePOAPABI,
      functionName: 'getTokensBySource',
      args: [festivalAddress],
    },
  ]

  const results = await batchRead(calls, { at })

  const detailsRaw = results[0] as readonly [
    `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
    bigint, bigint,
    boolean, number,
    boolean, bigint,
  ]
  const attendeesRaw = results[1] as readonly [`0x${string}`[], boolean[]]
  const sessionsRaw = results[2] as readonly `0x${string}`[]
  const hasRoleRaw = [results[3], results[4], results[5]] as boolean[]
  const roleCountsRaw = [results[6], results[7], results[8]] as bigint[]
  const festPoapTokensRaw = results[9] as readonly bigint[]

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

  festivalState.festival = {
    address: festivalAddress,
    details: {
      ...details,
      registeredCount: maxBig(
        festivalState.festival?.details.registeredCount ?? 0n,
        details.registeredCount,
      ),
    },
    metadata: festivalState.festival?.metadata ?? null,
    attendees: mergeAttendees(
      festivalState.festival?.attendees ?? [],
      attendeesRaw[0].map((a, i) => ({
        address: a,
        isCheckedIn: attendeesRaw[1][i] ?? false,
      })),
    ),
  }

  // User's roles. Derived locally from the per-role hasRole results.
  if (userStillCurrent(userAddress)) {
    festivalState.user.roles = ROLE_ORDER.filter((_, i) => hasRoleRaw[i]).map((r) => r.label)
  }

  // Stub role holders. R2 fills members per role.
  festivalState.roles = ROLE_ORDER.map(({ hash }) => ({ role: hash, members: [] }))

  // Stub session entries; R2 upgrades via merge. mergeSessions keeps any
  // already-real entry (from cache or a prior load) from regressing to a stub.
  festivalState.sessions = mergeSessions(
    festivalState.sessions,
    sessionsRaw.map<SessionEntry>((address) => ({
      address,
      details: {
        metadataCid: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
        creator: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        poapContract: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        parentFestival: festivalAddress,
        startTime: 0n,
        endTime: 0n,
        cancelled: false,
        registeredCount: 0n,
        // Zero so keepPositive never lets a stub beat the real chain value.
        flagCount: 0n,
        flagThreshold: 0n,
      },
      metadata: null,
      attendees: [],
      poapTokenIds: [],
    })),
  )

  if (isNonZeroCid(details.metadataCid)) {
    void fetchFestivalMetadata(details.metadataCid)
  }

  return {
    sessionAddrs: sessionsRaw,
    roleCounts: roleCountsRaw.map((c) => Number(c)),
    festPoapTokenIds: festPoapTokensRaw,
  }
}

async function runRound2(
  festivalAddress: `0x${string}`,
  sessionAddrs: readonly `0x${string}`[],
  roleCounts: number[],
  festPoapTokenIds: readonly bigint[],
  at?: 'best' | 'finalized',
): Promise<void> {
  // Per-session: details + attendees.
  const sessionCalls = sessionAddrs.flatMap((addr) => [
    { address: addr, abi: FestivalSessionABI, functionName: 'getEventDetails' },
    { address: addr, abi: FestivalSessionABI, functionName: 'getAttendees' },
    { address: addr, abi: FestivalSessionABI, functionName: 'flagCount' },
    { address: addr, abi: FestivalSessionABI, functionName: 'FLAG_THRESHOLD' },
  ])
  // Per-role × index: getRoleMember enumeration.
  const roleMemberCalls = ROLE_ORDER.flatMap(({ hash }, i) =>
    Array.from({ length: roleCounts[i] }, (_, idx) => ({
      address: festivalAddress,
      abi: FestivalABI,
      functionName: 'getRoleMember',
      args: [hash, BigInt(idx)],
    })),
  )
  // Per-festival POAP token: getPOAPData.
  const festPoapCalls = festPoapTokenIds.map((id) => ({
    address: FESTIVAL_POAP_ADDRESS,
    abi: AttendancePOAPABI,
    functionName: 'getPOAPData',
    args: [id],
  }))

  const calls = [...sessionCalls, ...roleMemberCalls, ...festPoapCalls]
  if (calls.length === 0) return

  const results = await batchRead(calls, { at })

  // Decode session pairs. Collect metadata fetch targets here and fire them
  // in batches below to stay under the host's preimage rate budget.
  const SESSION_STRIDE = 4
  const metadataTargets: Array<{ address: `0x${string}`; cid: `0x${string}` }> = []
  for (let i = 0; i < sessionAddrs.length; i++) {
    const off = i * SESSION_STRIDE
    const detailsRaw = results[off] as readonly [
      `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
      bigint, bigint,
      boolean, bigint,
    ]
    const attendeesRaw = results[off + 1] as readonly [`0x${string}`[], boolean[]]

    const details: SessionDetails = {
      metadataCid: detailsRaw[0],
      creator: detailsRaw[1],
      poapContract: detailsRaw[2],
      parentFestival: detailsRaw[3],
      startTime: detailsRaw[4],
      endTime: detailsRaw[5],
      cancelled: detailsRaw[6],
      registeredCount: detailsRaw[7],
      flagCount: results[off + 2] as bigint,
      flagThreshold: results[off + 3] as bigint,
    }

    // Find by address, not by index: mergeSessions can reorder the array
    // (union by address), so positional indexing would write to the wrong
    // session on a warm re-run.
    const addr = sessionAddrs[i]!
    const entry = festivalState.sessions.find(
      (s) => s.address.toLowerCase() === addr.toLowerCase(),
    )
    if (entry) {
      // Same latches mergeSession applies elsewhere. A stale read cannot
      // uncancel a session, shrink its count, or roll back its flags.
      entry.details = {
        ...details,
        cancelled: entry.details.cancelled || details.cancelled,
        registeredCount: maxBig(entry.details.registeredCount, details.registeredCount),
        flagCount: maxBig(entry.details.flagCount, details.flagCount),
      }
      entry.attendees = mergeAttendees(
        entry.attendees,
        attendeesRaw[0].map((a, idx) => ({
          address: a,
          isCheckedIn: attendeesRaw[1][idx] ?? false,
        })),
      )
      if (isNonZeroCid(details.metadataCid)) {
        metadataTargets.push({ address: entry.address, cid: details.metadataCid })
      }
    }
  }

  // Fire-and-forget at the boot-load level; individual failures are logged
  // inside fetchSessionMetadata.
  void fetchInChunks(metadataTargets, (t) => fetchSessionMetadata(t.address, t.cid))

  // Decode role members.
  let memberOffset = sessionAddrs.length * SESSION_STRIDE
  for (let r = 0; r < ROLE_ORDER.length; r++) {
    const count = roleCounts[r]
    const members: `0x${string}`[] = []
    for (let i = 0; i < count; i++) {
      members.push(results[memberOffset + i] as `0x${string}`)
    }
    festivalState.roles[r] = { role: ROLE_ORDER[r].hash, members }
    memberOffset += count
  }

  // Decode festival POAP data. Admin doesn't filter to user (full attendee
  // list view shows all check-in timestamps).
  const festPoapOffset = memberOffset
  if (festPoapTokenIds.length > 0) {
    // Union: mints are monotonic, so a stale read can't drop a POAP.
    festivalState.user.festivalPoaps = mergePoaps(
      festivalState.user.festivalPoaps,
      festPoapTokenIds.map((tokenId, idx) => ({
        poapContract: FESTIVAL_POAP_ADDRESS,
        tokenId,
        data: results[festPoapOffset + idx] as POAPData,
      })),
    )
  }
}

async function fetchFestivalMetadata(cid: `0x${string}`): Promise<void> {
  try {
    const { retrievePlaintext } = useBulletinStorage()
    const meta = await retrievePlaintext<FestivalMetadata>(cid)
    // Guarded on the CID we fetched, so a slow read can't clobber a newer update.
    applyFestivalMetadata(meta, cid)
  } catch (e) {
    console.warn('[bootLoadAdmin] festival metadata fetch failed:', e)
  }
}

async function fetchSessionMetadata(
  sessionAddr: `0x${string}`,
  cid: `0x${string}`,
): Promise<void> {
  try {
    const { retrievePlaintext } = useBulletinStorage()
    const raw = await retrievePlaintext<SubEventMetadata>(cid)
    const entry = festivalState.sessions.find((s) => s.address === sessionAddr)
    if (entry) entry.metadata = hydrateSubEventMetadata(raw)
  } catch (e) {
    console.warn(`[bootLoadAdmin] session ${sessionAddr.slice(0, 10)} metadata fetch failed:`, e)
  }
}
