import { reactive } from 'vue'
import type { FestivalDetails, SessionDetails, POAPData } from '../contracts/types'
import type { FestivalMetadata, SubEventMetadata } from '../metadata/schemas'
import type { ContractRole } from '../permissions'
import { getStorage } from './storage'

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

export function applyMetadataUpdated(
  newCid: `0x${string}`,
  newMetadata: FestivalMetadata | null,
): void {
  if (!festivalState.festival) return
  festivalState.festival.metadata = newMetadata
  festivalState.festival.details = {
    ...festivalState.festival.details,
    metadataCid: newCid,
  }
}

export function applyRegistered(attendee: `0x${string}`): void {
  if (!festivalState.festival) return
  festivalState.festival.details = {
    ...festivalState.festival.details,
    registeredCount: festivalState.festival.details.registeredCount + 1n,
  }
  const lower = attendee.toLowerCase()
  const exists = festivalState.festival.attendees.some(
    (a) => a.address.toLowerCase() === lower,
  )
  if (!exists) {
    festivalState.festival.attendees.push({ address: attendee, isCheckedIn: false })
  }
}

export function applyCheckedIn(attendee: `0x${string}`): void {
  if (!festivalState.festival) return
  const lower = attendee.toLowerCase()
  const row = festivalState.festival.attendees.find(
    (a) => a.address.toLowerCase() === lower,
  )
  if (row) {
    row.isCheckedIn = true
  } else {
    // CheckedIn implies the attendee is registered. Append both states.
    festivalState.festival.attendees.push({ address: attendee, isCheckedIn: true })
  }
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
  const exists = festivalState.sessions.some(
    (s) => s.address.toLowerCase() === sessionAddress.toLowerCase(),
  )
  if (exists) return
  festivalState.sessions.push({
    address: sessionAddress,
    details: {
      metadataCid,
      creator,
      poapContract: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      parentFestival: festivalState.festival?.address ?? '0x0000000000000000000000000000000000000000' as `0x${string}`,
      startTime: 0n,
      endTime: 0n,
      cancelled: false,
      registeredCount: 0n,
      flagCount: 0n,
      flagThreshold: 5n,
    },
    metadata: null,
    attendees: [],
    poapTokenIds: [],
  })
}

// ── Persistent cache ───────────────────────────────────────────────────────
//
// Hydrate `festivalState` from localStorage on cold boot so the UI shows
// last-known data (isCheckedIn, badges, role) instantly while bootLoad
// fetches fresh chain state in the background.

const CACHE_KEY_PREFIX = 'festivalState'

function cacheKey(festivalAddress: string, userH160: string | null): string {
  return `${CACHE_KEY_PREFIX}:${festivalAddress.toLowerCase()}:${userH160?.toLowerCase() ?? 'anon'}`
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
  festival: FestivalState['festival']
  user: FestivalState['user']
  sessions: FestivalState['sessions']
  roles: FestivalState['roles']
}

/** Load cached state for the (festival, user) pair, if any, into the singleton. */
export async function hydrateFromCache(
  festivalAddress: `0x${string}`,
  userAddress: `0x${string}` | null,
): Promise<void> {
  try {
    const raw = await getStorage().readJSON<string>(cacheKey(festivalAddress, userAddress))
    if (!raw || typeof raw !== 'string') return
    const cached = JSON.parse(raw, bigintReviver) as CachedShape
    if (!cached || typeof cached !== 'object') return
    festivalState.festival = cached.festival
    festivalState.user = cached.user
    festivalState.sessions = cached.sessions
    festivalState.roles = cached.roles
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
      festival: festivalState.festival,
      user: festivalState.user,
      sessions: festivalState.sessions,
      roles: festivalState.roles,
    }
    const serialized = JSON.stringify(blob, bigintReplacer)
    await getStorage().writeJSON(cacheKey(festivalAddress, userAddress), serialized)
  } catch (e) {
    console.warn('[festivalState] persistToCache failed:', e)
  }
}
