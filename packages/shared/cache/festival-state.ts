import { reactive, watch, effectScope } from 'vue'
import type { FestivalDetails, SessionDetails, POAPData } from '../contracts/types'
import type { FestivalMetadata, SubEventMetadata } from '../metadata/schemas'
import type { ContractRole } from '../permissions'
import { getStorage } from './storage'
import { mergeAttendees, mergeSessions, mergePoaps, keepPositive } from './merge'

/**
 * Central festival state. Boot-load fills it; watchers and reconcile mutate it
 * in place; composables expose computed views over it.
 */

export interface AttendeeRow {
  address: `0x${string}`
  isCheckedIn: boolean
}

export interface SessionEntry {
  address: `0x${string}`
  details: SessionDetails
  metadata: SubEventMetadata | null
  attendees: AttendeeRow[]
  /** All POAP token IDs minted by this session (across all attendees). */
  poapTokenIds: bigint[]
}

export interface PoapEntry {
  poapContract: `0x${string}`
  tokenId: bigint
  data: POAPData
}

export interface RoleHolders {
  role: `0x${string}`
  members: `0x${string}`[]
}

export interface FestivalState {
  /** True after the first successful bootLoad completes. */
  loaded: boolean
  /** True while a bootLoad is in flight. */
  loading: boolean
  error: string | null

  festival: {
    address: `0x${string}`
    details: FestivalDetails
    metadata: FestivalMetadata | null
    attendees: AttendeeRow[]
  } | null

  user: {
    address: `0x${string}` | null
    /** Festival POAP token id; 0n if not registered. */
    ticketTokenId: bigint
    /** Festival-level POAPs owned by the user. */
    festivalPoaps: PoapEntry[]
    /** Session-level POAPs owned by the user. */
    sessionPoaps: PoapEntry[]
    /** Admin context only. Roles the user holds on the festival contract. */
    roles: ContractRole[]
  }

  sessions: SessionEntry[]

  /** Admin context only. */
  roles: RoleHolders[]
}

function blankState(): FestivalState {
  return {
    loaded: false,
    loading: false,
    error: null,
    festival: null,
    user: {
      address: null,
      ticketTokenId: 0n,
      festivalPoaps: [],
      sessionPoaps: [],
      roles: [],
    },
    sessions: [],
    roles: [],
  }
}

export const festivalState = reactive<FestivalState>(blankState())

/** Reset to a blank state. Used on wallet logout / full-cache wipe. */
export function resetFestivalState(): void {
  Object.assign(festivalState, blankState())
}

// ── Watcher-event mutation helpers ─────────────────────────────────────────
//
// Called from useFestivalWatcher when chain events arrive. Handlers mutate
// the singleton in place; Vue reactivity propagates to all composable views.

/**
 * Write festival metadata. With expectedCid the write only lands if the festival
 * still points at that CID, so a slow fetch for an older CID (e.g. a lagging
 * bootLoad) can't clobber a newer update. Mirrors {@link applySessionMetadata}.
 */
export function applyFestivalMetadata(
  metadata: FestivalMetadata | null,
  expectedCid?: `0x${string}`,
): void {
  if (!festivalState.festival || !metadata) return
  if (expectedCid && festivalState.festival.details.metadataCid.toLowerCase() !== expectedCid.toLowerCase()) return
  festivalState.festival.metadata = metadata
}

export function applyMetadataUpdated(
  newCid: `0x${string}`,
  newMetadata: FestivalMetadata | null,
): void {
  if (!festivalState.festival) return
  // A failed off-chain fetch arrives as null: keep the last good metadata and
  // CID rather than blanking the festival or advancing past content we can't
  // load. A retry / bootLoad reconciles.
  if (!newMetadata) return
  festivalState.festival.details = {
    ...festivalState.festival.details,
    metadataCid: newCid,
  }
  applyFestivalMetadata(newMetadata, newCid)
}

export function applyRegistered(attendee: `0x${string}`): void {
  if (!festivalState.festival) return
  // Only count rows we have not seen. Reads return the count and the list
  // from the same block, so a known row means the count already includes it.
  // That keeps replayed events from inflating the number.
  const known = festivalState.festival.attendees.some(
    (a) => a.address.toLowerCase() === attendee.toLowerCase(),
  )
  if (!known) {
    festivalState.festival.details = {
      ...festivalState.festival.details,
      registeredCount: festivalState.festival.details.registeredCount + 1n,
    }
    festivalState.festival.attendees = mergeAttendees(festivalState.festival.attendees, [
      { address: attendee, isCheckedIn: false },
    ])
  }
}

export function applyCheckedIn(attendee: `0x${string}`): void {
  if (!festivalState.festival) return
  // CheckedIn implies registered; mergeAttendees latches isCheckedIn true and
  // appends the row if the Registered event was missed.
  festivalState.festival.attendees = mergeAttendees(festivalState.festival.attendees, [
    { address: attendee, isCheckedIn: true },
  ])
}

export function applyCapacityUpdated(newCapacity: number): void {
  if (!festivalState.festival) return
  festivalState.festival.details = {
    ...festivalState.festival.details,
    capacity: newCapacity,
  }
}

export function applyCancelled(): void {
  if (!festivalState.festival) return
  festivalState.festival.details = {
    ...festivalState.festival.details,
    cancelled: true,
  }
}

/**
 * SessionCreated event. We don't have full session details until the next
 * reload. Push a stub entry so consumers see the address immediately;
 * R2 of the next bootLoad fills in details/attendees/poapTokenIds.
 */
export function applySessionCreated(
  sessionAddress: `0x${string}`,
  creator: `0x${string}`,
  metadataCid: `0x${string}`,
): void {
  // The watcher replays this event on resubscribe, so an entry we already
  // hold may carry a NEWER cid than the creation one. Keep what we have in
  // that case, the event only seeds brand new or zero stub entries.
  const existing = festivalState.sessions.find(
    (s) => s.address.toLowerCase() === sessionAddress.toLowerCase(),
  )
  const cid =
    existing && !/^0x0+$/.test(existing.details.metadataCid)
      ? existing.details.metadataCid
      : metadataCid

  festivalState.sessions = mergeSessions(festivalState.sessions, [
    {
      address: sessionAddress,
      details: {
        metadataCid: cid,
        creator,
        poapContract: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        parentFestival: festivalState.festival?.address ?? '0x0000000000000000000000000000000000000000' as `0x${string}`,
        startTime: 0n,
        endTime: 0n,
        cancelled: false,
        registeredCount: 0n,
        flagCount: 0n,
        flagThreshold: 0n,
      },
      metadata: null,
      attendees: [],
      poapTokenIds: [],
    },
  ])
}

/**
 * Merge real on-chain details into a session entry. Used by the SessionCreated
 * handler so a new session carries its true times/cid the moment the event
 * lands (the event itself only seeds a zeroed stub), instead of sorting to the
 * epoch-0 bucket on subject devices until the next bootLoad. Upgrade-only via
 * mergeSession: zeros never beat known values.
 */
export function applySessionDetails(
  sessionAddress: `0x${string}`,
  details: SessionDetails,
): void {
  festivalState.sessions = mergeSessions(festivalState.sessions, [
    { address: sessionAddress, details, metadata: null, attendees: [], poapTokenIds: [] },
  ])
}

/**
 * Attach fetched metadata to a session. When expectedCid is given the write
 * only lands if the entry still points at that cid, so a fetch that raced a
 * newer update cannot put old content back.
 */
export function applySessionMetadata(
  sessionAddress: `0x${string}`,
  metadata: SubEventMetadata | null,
  expectedCid?: `0x${string}`,
): void {
  if (!metadata) return
  const entry = festivalState.sessions.find(
    (s) => s.address.toLowerCase() === sessionAddress.toLowerCase(),
  )
  if (!entry) return
  if (expectedCid && entry.details.metadataCid.toLowerCase() !== expectedCid.toLowerCase()) return
  entry.metadata = metadata
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`
const ZERO_CID = ('0x' + '00'.repeat(32)) as `0x${string}`

/** Stub session entry seeded from a session-level event. Zeros never beat
 * real values under mergeSession, so this is safe to merge before R2 lands. */
function sessionStub(
  address: `0x${string}`,
  over: { registeredCount?: bigint; attendees?: AttendeeRow[] } = {},
): SessionEntry {
  return {
    address,
    details: {
      metadataCid: ZERO_CID,
      creator: ZERO_ADDR,
      poapContract: ZERO_ADDR,
      parentFestival: festivalState.festival?.address ?? ZERO_ADDR,
      startTime: 0n,
      endTime: 0n,
      cancelled: false,
      registeredCount: over.registeredCount ?? 0n,
      flagCount: 0n,
      flagThreshold: 0n,
    },
    metadata: null,
    attendees: over.attendees ?? [],
    poapTokenIds: [],
  }
}

/**
 * Session-level Registered. Mirrors {@link applyRegistered}: bump the session's
 * registeredCount only for an attendee row we haven't seen, so a watchBest
 * replay can't inflate it (mergeAttendees never drops the row). R2's maxBig
 * grounds the authoritative count.
 */
export function applySessionRegistered(
  sessionAddress: `0x${string}`,
  attendee: `0x${string}`,
): void {
  const existing = festivalState.sessions.find(
    (s) => s.address.toLowerCase() === sessionAddress.toLowerCase(),
  )
  const known = existing?.attendees.some(
    (a) => a.address.toLowerCase() === attendee.toLowerCase(),
  )
  if (known) return
  const nextCount = (existing?.details.registeredCount ?? 0n) + 1n
  festivalState.sessions = mergeSessions(festivalState.sessions, [
    sessionStub(sessionAddress, {
      registeredCount: nextCount,
      attendees: [{ address: attendee, isCheckedIn: false }],
    }),
  ])
}

/** Session-level CheckedIn. mergeAttendees latches isCheckedIn and appends the
 * row if the Registered event was missed. */
export function applySessionCheckedIn(
  sessionAddress: `0x${string}`,
  attendee: `0x${string}`,
): void {
  festivalState.sessions = mergeSessions(festivalState.sessions, [
    sessionStub(sessionAddress, {
      attendees: [{ address: attendee, isCheckedIn: true }],
    }),
  ])
}

/** Session-level MetadataUpdated. Advances the entry's CID then writes the
 * fetched metadata under the CID-race guard. */
export function applySessionMetadataUpdated(
  sessionAddress: `0x${string}`,
  newCid: `0x${string}`,
  metadata: SubEventMetadata | null,
): void {
  const entry = festivalState.sessions.find(
    (s) => s.address.toLowerCase() === sessionAddress.toLowerCase(),
  )
  if (!entry) return
  // Failed fetch (null): keep the current CID + metadata so a retry / bootLoad
  // reconciles, rather than pointing the entry at content we never loaded.
  if (!metadata) return
  entry.details = { ...entry.details, metadataCid: newCid }
  applySessionMetadata(sessionAddress, metadata, newCid)
}

// ── Persistent cache ───────────────────────────────────────────────────────
//
// Hydrate `festivalState` from localStorage on cold boot so the UI shows
// last-known data (isCheckedIn, badges, role) instantly while bootLoad
// fetches fresh chain state in the background.

const CACHE_KEY_PREFIX = 'festivalState'

// Bump when CachedShape's structure changes incompatibly. A cache written by
// an older shape is dropped on read rather than half-hydrated into the new one.
const CACHE_VERSION = 1

function cacheKey(festivalAddress: string, userH160: string | null): string {
  return `${CACHE_KEY_PREFIX}:${festivalAddress.toLowerCase()}:${userH160?.toLowerCase() ?? 'anon'}`
}

// Pointer to the last user whose state was persisted, so a cold boot can
// hydrate the right cache slot before the wallet has connected.
function lastUserKey(festivalAddress: string): string {
  return `${CACHE_KEY_PREFIX}:lastUser:${festivalAddress.toLowerCase()}`
}

const BIGINT_MARKER = '__bigint__:'

function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return `${BIGINT_MARKER}${value.toString()}`
  return value
}

function bigintReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(BIGINT_MARKER)) {
    return BigInt(value.slice(BIGINT_MARKER.length))
  }
  return value
}

interface CachedShape {
  version: number
  festival: FestivalState['festival']
  user: FestivalState['user']
  sessions: FestivalState['sessions']
  roles: FestivalState['roles']
}

/**
 * Load cached state for the (festival, user) pair into the singleton.
 *
 * Cached data is **merged into** current state, not assigned over it: hydration
 * is async (host storage bridge), so a watcher event or an early chain read may
 * already have landed by the time the cache resolves. The monotonic merge keeps
 * whichever side is fresher, so late hydration can never clobber live state.
 */
export async function hydrateFromCache(
  festivalAddress: `0x${string}`,
  userAddress: `0x${string}` | null,
  opts: { onlyBeforeBoot?: boolean } = {},
): Promise<void> {
  try {
    const raw = await getStorage().readJSON<string>(cacheKey(festivalAddress, userAddress))
    if (!raw || typeof raw !== 'string') return
    // Checked after the await on purpose. The pre boot paint must stand down
    // the moment a real load owns the state, even mid read.
    if (opts.onlyBeforeBoot && (festivalState.loading || festivalState.loaded)) return
    const cached = JSON.parse(raw, bigintReviver) as CachedShape
    if (!cached || typeof cached !== 'object' || cached.version !== CACHE_VERSION) return

    if (cached.festival) {
      const cur = festivalState.festival
      festivalState.festival = cur
        ? { ...cur, attendees: mergeAttendees(cached.festival.attendees, cur.attendees) }
        : cached.festival
    }
    festivalState.sessions = mergeSessions(cached.sessions ?? [], festivalState.sessions)

    // Only touch the user slot when it belongs to the current identity, or
    // when none is set yet. A slow hydrate can land after a boot for another
    // account started and must not overwrite it. For the same identity we
    // merge per field so a stale cache cannot regress fresh reads.
    const slotUser = (userAddress ?? cached.user.address)?.toLowerCase() ?? null
    const curUser = festivalState.user.address?.toLowerCase() ?? null
    if (curUser === null || curUser === slotUser) {
      const cur = festivalState.user
      festivalState.user = {
        address: userAddress ?? cached.user.address,
        ticketTokenId: keepPositive(cached.user.ticketTokenId, cur.ticketTokenId),
        festivalPoaps: mergePoaps(cached.user.festivalPoaps, cur.festivalPoaps),
        sessionPoaps: mergePoaps(cached.user.sessionPoaps, cur.sessionPoaps),
        roles: cur.roles.length ? cur.roles : cached.user.roles,
      }
    }
  } catch {
    // Cache miss / parse error. Silently fall back to chain reads.
  }
}

/** Persist current state for the (festival, user) pair. */
export async function persistToCache(
  festivalAddress: `0x${string}`,
  userAddress: `0x${string}` | null,
): Promise<void> {
  try {
    const blob: CachedShape = {
      version: CACHE_VERSION,
      festival: festivalState.festival,
      user: festivalState.user,
      sessions: festivalState.sessions,
      roles: festivalState.roles,
    }
    const serialized = JSON.stringify(blob, bigintReplacer)
    await getStorage().writeJSON(cacheKey(festivalAddress, userAddress), serialized)
    await getStorage().writeJSON(lastUserKey(festivalAddress), userAddress ?? 'anon')
  } catch (e) {
    console.warn('[festivalState] persistToCache failed:', e)
  }
}

/**
 * Cache-first cold-boot paint, independent of the wallet. Reads the last-known
 * user pointer and hydrates that slot, so the UI shows last-known state
 * immediately even while (or if) wallet connection is still pending. Boot load
 * re-hydrates and reconciles against the chain once the wallet resolves.
 */
export async function hydrateLastKnown(festivalAddress: `0x${string}`): Promise<void> {
  try {
    const last = await getStorage().readJSON<string>(lastUserKey(festivalAddress))
    if (festivalState.loading || festivalState.loaded) return
    const user = last && last !== 'anon' ? (last as `0x${string}`) : null
    await hydrateFromCache(festivalAddress, user, { onlyBeforeBoot: true })
  } catch {
    // No pointer or read error. Nothing to paint, boot load fills state.
  }
}

// ── Persist-on-mutation ──────────────────────────────────────────────────────
//
// Boot load persists on success, but live mutations (watcher events, optimistic
// flips) used to reach the cache only on the next boot. A debounced deep watch
// closes that gap: any mutation to the singleton is written back, so a cold
// restart paints the last-known state regardless of which path produced it.

let persistenceStarted = false
let persistTimer: ReturnType<typeof setTimeout> | null = null
const PERSIST_DEBOUNCE_MS = 1_000

/**
 * Start write back persistence. Call once at app boot, repeat calls no op.
 * The watcher lives in its own detached scope because callers can be layouts
 * that unmount, and it has to outlive them since the once flag blocks a
 * second start.
 */
export function startCachePersistence(): void {
  if (persistenceStarted || typeof window === 'undefined') return
  persistenceStarted = true
  effectScope(true).run(() => {
    watch(
      () => [festivalState.festival, festivalState.sessions, festivalState.user, festivalState.roles],
      () => {
        if (!festivalState.festival?.address || persistTimer !== null) return
        persistTimer = setTimeout(() => {
          persistTimer = null
          const addr = festivalState.festival?.address
          if (addr) void persistToCache(addr, festivalState.user.address)
        }, PERSIST_DEBOUNCE_MS)
      },
      { deep: true },
    )
  })
}
