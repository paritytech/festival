import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTransientError, retryTransient } from './retry'

test('isTransientError matches connectivity blips, not reverts/dispatch/rejection', () => {
  assert.equal(isTransientError(new Error('WebSocket connection timed out')), true)
  assert.equal(isTransientError(new Error('network disconnected')), true)
  assert.equal(isTransientError(new Error('Already checked-in.')), false)
  assert.equal(isTransientError(new Error('Transaction would fail: contract call rejected by chain runtime.')), false)
  assert.equal(isTransientError(new Error('Transaction was cancelled')), false)
})

test('retryTransient retries a transient failure then succeeds', async () => {
  let calls = 0
  const result = await retryTransient(async () => {
    calls++
    if (calls < 3) throw new Error('connection reset')
    return 'ok'
  }, { baseDelayMs: 0 })
  assert.equal(result, 'ok')
  assert.equal(calls, 3)
})

test('retryTransient does not retry a deterministic failure', async () => {
  let calls = 0
  await assert.rejects(
    retryTransient(async () => { calls++; throw new Error('Already checked-in.') }, { baseDelayMs: 0 }),
    /Already checked-in/,
  )
  assert.equal(calls, 1)
})

test('retryTransient gives up after the retry budget', async () => {
  let calls = 0
  await assert.rejects(
    retryTransient(async () => { calls++; throw new Error('request timed out') }, { retries: 2, baseDelayMs: 0 }),
    /timed out/,
  )
  assert.equal(calls, 3) // initial + 2 retries
})
