import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  festivalState,
  resetFestivalState,
  applyMetadataUpdated,
  applyFestivalMetadata,
  applySessionCheckedIn,
  applySessionMetadataUpdated,
} from './festival-state'
import type { FestivalMetadata, SubEventMetadata } from '../metadata/schemas'

const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`
const S = '0x00000000000000000000000000000000000000a1' as `0x${string}`
const A = '0x00000000000000000000000000000000000000aa' as `0x${string}`
const C1 = ('0x' + '11'.repeat(32)) as `0x${string}`
const C2 = ('0x' + '22'.repeat(32)) as `0x${string}`

const festMeta = (name: string) => ({ name } as unknown as FestivalMetadata)
const subMeta = (name: string) =>
  ({ version: '1.0', type: 'sub-event', name, description: '', location: '', speakers: [] } as SubEventMetadata)

function seedFestival(cid: `0x${string}`, metadata: FestivalMetadata | null) {
  festivalState.festival = {
    address: ZERO,
    details: {
      metadataCid: cid, creator: ZERO, festivalPoapContract: ZERO, sessionPoapContract: ZERO,
      startTime: 0n, endTime: 0n, sessionsEnabled: true, capacity: 0, cancelled: false, registeredCount: 0n,
    },
    metadata,
    attendees: [],
  }
}

test('S6: a failed metadata fetch (null) does not blank the festival or advance the CID', () => {
  resetFestivalState()
  seedFestival(C1, festMeta('Original'))
  applyMetadataUpdated(C2, null)
  assert.equal(festivalState.festival!.metadata!.name, 'Original')
  assert.equal(festivalState.festival!.details.metadataCid, C1)
})

test('a successful metadata update advances both CID and content', () => {
  resetFestivalState()
  seedFestival(C1, festMeta('Original'))
  applyMetadataUpdated(C2, festMeta('Updated'))
  assert.equal(festivalState.festival!.metadata!.name, 'Updated')
  assert.equal(festivalState.festival!.details.metadataCid, C2)
})

test('S8: a stale fetch for an older CID cannot clobber newer state', () => {
  resetFestivalState()
  seedFestival(C2, festMeta('Updated'))
  applyFestivalMetadata(festMeta('Stale'), C1) // entry is at C2 — dropped
  assert.equal(festivalState.festival!.metadata!.name, 'Updated')
})

test('S7: a failed session metadata fetch keeps the current CID and metadata', () => {
  resetFestivalState()
  applySessionCheckedIn(S, A) // seed the entry
  applySessionMetadataUpdated(S, C1, subMeta('First'))
  applySessionMetadataUpdated(S, C2, null) // failed fetch
  const e = festivalState.sessions.find((s) => s.address.toLowerCase() === S.toLowerCase())
  assert.equal(e?.details.metadataCid, C1)
  assert.equal(e?.metadata?.name, 'First')
})
