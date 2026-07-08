import { batchRead } from '@festival/shared/contracts/multicall'
import { FestivalABI, FestivalSessionABI, AttendancePOAPABI } from '@festival/shared/contracts/abis'
import {
  FESTIVAL_ADDRESS,
  FESTIVAL_POAP_ADDRESS,
  SUB_EVENT_POAP_ADDRESS,
} from '@festival/shared/contracts/addresses'
import { isNonZeroCid } from '@festival/shared/contracts/festival-reads'
import type { FestivalDetails, SessionDetails, POAPData } from '@festival/shared/contracts/types'
import type { FestivalMetadata, SubEventMetadata } from '@festival/shared/metadata/schemas'
import { hydrateSubEventMetadata } from '@festival/shared/metadata/schemas'
import { useBulletinStorage } from '@festival/shared/metadata/bulletin'
import { fetchInChunks } from '@festival/shared/utils/chunked'
import { festivalState, hydrateFromCache, persistToCache, applyFestivalMetadata, type SessionEntry } from '@festival/shared/cache/festival-state'
import { mergeAttendees, mergeSessions, mergePoaps, maxBig, keepPositive } from '@festival/shared/cache/merge'

interface BootLoadOptions {
  /** Block tag for the chain reads. Default 'best' for snappy UX. */
  at?: 'best' | 'finalized'
}

// Single-flight with one trailing rerun. At most one load runs at a time, so
// concurrent triggers (check-in poll, visibility reconcile, post-tx reloads)
// never interleave writes into the festivalState singleton. Calls arriving
// mid-flight coalesce into a single follow-up run with the latest arguments,
// and resolve when that run completes — every caller is guaranteed a load
// whose chain reads started no earlier than its call, so a reload() fired
// after a tx lands always observes the tx.
let current: Promise<void> | null = null
let trailing: Promise<void> | null = null
let trailingArgs: [`0x${string}` | null, BootLoadOptions] | null = null

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

/**
 * Cold-load the entire festival state in up to three Multicall3 round-trips.
 * Each round is keyed on the previous round's results:
 *
 * R1 — independent reads: festival details, attendees, ticketOf, session list,
 *      festival POAP token ids.
 * R2 — per session (details, attendees, POAP token list) and per festival POAP
 *      token (getPOAPData).
 * R3 — per session POAP token (getPOAPData), only when any exist.
 *
 * Concurrent loads are safe: every write into festivalState goes through the
 * monotonic merge (see cache/merge.ts), so interleaved or out-of-order runs
 * can only upgrade state, never regress it — no single-flight guard needed.
 */
export function bootLoadAttendee(
  userAddress: `0x${string}` | null,
  options: BootLoadOptions = {},
): Promise<void> {
  if (!current) {
    current = runBootLoad(userAddress, options).finally(() => {
      current = null
    })
    return current
  }

  trailingArgs = [userAddress, options]
  if (!trailing) {
    // runBootLoad never rejects (errors land in festivalState.error), but the
    // catch keeps a future regression from wedging the trailing slot shut.
    trailing = current.catch(() => {}).then(() => {
      const [user, opts] = trailingArgs!
      trailingArgs = null
      trailing = null
      return bootLoadAttendee(user, opts)
    })
  }
  return trailing
}

async function runBootLoad(
  userAddress: `0x${string}` | null,
  options: BootLoadOptions,
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
  await hydrateFromCache(FESTIVAL_ADDRESS, userAddress)

  try {
    const r1 = await runRound1(userAddress, options.at)
    const r2 = await runRound2(r1.sessionAddrs, r1.festPoapTokenIds, userAddress, options.at)
    if (r2.allSessionPoapTokenIds.length > 0) {
      await runRound3(r2.allSessionPoapTokenIds, userAddress, options.at)
    }
    festivalState.loaded = true
    void persistToCache(FESTIVAL_ADDRESS, userAddress)
  } catch (e) {
    festivalState.error = e instanceof Error ? e.message : String(e)
    console.warn('[bootLoadAttendee] failed:', e)
  } finally {
    festivalState.loading = false
  }
}

interface Round1Result {
  sessionAddrs: readonly `0x${string}`[]
  festPoapTokenIds: readonly bigint[]
}

async function runRound1(
  userAddress: `0x${string}` | null,
  at?: 'best' | 'finalized',
): Promise<Round1Result> {
  // ticketOf needs an address; fall back to the zero address when the wallet
  // isn't connected so the call still encodes (the result is discarded).
  const userArg = userAddress ?? ('0x0000000000000000000000000000000000000000' as `0x${string}`)

  const calls = [
    { address: FESTIVAL_ADDRESS, abi: FestivalABI, functionName: 'getEventDetails' },
    { address: FESTIVAL_ADDRESS, abi: FestivalABI, functionName: 'getAttendees' },
    { address: FESTIVAL_ADDRESS, abi: FestivalABI, functionName: 'ticketOf', args: [userArg] },
    { address: FESTIVAL_ADDRESS, abi: FestivalABI, functionName: 'getSessions' },
    { address: FESTIVAL_POAP_ADDRESS, abi: AttendancePOAPABI, functionName: 'getTokensBySource', args: [FESTIVAL_ADDRESS] },
  ] as const

  const [
    detailsRaw,
    attendeesRaw,
    ticketRaw,
    sessionsRaw,
    festPoapTokensRaw,
  ] = (await batchRead(calls as unknown as Parameters<typeof batchRead>[0], { at })) as [
    readonly [
      `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
      bigint, bigint,
      boolean, number,
      boolean, bigint,
    ],
    readonly [`0x${string}`[], boolean[]],
    bigint,
    readonly `0x${string}`[],
    readonly bigint[],
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

  const attendees = attendeesRaw[0].map((address, i) => ({
    address,
    isCheckedIn: attendeesRaw[1][i] ?? false,
  }))

  // Metadata is fetched off-chain (Bulletin) below and stays null until it lands.
  // Attendees merge (check-in latches) and registeredCount only advances, so a
  // stale read can't drop a just-applied registration/check-in.
  festivalState.festival = {
    address: FESTIVAL_ADDRESS,
    details: {
      ...details,
      registeredCount: maxBig(
        festivalState.festival?.details.registeredCount ?? 0n,
        details.registeredCount,
      ),
    },
    metadata: festivalState.festival?.metadata ?? null,
    attendees: mergeAttendees(festivalState.festival?.attendees ?? [], attendees),
  }

  // A stale read can't take a known ticket back to zero (no unregister on-chain).
  if (userStillCurrent(userAddress)) {
    festivalState.user.ticketTokenId = keepPositive(festivalState.user.ticketTokenId, ticketRaw)
  }

  // Stub session entries up front so consumers (e.g. the session detail page)
  // can resolve `getByAddress(addr)` immediately; R2 upgrades them via merge.
  // mergeSessions keeps any already-real entry from regressing to a stub.
  festivalState.sessions = mergeSessions(
    festivalState.sessions,
    sessionsRaw.map((address) => ({
      address,
      details: {
        metadataCid: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
        creator: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        poapContract: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        parentFestival: FESTIVAL_ADDRESS,
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

  // Off-chain fetch; doesn't count against the chainHead rate budget. Fire and forget.
  if (isNonZeroCid(details.metadataCid)) {
    void fetchFestivalMetadata(details.metadataCid)
  }

  return {
    sessionAddrs: sessionsRaw,
    festPoapTokenIds: festPoapTokensRaw,
  }
}

interface Round2Result {
  /** Token ids across all sessions, used as input to R3. */
  allSessionPoapTokenIds: { sessionAddr: `0x${string}`; tokenIds: bigint[] }[]
}

async function runRound2(
  sessionAddrs: readonly `0x${string}`[],
  festPoapTokenIds: readonly bigint[],
  userAddress: `0x${string}` | null,
  at?: 'best' | 'finalized',
): Promise<Round2Result> {
  if (sessionAddrs.length === 0 && festPoapTokenIds.length === 0) {
    return { allSessionPoapTokenIds: [] }
  }

  // One Multicall: per-session details/attendees/POAP-token-list, plus
  // getPOAPData for each festival POAP token.
  const sessionCalls = sessionAddrs.flatMap((addr) => [
    { address: addr, abi: FestivalSessionABI, functionName: 'getEventDetails' },
    { address: addr, abi: FestivalSessionABI, functionName: 'getAttendees' },
    { address: SUB_EVENT_POAP_ADDRESS, abi: AttendancePOAPABI, functionName: 'getTokensBySource', args: [addr] },
    { address: addr, abi: FestivalSessionABI, functionName: 'flagCount' },
    { address: addr, abi: FestivalSessionABI, functionName: 'FLAG_THRESHOLD' },
  ])
  const festPoapCalls = festPoapTokenIds.map((id) => ({
    address: FESTIVAL_POAP_ADDRESS,
    abi: AttendancePOAPABI,
    functionName: 'getPOAPData',
    args: [id],
  }))

  const calls = [...sessionCalls, ...festPoapCalls]
  const results = await batchRead(calls, { at })

  // 5 calls per session.
  const STRIDE = 5
  const sessionEntries: SessionEntry[] = sessionAddrs.map((address, i) => {
    const off = i * STRIDE
    const detailsRaw = results[off] as readonly [
      `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`,
      bigint, bigint,
      boolean, bigint,
    ]
    const attendeesRaw = results[off + 1] as readonly [`0x${string}`[], boolean[]]
    const tokenIds = results[off + 2] as readonly bigint[]

    const details: SessionDetails = {
      metadataCid: detailsRaw[0],
      creator: detailsRaw[1],
      poapContract: detailsRaw[2],
      parentFestival: detailsRaw[3],
      startTime: detailsRaw[4],
      endTime: detailsRaw[5],
      cancelled: detailsRaw[6],
      registeredCount: detailsRaw[7],
      flagCount: results[off + 3] as bigint,
      flagThreshold: results[off + 4] as bigint,
    }

    return {
      address,
      details,
      metadata: null,
      attendees: attendeesRaw[0].map((a, idx) => ({
        address: a,
        isCheckedIn: attendeesRaw[1][idx] ?? false,
      })),
      poapTokenIds: [...tokenIds],
    }
  })

  festivalState.sessions = mergeSessions(festivalState.sessions, sessionEntries)

  // Festival POAP data, filtered to the connected user. Union with what we
  // already hold: mints are monotonic, so a stale read can't drop a POAP.
  const festPoapDataOffset = sessionAddrs.length * STRIDE
  const userLower = userAddress?.toLowerCase() ?? null
  if (userStillCurrent(userAddress)) {
    festivalState.user.festivalPoaps = mergePoaps(
      festivalState.user.festivalPoaps,
      festPoapTokenIds
        .map((tokenId, idx) => {
          const data = results[festPoapDataOffset + idx] as POAPData
          return { poapContract: FESTIVAL_POAP_ADDRESS, tokenId, data }
        })
        .filter((entry) =>
          userLower ? entry.data.attendee.toLowerCase() === userLower : false,
        ),
    )
  }

  // Per-session Bulletin metadata fetches; off-chain, no chainHead rate cost.
  const metadataTargets = sessionEntries.filter((e) => isNonZeroCid(e.details.metadataCid))
  void fetchInChunks(metadataTargets, (e) =>
    fetchSessionMetadata(e.address, e.details.metadataCid),
  )

  // Token ids with a back-pointer to their session, feeding R3.
  const allSessionPoapTokenIds = sessionEntries
    .filter((e) => e.poapTokenIds.length > 0)
    .map((e) => ({ sessionAddr: e.address, tokenIds: e.poapTokenIds }))

  return { allSessionPoapTokenIds }
}

async function runRound3(
  bundles: { sessionAddr: `0x${string}`; tokenIds: bigint[] }[],
  userAddress: `0x${string}` | null,
  at?: 'best' | 'finalized',
): Promise<void> {
  // SessionPOAP is one shared contract, so only the token id varies.
  const calls = bundles.flatMap(({ tokenIds }) =>
    tokenIds.map((id) => ({
      address: SUB_EVENT_POAP_ADDRESS,
      abi: AttendancePOAPABI,
      functionName: 'getPOAPData',
      args: [id],
    })),
  )

  if (calls.length === 0) return

  const results = await batchRead(calls, { at })

  // Reconstruct in call-list order.
  const userLower = userAddress?.toLowerCase() ?? null
  const flat: { tokenId: bigint; data: POAPData }[] = []
  let i = 0
  for (const { tokenIds } of bundles) {
    for (const tokenId of tokenIds) {
      flat.push({ tokenId, data: results[i] as POAPData })
      i++
    }
  }

  if (userStillCurrent(userAddress)) {
    festivalState.user.sessionPoaps = mergePoaps(
      festivalState.user.sessionPoaps,
      flat
        .filter((f) =>
          userLower ? f.data.attendee.toLowerCase() === userLower : false,
        )
        .map((f) => ({
          poapContract: SUB_EVENT_POAP_ADDRESS,
          tokenId: f.tokenId,
          data: f.data,
        })),
    )
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
    if (entry) {
      entry.metadata = hydrateSubEventMetadata(raw)
    }
  } catch (e) {
    console.warn(`[bootLoadAttendee] session ${sessionAddr.slice(0, 10)} metadata fetch failed:`, e)
  }
}

async function fetchFestivalMetadata(cid: `0x${string}`): Promise<void> {
  try {
    const { retrievePlaintext } = useBulletinStorage()
    const meta = await retrievePlaintext<FestivalMetadata>(cid)
    // Guarded on the CID we fetched, so a slow read can't clobber a newer update.
    applyFestivalMetadata(meta, cid)
  } catch (e) {
    console.warn('[bootLoadAttendee] festival metadata fetch failed:', e)
  }
}
