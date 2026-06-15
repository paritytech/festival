import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveFullLocationLabel,
  resolveShortLocationLabel,
  formatChipFromMarker,
} from '../venue/floors'
import { TYPE_LABELS } from '../venue/categories'
import type { VenueMarker } from '../metadata/schemas'

// Icon-only categories (service / emergency / money / scenery) save with an
// empty label by design. Every text rendering of such a marker must fall back
// to its type label ("Restroom", "ATM", …) instead of showing a blank or
// "Custom location".
const restroom: VenueMarker = {
  id: 'wc1',
  label: '',
  x: 10,
  y: 10,
  floorId: 'venue',
  category: 'service',
  type: 'restroom',
}

const stage: VenueMarker = {
  id: 'stage1',
  label: 'Main Stage',
  x: 20,
  y: 20,
  floorId: 'venue',
  category: 'base',
  type: 'stage',
}

test('label-less marker: full label falls back to the type label', () => {
  const label = resolveFullLocationLabel(restroom.id, [restroom], [])
  assert.ok(
    label.includes(TYPE_LABELS.restroom),
    `expected "${label}" to include "${TYPE_LABELS.restroom}"`,
  )
})

test('label-less marker: short label falls back to the type label', () => {
  const label = resolveShortLocationLabel(restroom.id, [restroom], [])
  assert.ok(
    label.includes(TYPE_LABELS.restroom),
    `expected "${label}" to include "${TYPE_LABELS.restroom}"`,
  )
})

test('label-less marker: popup chip headline is the type label, not blank', () => {
  const chip = formatChipFromMarker(restroom, [])
  assert.equal(chip.headline, TYPE_LABELS.restroom)
  assert.notEqual(chip.headline, '')
})

test('named marker: keeps its own label over the type label', () => {
  assert.equal(formatChipFromMarker(stage, []).headline, 'Main Stage')
  assert.ok(resolveFullLocationLabel(stage.id, [stage], []).includes('Main Stage'))
})
