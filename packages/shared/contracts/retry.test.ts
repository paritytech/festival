import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTransientError, retryTransient, withTimeout, TimeoutError } from './retry'

test('isTransientError matches connectivity blips, not reverts/dispatch/rejection', () => {
  assert.equal(isTransientError(new Error('WebSocket connection timed out')), true)
  assert.equal(isTransientError(new Error('network disconnected')), true)
  assert.equal(isTransientError(new Error('Already checked-in.')), false)
  assert.equal(isTransientError(new Error('Transaction would fail: contract call rejected by chain runtime.')), false)
  assert.equal(isTransientError(new Error('Transaction was cancelled')), false)
})

test('isTransientError matches timeouts, -32603 RpcError, and disjoint follows', () => {
  // Timeout is matched by identity, not message.
  assert.equal(isTransientError(new TimeoutError()), true)
  // PAPI RpcError: code carries the JSON-RPC -32603, message has no keyword.
  const rpc = new Error('Internal error')
  ;(rpc as any).name = 'RpcError'
  ;(rpc as any).code = -32603
  assert.equal(isTransientError(rpc), true)
  // -32603 is matched via the code even when the message says nothing useful.
  const rpcBare = new Error('boom')
  ;(rpcBare as any).code = -32603
  assert.equal(isTransientError(rpcBare), true)
  // DisjointError from a hard follow failure.
  assert.equal(isTransientError(new Error('ChainHead disjointed')), true)
  // A revert that merely contains an unrelated number must NOT match -32603.
  const revert = new Error('Contract read reverted: isCheckedIn')
  ;(revert as any).code = 3 // EVM revert code, not a transport error
  assert.equal(isTransientError(revert), false)
})

test('withTimeout rejects a never-settling promise with a TimeoutError', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10), (e) => e instanceof TimeoutError)
})

test('withTimeout passes a fast result straight through', async () => {
  assert.equal(await withTimeout(Promise.resolve('value'), 1000), 'value')
})

test('retryTransient times out a never-settling fn and retries to budget', async () => {
  let calls = 0
  await assert.rejects(
    retryTransient(() => { calls++; return new Promise<never>(() => {}) }, { timeoutMs: 10, retries: 2, baseDelayMs: 0 }),
    (e) => e instanceof TimeoutError,
  )
  assert.equal(calls, 3) // initial + 2 retries, each a fresh attempt that times out
})

test('retryTransient without timeoutMs awaits a slow fn to completion', async () => {
  const result = await retryTransient(
    () => new Promise((r) => setTimeout(() => r('ok'), 20)),
    { baseDelayMs: 0 },
  )
  assert.equal(result, 'ok')
})

test('retryTransient shouldRetry guard refuses to retry once a flag flips', async () => {
  // Models the submit guard: a transient-looking failure must NOT be retried
  // once the tx has committed (signed/broadcast), to avoid a double-submit.
  let calls = 0
  let committed = false
  await assert.rejects(
    retryTransient(
      () => { calls++; committed = true; throw new Error('connection reset') },
      { baseDelayMs: 0, retries: 5, shouldRetry: (e) => !committed && isTransientError(e) },
    ),
    /connection reset/,
  )
  assert.equal(calls, 1) // committed after the first attempt → no retry
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
