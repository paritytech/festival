import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick } from 'vue'
import {
  festivalState,
  resetFestivalState,
  hydrateFromCache,
  persistToCache,
  startCachePersistence,
} from './festival-state'
import { addPending, hasPending, startPendingReconcile } from './pending'

// Self referential window so isInHost() stays false and getStorage() picks
// the localStorage backend, which we shim with a plain map.
const w: any = {}
w.top = w
;(globalThis as any).window = w
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

const F = '0x00000000000000000000000000000000000000f1' as `0x${string}`
const A = '0x00000000000000000000000000000000000000aa' as `0x${string}`
const B = '0x00000000000000000000000000000000000000bb' as `0x${string}`

function seedFestival() {
  festivalState.festival = {
    address: F,
    details: {
      metadataCid: ('0x' + '00'.repeat(32)) as `0x${string}`,
      creator: A,
      festivalPoapContract: A,
      sessionPoapContract: A,
      startTime: 0n,
      endTime: 0n,
      sessionsEnabled: true,
      capacity: 0,
      cancelled: false,
      registeredCount: 0n,
    },
    metadata: null,
    attendees: [],
  }
}

test('pending GC survives the arming scope being stopped', async () => {
  resetFestivalState()
  const scope = effectScope()
  scope.run(() => startPendingReconcile())
  scope.stop()

  addPending('register', A)
  seedFestival()
  festivalState.festival!.attendees = [{ address: A, isCheckedIn: false }]
  await nextTick()
  assert.equal(hasPending('register', A), false, 'GC must outlive the caller scope')
})

test('cache persistence survives the arming scope being stopped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  resetFestivalState()
  const scope = effectScope()
  scope.run(() => startCachePersistence())
  scope.stop()

  seedFestival()
  await nextTick()
  t.mock.timers.tick(1100)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  assert.ok(
    store.has(`festivalState:${F}:anon`),
    'debounced persist must outlive the caller scope',
  )
  t.mock.timers.reset()
})

test('hydrate skips the user slot when it belongs to another identity', async () => {
  resetFestivalState()
  seedFestival()
  festivalState.user.address = A
  festivalState.user.ticketTokenId = 5n
  await persistToCache(F, A)

  resetFestivalState()
  festivalState.user.address = B
  await hydrateFromCache(F, A)
  assert.equal(festivalState.user.address, B)
  assert.equal(festivalState.user.ticketTokenId, 0n)
})

test('hydrate fills the user slot when no identity is set yet', async () => {
  resetFestivalState()
  await hydrateFromCache(F, A)
  assert.equal(festivalState.user.address?.toLowerCase(), A)
  assert.equal(festivalState.user.ticketTokenId, 5n)
})

test('same identity hydrate merges per field and cannot regress fresh reads', async () => {
  resetFestivalState()
  festivalState.user.address = A
  festivalState.user.ticketTokenId = 7n
  await hydrateFromCache(F, A)
  assert.equal(festivalState.user.ticketTokenId, 7n, 'cached 5n must not beat fresh 7n')
})

test('the pre boot paint stands down once a load owns the state', async () => {
  resetFestivalState()
  festivalState.loading = true
  await hydrateFromCache(F, A, { onlyBeforeBoot: true })
  assert.equal(festivalState.user.address, null)
  assert.equal(festivalState.user.ticketTokenId, 0n)
})
