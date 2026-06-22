import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSyncDecision, isPublishConflict } from './useFestivalContext.helpers'

// These cover the bug-prone decision logic behind the admin draft live-sync and
// the publish concurrency guard. The full composable can't be exercised
// end-to-end in node (it uses provide/inject + a real chainHead follow, and the
// test host can't emit MetadataUpdated contract events), so the logic is
// extracted into pure helpers and tested directly.

const C1 = '0x' + '11'.repeat(32)
const C2 = '0x' + '22'.repeat(32)

// Two metadata blobs serialized the way the composable compares them.
const STALE = JSON.stringify({ name: 'stale', schedule: [] })
const FRESH = JSON.stringify({ name: 'fresh', schedule: [{ id: 'a' }] })
const EDITED = JSON.stringify({ name: 'edited', schedule: [{ id: 'a' }] })

// ── computeSyncDecision ──────────────────────────────────────────────────────

test('clean draft adopts fresh metadata', () => {
  const d = computeSyncDecision({ draftJson: STALE, savedJson: STALE, incomingCid: C1, baseCid: C1 })
  assert.deepEqual(d, { action: 'adopt', remoteChanged: false })
})

test('clean draft adopts even when the on-chain cid moved (stale-cache → fresh, the original bug)', () => {
  // Draft was seeded from a stale cache (savedJson === draftJson) under base C1;
  // fresh chain metadata arrives under C2. A clean draft must still adopt it —
  // the once-only seeder used to ignore this, leaving the form stale.
  const d = computeSyncDecision({ draftJson: STALE, savedJson: STALE, incomingCid: C2, baseCid: C1 })
  assert.equal(d.action, 'adopt')
  assert.equal(d.remoteChanged, false)
})

test('dirty draft + remote cid change → keep draft and flag', () => {
  const d = computeSyncDecision({ draftJson: EDITED, savedJson: STALE, incomingCid: C2, baseCid: C1 })
  assert.deepEqual(d, { action: 'flag', remoteChanged: true })
})

test('dirty draft + unchanged cid (boot ordering) → keep, no flag', () => {
  // Metadata object replaced but the cid is still what the draft is based on
  // (e.g. boot fetch landing after the cid was already current). Preserve edits,
  // do not raise a false remote-change.
  const d = computeSyncDecision({ draftJson: EDITED, savedJson: STALE, incomingCid: C1, baseCid: C1 })
  assert.deepEqual(d, { action: 'keep', remoteChanged: false })
})

test('own publish path → clean draft, adopt, no flag', () => {
  // After publish the composable sets savedMetadata = draft, so draftJson ===
  // savedJson; the watcher must not raise remoteChanged for our own write.
  const d = computeSyncDecision({ draftJson: FRESH, savedJson: FRESH, incomingCid: C2, baseCid: C1 })
  assert.equal(d.action, 'adopt')
  assert.equal(d.remoteChanged, false)
})

// ── isPublishConflict ────────────────────────────────────────────────────────

test('no conflict when on-chain cid matches the draft base', () => {
  assert.equal(isPublishConflict(C1, C1), false)
})

test('conflict when on-chain cid moved since the draft loaded', () => {
  assert.equal(isPublishConflict(C1, C2), true)
})

test('no conflict on first publish (null base)', () => {
  assert.equal(isPublishConflict(null, C1), false)
})
