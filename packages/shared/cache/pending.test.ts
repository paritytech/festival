import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import {
  addPending,
  dropPending,
  hasPending,
  pendingSessions,
  pendingSessionEdit,
  pendingCheckins,
  sessionScopedId,
  draftSessionEntry,
  startPendingReconcile,
} from './pending'
import {
  festivalState,
  resetFestivalState,
  applyRegistered,
  type SessionEntry,
} from './festival-state'

// startPendingReconcile is window-gated (app-runtime guard); node:test runs
// this file in its own process, so the stub is contained.
;(globalThis as any).window = (globalThis as any).window ?? {}
startPendingReconcile()

const USER = '0x00000000000000000000000000000000000000Aa'
const SESSION_ADDR = '0x00000000000000000000000000000000000000bb' as `0x${string}`
const CID = '0x' + 'ab'.repeat(32) as `0x${string}`
const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`

function seedFestival(attendees: { address: `0x${string}`; isCheckedIn: boolean }[]) {
  festivalState.festival = {
    address: ZERO,
    details: {
      metadataCid: ('0x' + '00'.repeat(32)) as `0x${string}`,
      creator: ZERO,
      festivalPoapContract: ZERO,
      sessionPoapContract: ZERO,
      startTime: 0n,
      endTime: 0n,
      sessionsEnabled: true,
      capacity: 0,
      cancelled: false,
      registeredCount: BigInt(attendees.length),
    },
    metadata: null,
    attendees,
  }
}

function session(over: Partial<{ cancelled: boolean; metadataCid: `0x${string}` }>): SessionEntry {
  return {
    address: SESSION_ADDR,
    details: {
      metadataCid: over.metadataCid ?? (('0x' + '00'.repeat(32)) as `0x${string}`),
      creator: ZERO,
      poapContract: ZERO,
      parentFestival: ZERO,
      startTime: 0n,
      endTime: 0n,
      cancelled: over.cancelled ?? false,
      registeredCount: 0n,
      flagCount: 0n,
      flagThreshold: 5n,
    },
    metadata: null,
    attendees: [],
    poapTokenIds: [],
  }
}

test('applyRegistered is idempotent: replayed events cannot inflate registeredCount', () => {
  resetFestivalState()
  seedFestival([])
  applyRegistered(USER as `0x${string}`)
  applyRegistered(USER as `0x${string}`)
  assert.equal(festivalState.festival!.details.registeredCount, 1n)
  assert.equal(festivalState.festival!.attendees.length, 1)
  // Row already known from a read that counted it → no double count.
  seedFestival([{ address: USER as `0x${string}`, isCheckedIn: false }])
  festivalState.festival!.details.registeredCount = 1n
  applyRegistered(USER as `0x${string}`)
  assert.equal(festivalState.festival!.details.registeredCount, 1n)
})

test('add / has / drop, id case-insensitive', () => {
  resetFestivalState()
  addPending('register', USER)
  assert.equal(hasPending('register', USER.toLowerCase()), true)
  assert.equal(hasPending('register', USER.toUpperCase().replace('0X', '0x')), true)
  dropPending('register', USER)
  assert.equal(hasPending('register', USER), false)
})

test('pendingSessions returns only entries carrying a draft session', () => {
  resetFestivalState()
  addPending('register', USER)
  addPending('session', CID, session({ metadataCid: CID }))
  const drafts = pendingSessions()
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0]!.address, SESSION_ADDR)
  dropPending('register', USER)
  dropPending('session', CID)
})

test('register promotes (GC) once the attendee row confirms', async () => {
  resetFestivalState()
  await nextTick()
  addPending('register', USER)
  seedFestival([])
  await nextTick()
  assert.equal(hasPending('register', USER), true, 'no row yet — pending survives')
  seedFestival([{ address: USER as `0x${string}`, isCheckedIn: false }])
  await nextTick()
  assert.equal(hasPending('register', USER), false, 'row confirmed — promoted')
})

test('checkin survives a registered-only row, promotes on isCheckedIn', async () => {
  resetFestivalState()
  await nextTick()
  addPending('checkin', USER)
  seedFestival([{ address: USER as `0x${string}`, isCheckedIn: false }])
  await nextTick()
  assert.equal(hasPending('checkin', USER), true)
  seedFestival([{ address: USER as `0x${string}`, isCheckedIn: true }])
  await nextTick()
  assert.equal(hasPending('checkin', USER), false)
})

test('session promotes when a confirmed session carries the metadata CID', async () => {
  resetFestivalState()
  await nextTick()
  addPending('session', CID, session({ metadataCid: CID }))
  festivalState.sessions = [session({ metadataCid: CID })]
  await nextTick()
  assert.equal(hasPending('session', CID), false)
})

test('a cancelled session with the same CID does not promote a recreate draft', async () => {
  resetFestivalState()
  await nextTick()
  addPending('session', CID, session({ metadataCid: CID }))
  festivalState.sessions = [session({ metadataCid: CID, cancelled: true })]
  await nextTick()
  assert.equal(hasPending('session', CID), true, 'cancelled predecessor must not swallow the draft')
  dropPending('session', CID)
})

test('session-scoped checkin promotes off the session attendees, not the festival', async () => {
  resetFestivalState()
  await nextTick()
  const id = sessionScopedId(USER, SESSION_ADDR)
  addPending('checkin', id)
  // Festival-level check-in must NOT promote a session-scoped entry.
  seedFestival([{ address: USER as `0x${string}`, isCheckedIn: true }])
  await nextTick()
  assert.equal(hasPending('checkin', id), true)
  assert.deepEqual(pendingCheckins(), [], 'session-scoped entries are not festival check-ins')
  const s = session({})
  s.attendees = [{ address: USER as `0x${string}`, isCheckedIn: true }]
  festivalState.sessions = [s]
  await nextTick()
  assert.equal(hasPending('checkin', id), false)
})

test('draftSessionEntry derives a stable placeholder address from the CID', () => {
  const draft = draftSessionEntry(CID, 1n, 2n, USER as `0x${string}`, null)
  assert.equal(draft.address, `0x${CID.slice(2, 42)}`)
  assert.equal(draft.details.metadataCid, CID)
  assert.equal(draft.details.cancelled, false)
})

test('cancelSession promotes when the confirmed session flips cancelled', async () => {
  resetFestivalState()
  await nextTick()
  addPending('cancelSession', SESSION_ADDR)
  festivalState.sessions = [session({ cancelled: false })]
  await nextTick()
  assert.equal(hasPending('cancelSession', SESSION_ADDR), true)
  festivalState.sessions = [session({ cancelled: true })]
  await nextTick()
  assert.equal(hasPending('cancelSession', SESSION_ADDR), false)
})

const CID_NEW = ('0x' + 'cd'.repeat(32)) as `0x${string}`
const EDIT_META = {
  version: '1.0' as const,
  type: 'sub-event' as const,
  name: 'Edited',
  description: '',
  location: '',
  speakers: [],
}

test('editSession exposes draft metadata via pendingSessionEdit; drop clears it', () => {
  resetFestivalState()
  addPending('editSession', SESSION_ADDR, undefined, { metadata: EDIT_META, metadataCid: CID_NEW })
  const edit = pendingSessionEdit(SESSION_ADDR)
  assert.equal(edit?.metadataCid, CID_NEW)
  assert.equal(edit?.metadata?.name, 'Edited')
  // Case-insensitive lookup.
  assert.equal(pendingSessionEdit(SESSION_ADDR.toUpperCase().replace('0X', '0x'))?.metadataCid, CID_NEW)
  dropPending('editSession', SESSION_ADDR)
  assert.equal(pendingSessionEdit(SESSION_ADDR), null)
})

test('editSession promotes once the session CID on chain matches the edit', async () => {
  resetFestivalState()
  await nextTick()
  addPending('editSession', SESSION_ADDR, undefined, { metadata: EDIT_META, metadataCid: CID_NEW })
  // Still on the old CID → edit overlay survives.
  festivalState.sessions = [session({ metadataCid: CID })]
  await nextTick()
  assert.equal(hasPending('editSession', SESSION_ADDR), true)
  // Chain catches up to the edited CID → promoted (GC'd).
  festivalState.sessions = [session({ metadataCid: CID_NEW })]
  await nextTick()
  assert.equal(hasPending('editSession', SESSION_ADDR), false)
})
