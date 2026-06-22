import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeAttendees,
  mergeSession,
  mergeSessions,
  mergePoaps,
  mergeTokenIds,
  maxBig,
  keepPositive,
} from './merge'
import type { AttendeeRow, SessionEntry, PoapEntry } from './festival-state'

const A = '0x00000000000000000000000000000000000000aa' as `0x${string}`
const B = '0x00000000000000000000000000000000000000bb' as `0x${string}`
const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`
const CREATOR = '0x00000000000000000000000000000000000000cc' as `0x${string}`

function attendee(address: `0x${string}`, isCheckedIn: boolean): AttendeeRow {
  return { address, isCheckedIn }
}

function session(over: {
  address: `0x${string}`
  details?: Partial<SessionEntry['details']>
  metadata?: SessionEntry['metadata']
  attendees?: AttendeeRow[]
  poapTokenIds?: bigint[]
}): SessionEntry {
  return {
    address: over.address,
    details: {
      metadataCid: ZERO as `0x${string}`,
      creator: ZERO,
      poapContract: ZERO,
      parentFestival: ZERO,
      startTime: 0n,
      endTime: 0n,
      cancelled: false,
      registeredCount: 0n,
      flagCount: 0n,
      flagThreshold: 0n,
      ...over.details,
    } as SessionEntry['details'],
    metadata: over.metadata ?? null,
    attendees: over.attendees ?? [],
    poapTokenIds: over.poapTokenIds ?? [],
  }
}

const realDetails = (over: Partial<SessionEntry['details']> = {}) => ({
  creator: CREATOR,
  startTime: 100n,
  endTime: 200n,
  ...over,
})

test('mergeTokenIds: unions by value, order-preserving, deduped', () => {
  assert.deepEqual(mergeTokenIds([1n, 2n], [2n, 3n]), [1n, 2n, 3n])
  assert.deepEqual(mergeTokenIds([], [5n]), [5n])
})

test('mergeAttendees: check-in latches true regardless of arrival order', () => {
  const checkedIn = [attendee(A, true)]
  const notYet = [attendee(A, false)]
  assert.equal(mergeAttendees(checkedIn, notYet)[0]!.isCheckedIn, true)
  assert.equal(mergeAttendees(notYet, checkedIn)[0]!.isCheckedIn, true)
})

test('mergeAttendees: unions addresses and never drops a known row', () => {
  const merged = mergeAttendees([attendee(A, true)], [attendee(B, false)])
  assert.equal(merged.length, 2)
  assert.equal(merged.find((x) => x.address === A)!.isCheckedIn, true)
})

test('mergeAttendees: address comparison is case-insensitive', () => {
  const upper = { address: A.toUpperCase() as `0x${string}`, isCheckedIn: true }
  const merged = mergeAttendees([upper], [attendee(A, false)])
  assert.equal(merged.length, 1)
  assert.equal(merged[0]!.isCheckedIn, true)
})

test('mergeSession: real details beat a stub regardless of order', () => {
  const stub = session({ address: A })
  const real = session({ address: A, details: realDetails() })
  assert.equal(mergeSession(stub, real).details.creator, CREATOR)
  assert.equal(mergeSession(real, stub).details.creator, CREATOR)
})

test('mergeSession: a SessionCreated event stub (real creator, zeroed rest) cannot regress loaded details', () => {
  // The watcher replays recent blocks on every resubscribe, so this exact
  // merge happens on every app foreground for freshly created sessions.
  const CID = ('0x' + 'cd'.repeat(32)) as `0x${string}`
  const loaded = session({
    address: A,
    details: realDetails({
      poapContract: B,
      metadataCid: CID,
      flagCount: 3n,
      registeredCount: 4n,
      flagThreshold: 3n,
    }),
  })
  const eventStub = session({ address: A, details: { creator: CREATOR, metadataCid: CID } })
  for (const merged of [mergeSession(loaded, eventStub), mergeSession(eventStub, loaded)]) {
    assert.equal(merged.details.startTime, 100n)
    assert.equal(merged.details.endTime, 200n)
    assert.equal(merged.details.poapContract, B)
    assert.equal(merged.details.flagCount, 3n)
    assert.equal(merged.details.registeredCount, 4n)
    assert.equal(merged.details.flagThreshold, 3n)
  }
})

test('mergeSession: flagCount only advances; newest non-zero metadataCid wins', () => {
  const CID_OLD = ('0x' + 'aa'.repeat(32)) as `0x${string}`
  const CID_NEW = ('0x' + 'bb'.repeat(32)) as `0x${string}`
  const prev = session({ address: A, details: realDetails({ flagCount: 4n, metadataCid: CID_OLD }) })
  const staleRead = session({ address: A, details: realDetails({ flagCount: 2n, metadataCid: CID_NEW }) })
  const merged = mergeSession(prev, staleRead)
  assert.equal(merged.details.flagCount, 4n)
  assert.equal(merged.details.metadataCid, CID_NEW)
})

test('mergeSession: cancelled latches and registeredCount only advances', () => {
  const cancelled = session({ address: A, details: realDetails({ cancelled: true, registeredCount: 3n }) })
  const fresh = session({ address: A, details: realDetails({ cancelled: false, registeredCount: 1n }) })
  const merged = mergeSession(cancelled, fresh)
  assert.equal(merged.details.cancelled, true)
  assert.equal(merged.details.registeredCount, 3n)
})

test('mergeSession: non-null metadata is preferred over null either way', () => {
  const withMeta = session({ address: A, details: realDetails(), metadata: { name: 'X' } as any })
  const noMeta = session({ address: A, details: realDetails() })
  assert.deepEqual(mergeSession(noMeta, withMeta).metadata, { name: 'X' })
  assert.deepEqual(mergeSession(withMeta, noMeta).metadata, { name: 'X' })
})

test('mergeSession: poap token ids union without duplicates', () => {
  const a = session({ address: A, details: realDetails(), poapTokenIds: [1n, 2n] })
  const b = session({ address: A, details: realDetails(), poapTokenIds: [2n, 3n] })
  assert.deepEqual(mergeSession(a, b).poapTokenIds.sort(), [1n, 2n, 3n])
})

test('mergeSessions: unions by address and upgrades stubs in place', () => {
  const prev = [session({ address: A }), session({ address: B, details: realDetails() })]
  const incoming = [session({ address: A, details: realDetails() })]
  const merged = mergeSessions(prev, incoming)
  assert.equal(merged.length, 2)
  assert.equal(merged.find((s) => s.address === A)!.details.creator, CREATOR)
})

test('mergePoaps: union by (contract, tokenId), incoming wins on conflict', () => {
  const prev: PoapEntry[] = [{ poapContract: A, tokenId: 1n, data: { v: 'old' } as any }]
  const incoming: PoapEntry[] = [{ poapContract: A, tokenId: 1n, data: { v: 'new' } as any }]
  const merged = mergePoaps(prev, incoming)
  assert.equal(merged.length, 1)
  assert.equal((merged[0]!.data as any).v, 'new')
})

test('maxBig / keepPositive', () => {
  assert.equal(maxBig(3n, 5n), 5n)
  assert.equal(maxBig(5n, 3n), 5n)
  assert.equal(keepPositive(7n, 0n), 7n)
  assert.equal(keepPositive(0n, 7n), 7n)
})
