import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  festivalState,
  resetFestivalState,
  applySessionRegistered,
  applySessionCheckedIn,
  applySessionMetadataUpdated,
  type SessionEntry,
} from './festival-state'
import { mergeSessions } from './merge'

const S = '0x00000000000000000000000000000000000000a1' as `0x${string}`
const A = '0x00000000000000000000000000000000000000aa' as `0x${string}`
const B = '0x00000000000000000000000000000000000000bb' as `0x${string}`
const CREATOR = '0x00000000000000000000000000000000000000cc' as `0x${string}`
const CID_NEW = ('0x' + '11'.repeat(32)) as `0x${string}`
const ZERO_CID = ('0x' + '00'.repeat(32)) as `0x${string}`
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

function find(addr: `0x${string}`): SessionEntry | undefined {
  return festivalState.sessions.find((s) => s.address.toLowerCase() === addr.toLowerCase())
}

/** A fully-loaded session entry as R2 would write it. */
function realSession(addr: `0x${string}`): SessionEntry {
  return {
    address: addr,
    details: {
      metadataCid: ('0x' + '22'.repeat(32)) as `0x${string}`,
      creator: CREATOR,
      poapContract: A,
      parentFestival: A,
      startTime: 1000n,
      endTime: 2000n,
      cancelled: false,
      registeredCount: 3n,
      flagCount: 0n,
      flagThreshold: 5n,
    },
    metadata: { version: '1.0', type: 'sub-event', name: 'Real', description: '', location: '', speakers: [] },
    attendees: [],
    poapTokenIds: [],
  }
}

test('applySessionCheckedIn latches and is replay-idempotent', () => {
  resetFestivalState()
  applySessionCheckedIn(S, A)
  applySessionCheckedIn(S, A)
  const e = find(S)
  assert.equal(e?.attendees.length, 1)
  assert.equal(e?.attendees[0]?.isCheckedIn, true)
})

test('applySessionRegistered increments count once per unseen attendee', () => {
  resetFestivalState()
  applySessionRegistered(S, A)
  applySessionRegistered(S, A) // replay — already known
  assert.equal(find(S)?.details.registeredCount, 1n)
  applySessionRegistered(S, B)
  assert.equal(find(S)?.details.registeredCount, 2n)
  assert.equal(find(S)?.attendees.length, 2)
})

test('CheckedIn after Registered keeps a single row, checked-in', () => {
  resetFestivalState()
  applySessionRegistered(S, A)
  applySessionCheckedIn(S, A)
  const e = find(S)
  assert.equal(e?.attendees.length, 1)
  assert.equal(e?.attendees[0]?.isCheckedIn, true)
  assert.equal(e?.details.registeredCount, 1n)
})

test('event stub then R2 real details: real values win, check-in preserved', () => {
  resetFestivalState()
  applySessionCheckedIn(S, A)
  festivalState.sessions = mergeSessions(festivalState.sessions, [realSession(S)])
  const e = find(S)
  assert.equal(e?.details.creator, CREATOR)
  assert.equal(e?.details.startTime, 1000n)
  assert.equal(e?.details.registeredCount, 3n) // maxBig(0, 3)
  assert.equal(e?.attendees.find((a) => a.address === A)?.isCheckedIn, true)
})

test('R2 real details then replayed event: no regression', () => {
  resetFestivalState()
  festivalState.sessions = mergeSessions(festivalState.sessions, [realSession(S)])
  applySessionCheckedIn(S, A)
  applySessionRegistered(S, A) // already known via check-in row → no count bump
  const e = find(S)
  assert.equal(e?.details.creator, CREATOR)
  assert.equal(e?.details.metadataCid, ('0x' + '22'.repeat(32)) as `0x${string}`)
  assert.equal(e?.details.registeredCount, 3n)
  assert.equal(e?.attendees.find((a) => a.address === A)?.isCheckedIn, true)
})

test('applySessionMetadataUpdated advances CID and metadata on existing entry', () => {
  resetFestivalState()
  applySessionCheckedIn(S, A)
  const meta = { version: '1.0', type: 'sub-event' as const, name: 'Edited', description: '', location: '', speakers: [] }
  applySessionMetadataUpdated(S, CID_NEW, meta)
  const e = find(S)
  assert.equal(e?.details.metadataCid, CID_NEW)
  assert.equal(e?.metadata?.name, 'Edited')
})

test('applySessionMetadataUpdated is a no-op for an unknown session', () => {
  resetFestivalState()
  applySessionMetadataUpdated(S, CID_NEW, null)
  assert.equal(find(S), undefined)
})
