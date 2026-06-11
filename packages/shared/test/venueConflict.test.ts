import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findVenueConflict,
  findBusyMarkerIds,
} from '../sessions/venueConflict'
import type {
  ScheduleEntry,
  VenueMarker,
} from '../metadata/schemas'
import { encodeCoordLocation } from '../venue/floors'

const FLOOR = 'block-b-first-ground'

function marker(id: string, x: number, y: number): VenueMarker {
  return {
    id,
    label: id,
    x,
    y,
    floorId: FLOOR,
    category: 'base',
    type: 'room',
  }
}

const MARKERS: VenueMarker[] = [
  marker('m-stage', 100, 100),
  marker('m-room', 800, 800),
  // Sits 20 SVG units from m-stage — within the 150-unit nearest-marker cap.
  marker('m-near-stage', 120, 100),
]

function se(
  address: string,
  startSec: number,
  endSec: number,
  location: string,
  name = address,
) {
  return {
    address,
    startTime: startSec,
    endTime: endSec,
    metadata: { name, location },
  }
}

function entry(
  id: string,
  startISO: string,
  endISO: string,
  venueMarkerId: string | undefined,
  title = id,
): ScheduleEntry {
  return {
    id,
    start: startISO,
    end: endISO,
    title,
    description: '',
    speakers: [],
    venueMarkerId,
  }
}

// ── findVenueConflict ────────────────────────────────────────────────────

test('findVenueConflict: returns null when nothing overlaps', () => {
  const result = findVenueConflict(
    'm-stage',
    1000,
    2000,
    [se('0xa', 3000, 4000, 'm-stage')],
    [],
    MARKERS,
  )
  assert.equal(result, null)
})

test('findVenueConflict: detects overlap on a marker-id-based location', () => {
  const result = findVenueConflict(
    'm-stage',
    1500,
    2500,
    [se('0xa', 1000, 2000, 'm-stage', 'Other session')],
    [],
    MARKERS,
  )
  assert.ok(result)
  assert.equal(result.kind, 'session')
  assert.equal(result.title, 'Other session')
  assert.equal(result.startSec, 1000)
  assert.equal(result.endSec, 2000)
})

test('findVenueConflict: resolves coord-based sub-event location via nearest marker', () => {
  // Other session stored as a coord 5 units from m-stage — should snap to m-stage.
  const coord = encodeCoordLocation(FLOOR, 105, 100)
  const result = findVenueConflict(
    'm-stage',
    1000,
    2000,
    [se('0xa', 500, 1500, coord, 'Pin-based session')],
    [],
    MARKERS,
  )
  assert.ok(result)
  assert.equal(result.title, 'Pin-based session')
})

test('findVenueConflict: coord with no nearby marker (beyond 150-unit cap) does not conflict', () => {
  const coord = encodeCoordLocation(FLOOR, 3000, 3000)
  const result = findVenueConflict(
    'm-stage',
    1000,
    2000,
    [se('0xa', 500, 1500, coord)],
    [],
    MARKERS,
  )
  assert.equal(result, null)
})

test('findVenueConflict: endpoint touching is NOT a conflict', () => {
  // Existing ends at 2000, candidate starts at 2000 — back-to-back is allowed.
  const result = findVenueConflict(
    'm-stage',
    2000,
    3000,
    [se('0xa', 1000, 2000, 'm-stage')],
    [],
    MARKERS,
  )
  assert.equal(result, null)
})

test('findVenueConflict: candidate fully inside an existing window is a conflict', () => {
  const result = findVenueConflict(
    'm-stage',
    1200,
    1800,
    [se('0xa', 1000, 2000, 'm-stage')],
    [],
    MARKERS,
  )
  assert.ok(result)
})

test('findVenueConflict: candidate fully covering an existing window is a conflict', () => {
  const result = findVenueConflict(
    'm-stage',
    500,
    3000,
    [se('0xa', 1000, 2000, 'm-stage')],
    [],
    MARKERS,
  )
  assert.ok(result)
})

test('findVenueConflict: different marker does not conflict', () => {
  const result = findVenueConflict(
    'm-stage',
    1000,
    2000,
    [se('0xa', 1000, 2000, 'm-room')],
    [],
    MARKERS,
  )
  assert.equal(result, null)
})

test('findVenueConflict: excludeAddress skips the self-edit case-insensitively', () => {
  const result = findVenueConflict(
    'm-stage',
    1000,
    2000,
    [se('0xABC123', 1000, 2000, 'm-stage')],
    [],
    MARKERS,
    '0xabc123',
  )
  assert.equal(result, null)
})

test('findVenueConflict: excludeAddress only skips the matching one', () => {
  const result = findVenueConflict(
    'm-stage',
    1000,
    2000,
    [
      se('0xabc', 1000, 2000, 'm-stage', 'Mine'),
      se('0xdef', 1500, 2500, 'm-stage', 'Theirs'),
    ],
    [],
    MARKERS,
    '0xabc',
  )
  assert.ok(result)
  assert.equal(result.title, 'Theirs')
})

test('findVenueConflict: detects official schedule entry overlap', () => {
  const entries = [
    entry(
      'sched-1',
      '2026-06-12T10:00:00Z',
      '2026-06-12T11:00:00Z',
      'm-stage',
      'Opening Keynote',
    ),
  ]
  const candStart = Math.floor(new Date('2026-06-12T10:30:00Z').getTime() / 1000)
  const candEnd = Math.floor(new Date('2026-06-12T11:30:00Z').getTime() / 1000)
  const result = findVenueConflict('m-stage', candStart, candEnd, [], entries, MARKERS)
  assert.ok(result)
  assert.equal(result.kind, 'official')
  assert.equal(result.title, 'Opening Keynote')
})

test('findVenueConflict: schedule entry on a different marker does not conflict', () => {
  const entries = [
    entry('sched-1', '2026-06-12T10:00:00Z', '2026-06-12T11:00:00Z', 'm-room'),
  ]
  const candStart = Math.floor(new Date('2026-06-12T10:30:00Z').getTime() / 1000)
  const candEnd = Math.floor(new Date('2026-06-12T11:30:00Z').getTime() / 1000)
  const result = findVenueConflict('m-stage', candStart, candEnd, [], entries, MARKERS)
  assert.equal(result, null)
})

test('findVenueConflict: schedule entry with no venueMarkerId never conflicts', () => {
  const entries = [
    entry('sched-1', '2026-06-12T10:00:00Z', '2026-06-12T11:00:00Z', undefined),
  ]
  const candStart = Math.floor(new Date('2026-06-12T10:30:00Z').getTime() / 1000)
  const candEnd = Math.floor(new Date('2026-06-12T11:30:00Z').getTime() / 1000)
  const result = findVenueConflict('m-stage', candStart, candEnd, [], entries, MARKERS)
  assert.equal(result, null)
})

test('findVenueConflict: returns sub-event before schedule when both overlap', () => {
  const entries = [
    entry(
      'sched-1',
      '2026-06-12T10:00:00Z',
      '2026-06-12T11:00:00Z',
      'm-stage',
      'Opening',
    ),
  ]
  const candStart = Math.floor(new Date('2026-06-12T10:30:00Z').getTime() / 1000)
  const candEnd = Math.floor(new Date('2026-06-12T11:30:00Z').getTime() / 1000)
  const subStart = candStart
  const subEnd = candEnd
  const result = findVenueConflict(
    'm-stage',
    candStart,
    candEnd,
    [se('0xa', subStart, subEnd, 'm-stage', 'Sub')],
    entries,
    MARKERS,
  )
  assert.ok(result)
  assert.equal(result.kind, 'session')
  assert.equal(result.title, 'Sub')
})

// ── findBusyMarkerIds ────────────────────────────────────────────────────

test('findBusyMarkerIds: returns the set of conflicting markers', () => {
  const result = findBusyMarkerIds(
    1500,
    2500,
    ['m-stage', 'm-room'],
    [se('0xa', 1000, 2000, 'm-stage'), se('0xb', 3000, 4000, 'm-room')],
    [],
    MARKERS,
  )
  assert.equal(result.size, 1)
  assert.ok(result.has('m-stage'))
  assert.ok(!result.has('m-room'))
})

test('findBusyMarkerIds: empty when no candidate markers overlap', () => {
  const result = findBusyMarkerIds(
    5000,
    6000,
    ['m-stage', 'm-room'],
    [se('0xa', 1000, 2000, 'm-stage')],
    [],
    MARKERS,
  )
  assert.equal(result.size, 0)
})

test('findBusyMarkerIds: excludeAddress is honored across all candidates', () => {
  // Both markers are booked by the same session we're editing — both should
  // come back free.
  const result = findBusyMarkerIds(
    1500,
    2500,
    ['m-stage'],
    [se('0xMine', 1000, 2000, 'm-stage')],
    [],
    MARKERS,
    '0xmine',
  )
  assert.equal(result.size, 0)
})
