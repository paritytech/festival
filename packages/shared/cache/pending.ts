import { reactive, watch, effectScope } from 'vue'
import type { SubEventMetadata } from '../metadata/schemas'
import { festivalState, type SessionEntry } from './festival-state'

/**
 * Pending overlay — the per-actor optimistic tier.
 *
 * When this device submits a transaction, we add a pending entry so the UI
 * reflects the action instantly. The entry is the ONLY downgrade path that the
 * UI honours: it's dropped when the action fails on this device, or promoted
 * away once the confirmed tier (chain reads / best-block events) catches up.
 * A lagging or out-of-order read can never revert it — that's the confirmed
 * tier's monotonic merge job. Pending lives only in memory: a mid-tx app kill
 * leaves no phantom state, because the chain event (success-gated) is what
 * makes it permanent.
 */

export type PendingKind = 'register' | 'checkin' | 'session' | 'cancelSession' | 'editSession'

interface PendingEntry {
  kind: PendingKind
  /**
   * Lowercased id: an attendee address ('register'/'checkin'), an
   * `<attendee>@<session>` pair for session-scoped check-ins, a session
   * metadata CID ('session'), or a session address ('cancelSession'/'editSession').
   */
  id: string
  /** Draft session to render immediately (only for kind === 'session'). */
  session?: SessionEntry
  /** Draft metadata + new CID for an in-flight session edit (kind === 'editSession'). */
  edit?: { metadata: SubEventMetadata | null; metadataCid: `0x${string}` }
}

/** Id for a check-in scoped to a session contract rather than the festival. */
export function sessionScopedId(attendee: string, sessionAddress: string): string {
  return `${attendee.toLowerCase()}@${sessionAddress.toLowerCase()}`
}

const pending = reactive(new Map<string, PendingEntry>())

function keyOf(kind: PendingKind, id: string): string {
  return `${kind}:${id.toLowerCase()}`
}

export function addPending(
  kind: PendingKind,
  id: string,
  session?: SessionEntry,
  edit?: PendingEntry['edit'],
): void {
  pending.set(keyOf(kind, id), { kind, id: id.toLowerCase(), session, edit })
}

export function dropPending(kind: PendingKind, id: string): void {
  pending.delete(keyOf(kind, id))
}

export function hasPending(kind: PendingKind, id: string): boolean {
  return pending.has(keyOf(kind, id))
}

/** Draft sessions to splice into the session list while their tx is in flight. */
export function pendingSessions(): SessionEntry[] {
  const out: SessionEntry[] = []
  for (const e of pending.values()) if (e.session) out.push(e.session)
  return out
}

/** Draft metadata for a session whose edit (updateCid) tx is in flight. */
export function pendingSessionEdit(
  sessionAddress: string,
): { metadata: SubEventMetadata | null; metadataCid: `0x${string}` } | null {
  return pending.get(keyOf('editSession', sessionAddress))?.edit ?? null
}

/** Festival-scoped check-ins in flight (lowercased attendee addresses). */
export function pendingCheckins(): string[] {
  const out: string[] = []
  for (const e of pending.values()) {
    if (e.kind === 'checkin' && !e.id.includes('@')) out.push(e.id)
  }
  return out
}

/** Check-ins in flight for one session (lowercased attendee addresses). */
export function pendingSessionCheckins(sessionAddress: string): string[] {
  const suffix = `@${sessionAddress.toLowerCase()}`
  const out: string[] = []
  for (const e of pending.values()) {
    if (e.kind === 'checkin' && e.id.endsWith(suffix)) out.push(e.id.slice(0, -suffix.length))
  }
  return out
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

/**
 * Draft entry for a session whose create tx is in flight. The address is a
 * placeholder derived from the metadata CID (unique + stable for list keys);
 * the confirmed entry carries the real address and supersedes the draft.
 */
export function draftSessionEntry(
  metadataCid: `0x${string}`,
  startTime: bigint,
  endTime: bigint,
  creator: `0x${string}`,
  metadata: SubEventMetadata | null = null,
): SessionEntry {
  return {
    address: `0x${metadataCid.slice(2, 42)}` as `0x${string}`,
    details: {
      metadataCid,
      creator,
      poapContract: ZERO_ADDR,
      parentFestival: festivalState.festival?.address ?? ZERO_ADDR,
      startTime,
      endTime,
      cancelled: false,
      registeredCount: 0n,
      flagCount: 0n,
      flagThreshold: 0n,
    },
    metadata,
    attendees: [],
    poapTokenIds: [],
  }
}

/** True once the confirmed tier reflects a pending entry (so it can be dropped). */
function isConfirmed(entry: PendingEntry): boolean {
  const fest = festivalState.festival
  switch (entry.kind) {
    case 'register':
      return Boolean(fest?.attendees.some((a) => a.address.toLowerCase() === entry.id))
    case 'checkin': {
      const [attendee, sessionAddr] = entry.id.split('@')
      if (sessionAddr) {
        const session = festivalState.sessions.find(
          (s) => s.address.toLowerCase() === sessionAddr,
        )
        return Boolean(
          session?.attendees.find((a) => a.address.toLowerCase() === attendee)?.isCheckedIn,
        )
      }
      return Boolean(
        fest?.attendees.find((a) => a.address.toLowerCase() === attendee)?.isCheckedIn,
      )
    }
    case 'session':
      // Skip cancelled sessions. Recreating one with the same metadata gives
      // the same CID and the old entry must not swallow the new draft.
      return festivalState.sessions.some(
        (s) => !s.details.cancelled && s.details.metadataCid.toLowerCase() === entry.id,
      )
    case 'cancelSession':
      return Boolean(
        festivalState.sessions.find((s) => s.address.toLowerCase() === entry.id)?.details
          .cancelled,
      )
    case 'editSession':
      // Confirmed once the session's CID on chain matches the edited one.
      return Boolean(
        festivalState.sessions.find(
          (s) =>
            s.address.toLowerCase() === entry.id &&
            s.details.metadataCid.toLowerCase() === entry.edit?.metadataCid.toLowerCase(),
        ),
      )
  }
}

let reconcileStarted = false

/**
 * Promotion/GC: drop any pending entry the confirmed tier now covers. Idempotent;
 * call once at app boot. Driven by a deep watch on festivalState so promotion
 * happens the instant a chain read or event lands.
 */
export function startPendingReconcile(): void {
  if (reconcileStarted || typeof window === 'undefined') return
  reconcileStarted = true
  // Own detached scope so the GC survives the calling layout unmounting.
  effectScope(true).run(() => {
    watch(
      () => [festivalState.festival, festivalState.sessions],
      () => {
        for (const [k, entry] of pending) {
          if (isConfirmed(entry)) pending.delete(k)
        }
      },
      { deep: true },
    )
  })
}
