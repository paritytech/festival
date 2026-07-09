import type { AttendeeRow, SessionEntry, PoapEntry } from './festival-state'

/**
 * Pure, order-independent merge helpers for the confirmed state tier.
 *
 * Every field is merged **upgrade-only**: a monotonic positive (a check-in, a
 * registration, a higher count, real details over a stub) is never regressed.
 * This makes a lagging or out-of-order chain read unable to clobber fresher
 * state — the root cause behind the onboarding check-in flipping back to
 * false. The only accepted cost is that a value reorged out on chain stays
 * "true" locally until the contract emits a contradicting state, which for
 * monotonic festival actions (check-in, registration, POAP mint, cancellation)
 * cannot happen.
 */

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

function lc(addr: string): string {
  return addr.toLowerCase()
}

/** Take the incoming value unless it is a stub zero. Newest real value wins. */
function nonZeroHex<T extends string>(prev: T, incoming: T): T {
  return /^0x0+$/.test(incoming) ? prev : incoming
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

/** Once the ticket id is positive, keep it positive; a fresh positive wins. */
export function keepPositive(prev: bigint, incoming: bigint): bigint {
  return incoming > 0n ? incoming : prev
}

/** Union of two token-id lists, order-preserving, dedup by value. */
export function mergeTokenIds(a: readonly bigint[], b: readonly bigint[]): bigint[] {
  const seen = new Set<bigint>(a)
  const out = [...a]
  for (const x of b) {
    if (!seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  return out
}

/** Union by lowercased address; `isCheckedIn` latches true; never drops a row. */
export function mergeAttendees(
  prev: readonly AttendeeRow[],
  incoming: readonly AttendeeRow[],
): AttendeeRow[] {
  const byAddr = new Map<string, AttendeeRow>()
  for (const a of prev) byAddr.set(lc(a.address), { ...a })
  for (const a of incoming) {
    const k = lc(a.address)
    const existing = byAddr.get(k)
    if (existing) existing.isCheckedIn = existing.isCheckedIn || a.isCheckedIn
    else byAddr.set(k, { ...a })
  }
  return [...byAddr.values()]
}

/** Union by (contract, tokenId); incoming wins on conflict (fresher POAP data). */
export function mergePoaps(
  prev: readonly PoapEntry[],
  incoming: readonly PoapEntry[],
): PoapEntry[] {
  const byKey = new Map<string, PoapEntry>()
  for (const p of prev) byKey.set(`${lc(p.poapContract)}:${p.tokenId}`, p)
  for (const p of incoming) byKey.set(`${lc(p.poapContract)}:${p.tokenId}`, p)
  return [...byKey.values()]
}

/**
 * Merge field by field so arrival order never matters. The watcher replays
 * recent blocks whenever it resubscribes, so an event stub with zeroed times
 * can land after the full read. Zeros never beat known values and the
 * monotonic fields only move forward.
 */
export function mergeSession(
  prev: SessionEntry | undefined,
  incoming: SessionEntry,
): SessionEntry {
  if (!prev) return incoming

  const a = prev.details
  const b = incoming.details

  return {
    address: prev.address,
    details: {
      metadataCid: nonZeroHex(a.metadataCid, b.metadataCid),
      creator: nonZeroHex(a.creator, b.creator),
      poapContract: nonZeroHex(a.poapContract, b.poapContract),
      parentFestival: nonZeroHex(a.parentFestival, b.parentFestival),
      startTime: keepPositive(a.startTime, b.startTime),
      endTime: keepPositive(a.endTime, b.endTime),
      cancelled: a.cancelled || b.cancelled,
      registeredCount: maxBig(a.registeredCount, b.registeredCount),
      flagCount: maxBig(a.flagCount, b.flagCount),
      flagThreshold: keepPositive(a.flagThreshold, b.flagThreshold),
    },
    metadata: incoming.metadata ?? prev.metadata,
    attendees: mergeAttendees(prev.attendees, incoming.attendees),
    poapTokenIds: mergeTokenIds(prev.poapTokenIds, incoming.poapTokenIds),
  }
}

/** Union by address; each address merged via {@link mergeSession}. */
export function mergeSessions(
  prev: readonly SessionEntry[],
  incoming: readonly SessionEntry[],
): SessionEntry[] {
  const byAddr = new Map<string, SessionEntry>()
  for (const s of prev) byAddr.set(lc(s.address), s)
  for (const s of incoming) {
    const k = lc(s.address)
    byAddr.set(k, mergeSession(byAddr.get(k), s))
  }
  return [...byAddr.values()]
}
